export * as Host from "./host.js"

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { PluginManifest } from "@opencode/schema/plugin-manifest"
import { Option, Schema } from "effect"
import { importModule, resolveModule } from "@opencode/util/runtime-import"

export interface Target {
  readonly directory: string
  readonly name?: string
}

export interface Entrypoints {
  readonly server?: string
  readonly tui?: string
  readonly rpc?: string
  /**
   * The prebuilt CommonJS GUI bundle (`gui/main.cjs` or `gui/main.js`). Each desktop app window runs its default
   * export; the desktop app's main process runs its `main` export.
   */
  readonly gui?: string
  /**
   * Set when a legacy path matched instead of the standard `main` entry, one item per part. `resolve` stays pure so
   * the caller can log through its own pipeline; warnings are developer-facing log lines, never shown in a UI.
   */
  readonly deprecated?: readonly Deprecation[]
}

/** One part that resolved through a path the `main` standard replaces. */
export interface Deprecation {
  readonly kind: PluginManifest.Kind
  readonly found: string
  readonly expected: string
}

/**
 * Entry paths a plugin used before the `main` standard, tried only when the manifest names no file for that part, and
 * reported through `Entrypoints.deprecated` so the caller logs it. Warnings are developer-facing log lines only: no UI
 * channel, no i18n.
 *
 * This list and `Entrypoints.deprecated` are transitional and leave together. Removing them is its own behavior
 * change, not cleanup, and must ship with the same edit:
 * - delete the fallback, this list, and the `deprecated` field;
 * - delete the regression test that proves a legacy-only directory still loads and warns;
 * - add a test that a legacy-only directory is now refused;
 * - drop the `plugin uses a legacy entry` warning at both `Host.resolve` call sites.
 *
 * The fallback may be removed only when all four hold:
 * 1. every built-in plugin under `plugins/*` declares `main` entries in `ocplugin.json` and its source layout
 *    matches the standard (directory name = entry name);
 * 2. `docs/ocplugin-dev/index.html` no longer shows a legacy path (`entry.server: "server/index.js"`, `"src/index"`,
 *    ...) and the 2.0 "current behavior" and migration tables are gone;
 * 3. at least one minor release has passed with the deprecation recorded in `CHANGELOG.md`;
 * 4. no plugin triggers a fallback warning on a real load path.
 *
 * @deprecated Removed once the four conditions above hold, when every plugin declares `main` entries.
 */
export const LegacyEntrypoints = {
  server: ["server/index", "src/index", "index"],
  tui: ["tui/index", "tui"],
  rpc: ["rpc/index", "rpc"],
  gui: ["gui/index", "gui-experimental"],
} as const satisfies Record<PluginManifest.Kind, readonly string[]>

/**
 * The `package.json` subpaths a published plugin used before the `main` standard. A package resolved through npm
 * reads through its own `exports` (the specifier is its self-reference), so its files are not at the paths
 * `ocplugin.json` names; this is the last fallback before a part is missing.
 *
 * @deprecated Removed in the next minor, when every published plugin ships and exports `main` entries.
 */
const PackageSubpaths = {
  server: ["server", ""],
  tui: ["tui"],
  rpc: ["rpc"],
  gui: ["gui-experimental"],
} as const satisfies Record<PluginManifest.Kind, readonly string[]>

/**
 * Resolves a plugin's entry files from its `ocplugin.json`. The manifest's `entry` is the only source: each declared
 * part is a path relative to the plugin root without an extension, named `main`, and the host tries that kind's
 * extensions in order. `package.json` takes no part in resolving a directory's files. It stays required because
 * `packageID` reads its `name` when the manifest declares no id, and because a package that arrives through npm
 * resolves its entry through its own `exports` until the next minor. (A bundle's `externals` links read the linked
 * modules' manifests, not the plugin's.)
 *
 * Until the next minor, a part with no `main` file falls back to its legacy path and reports the fallback in
 * `deprecated`, so a plugin that has not migrated yet keeps loading while the platform moves first. `resolve` stays
 * pure: its callers log the report at warning level.
 */
export function resolve(input: Target): Entrypoints {
  const entry = manifest(input.directory).entry ?? {}
  const server = findEntry(input, entry.server, "server")
  const gui = findEntry(input, entry.gui, "gui")
  const tui = findEntry(input, entry.tui, "tui")
  const rpc = findEntry(input, entry.rpc, "rpc")
  const deprecated = [server, gui, tui, rpc].flatMap((part) => (part.deprecated ? [part.deprecated] : []))

  return {
    server: server.entry,
    tui: tui.entry,
    rpc: rpc.entry,
    gui: gui.entry,
    ...(deprecated.length === 0 ? {} : { deprecated }),
  }
}

/** The declared entry first, then the legacy paths. A caller that finds a bundled file uses this order too. */
export function entryCandidates(kind: PluginManifest.Kind, declared: PluginManifest.Entrypoint | undefined) {
  return [...new Set([...(declared ? [declared] : []), ...LegacyEntrypoints[kind]])]
}

export function load(entrypoint: string): Promise<unknown> {
  return importModule(entrypoint)
}

/**
 * The id of a plugin without a server part: the one its `ocplugin.json` declares, a package's name, or a local
 * directory's name when it declares neither. A server part names its plugin in `Plugin.define` instead.
 */
export function packageID(target: Target) {
  if (target.name) return target.name
  const declared = manifest(target.directory)
  if (declared.id) return declared.id
  const name = packageManifest(target.directory)?.name
  return typeof name === "string" && name ? name : path.basename(target.directory)
}

interface Found {
  readonly entry?: string
  readonly deprecated?: Deprecation
}

function findEntry(
  input: Target,
  declared: PluginManifest.Entrypoint | undefined,
  kind: PluginManifest.Kind,
): Found {
  for (const candidate of entryCandidates(kind, declared)) {
    for (const extension of PluginManifest.Extensions[kind]) {
      const file = path.resolve(input.directory, `${candidate}${extension}`)
      if (!existsSync(file)) continue
      const entry = pathToFileURL(file).href
      // A declared entry that already ends in `main` is the standard; anything else that matched did so by falling back.
      if (candidate === declared && candidate.endsWith("/main")) return { entry }
      return { entry, deprecated: { kind, found: candidate, expected: `${kind}/main` } }
    }
  }
  // A package resolved through npm resolves through its own `exports`, so its files are not where `main` says.
  return input.name ? findPackageEntry({ ...input, name: input.name }, kind) : {}
}

/** The pre-`main` package subpaths, resolved through the package's own `exports` until the next minor. */
function findPackageEntry(input: Target & { readonly name: string }, kind: PluginManifest.Kind): Found {
  for (const subpath of PackageSubpaths[kind]) {
    const specifier = [input.name, subpath].filter(Boolean).join("/")
    try {
      const found = resolveModule(specifier, input.directory)
      // The app evaluates the GUI bundle as CommonJS text, so a source or ES module is never a GUI entry.
      if (kind === "gui" && !/\.c?js$/.test(found)) continue
      return { entry: found, deprecated: { kind, found: specifier, expected: `${kind}/main` } }
    } catch (error) {
      if (!missing(error)) throw error
    }
  }
  return {}
}

function missing(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ENOTDIR", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(
      String(error.code),
    )
  )
}


// A manifest that is not JSON, or whose `entry` does not match the standard (an extension, a path not ending in
// `main`), is ignored as a whole and contributes no entries: the directory silently falls back to the legacy paths
// instead of failing to resolve. That silence is intentional for the transition — a plugin written before the `main`
// standard keeps loading — but it also means an author editing `entry` to an old shape sees no error, only the
// fallback. The manifest is not the only source of a plugin's id, so an unreadable `entry` alone must not be fatal.
const Manifest = Schema.fromJsonString(
  Schema.Struct({ id: Schema.optional(Schema.String), entry: Schema.optional(PluginManifest.Entry) }),
)

function manifest(directory: string): Schema.Schema.Type<typeof Manifest> {
  const file = path.join(directory, "ocplugin.json")
  if (!existsSync(file)) return {}
  return Option.getOrElse(Schema.decodeUnknownOption(Manifest)(readFileSync(file, "utf8")), () => ({}))
}

// The fields the plugin id fallback reads from a local directory's package.json.
const PackageManifest = Schema.fromJsonString(Schema.Struct({ name: Schema.optional(Schema.Unknown) }))

// A package.json that is not a JSON object counts as missing, so one broken plugin directory never stops the rest
// from listing: it falls back to its directory name.
function packageManifest(directory: string) {
  const file = path.join(directory, "package.json")
  if (!existsSync(file)) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(PackageManifest)(readFileSync(file, "utf8")))
}
