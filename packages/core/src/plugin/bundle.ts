export * as PluginBundle from "./bundle.js"

import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { mkdir, readdir, readFile, rename, rm, stat, symlink, utimes } from "node:fs/promises"
import path from "node:path"
import { Host } from "@opencode/plugin/host"
import { PluginManifest } from "@opencode/schema/plugin-manifest"
import { Option, Schema } from "effect"
import { compareVersions, installRoot, root as localRoot } from "./local.js"
import { PluginConfiguration, type Configuration } from "./configuration.js"

export type Result = { readonly id: string; readonly version: string; readonly path: string }

type Manifest = {
  apiVersion: number
  id: string
  version: string
  entry: PluginManifest.Entry
  externals?: string[]
  files?: { path: string; sha256: string }[]
  display?: {
    name: string
    description: string
    category?: string
    tools?: string[]
    icon?: string
  }
  skills?: { id: string; name: string; description: string; path: string }[]
  assets?: string[]
  requires?: { opencode?: string }
  configuration?: Configuration
  runtime?: PluginManifest.Runtime
}

/**
 * Installs a `.ocplugin` bundle that already exists on this machine, so the app can offer one button instead of
 * explaining the container format. Versions live under the local discover directory, and the chosen one is verified
 * and unpacked into `~/.opencode/ocplugins/<id>/`, where plugin discovery picks it up.
 */
export async function install(input: {
  readonly id: string
  readonly version?: string
  readonly config: string
  readonly cwd: string
  readonly home: string
  readonly opencodeVersion?: string
}): Promise<Result> {
  const file = await find(input)
  const archive = new Bun.Archive(new Uint8Array(await readFile(file)))
  const entries = await archive.files()
  const manifest = await readManifest(entries, input.opencodeVersion)
  if (manifest.apiVersion !== 1)
    throw new Error(`This bundle needs a newer OpenCode (format ${manifest.apiVersion}). Update the app first.`)
  if (manifest.id !== input.id) throw new Error(`This bundle is ${manifest.id}, not ${input.id}.`)
  if (input.version && manifest.version !== input.version)
    throw new Error(`This bundle is version ${manifest.version}, not ${input.version}.`)
  for (const hash of manifest.files ?? []) {
    const entry = entries.get(hash.path)
    if (!entry) throw new Error(`This bundle is incomplete: ${hash.path} is missing.`)
    const digest = createHash("sha256")
      .update(new Uint8Array(await entry.arrayBuffer()))
      .digest("hex")
    if (digest !== hash.sha256) throw new Error(`This bundle is damaged: ${hash.path} does not match its checksum.`)
  }

  const plugins = installRoot(input.home)
  await mkdir(plugins, { recursive: true })
  const target = path.join(plugins, manifest.id)
  // A different version replaces the installed copy; the plugin watcher reloads it from the new files. On Windows a
  // loaded plugin's files stay locked, so the removal fails there and the explicit error is better than reporting the
  // old version as the one that was just installed.
  if (await exists(target)) {
    const current = await installedVersion(target, manifest.version)
    if (current === manifest.version) return { id: manifest.id, version: current, path: target }
    await rm(target, { recursive: true, force: true })
  }
  const tmp = path.join(plugins, `.${manifest.id}.tmp-${random()}`)
  await mkdir(tmp, { recursive: true })
  try {
    await archive.extract(tmp)
    await linkExternals(tmp, manifest.externals ?? [])
    await rename(tmp, target)
    // Touching the directory gives the config watcher a change event, so the host reloads without a restart.
    await utimes(plugins, new Date(), new Date()).catch(() => {})
    return { id: manifest.id, version: manifest.version, path: target }
  } catch (error) {
    await rm(tmp, { recursive: true, force: true })
    throw error
  }
}

/** Removes an installed bundle. A loaded plugin's files can be deleted on Windows even though they cannot be renamed. */
export async function uninstall(input: { readonly id: string; readonly home: string; readonly config?: string }) {
  const plugins = installRoot(input.home)
  const targets = [path.join(plugins, input.id)]
  // Bundles installed before the directory moved still sit in the config tree.
  if (input.config) targets.push(path.join(input.config, "plugins", input.id))
  const removed = (await Promise.all(targets.map(exists))).some(Boolean)
  await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })))
  // Touching the directory gives the plugin watcher a change event, so the host unloads it without a restart.
  await utimes(plugins, new Date(), new Date()).catch(() => {})
  return { id: input.id, removed }
}

/**
 * The requested version from the local discover directory, or the newest one when the caller did not pick. The
 * download and working locations stay as a fallback so a bundle dragged in from a browser still installs.
 */
async function find(input: { id: string; version?: string; config: string; cwd: string; home: string }) {
  const local = await findLocal(input)
  if (local) return local
  const folders = [
    path.join(input.home, "Desktop"),
    path.join(input.home, "Downloads"),
    path.join(input.home, "desktop"),
    path.join(input.home, "downloads"),
    input.cwd,
    path.join(input.config, "plugins"),
  ]
  const candidates: { file: string; mtime: number }[] = []
  for (const folder of folders) {
    const names = await readdir(folder).catch(() => [])
    for (const name of names) {
      if (!name.startsWith(input.id) || !name.endsWith(".ocplugin")) continue
      const info = await stat(path.join(folder, name)).catch(() => undefined)
      if (info?.isFile()) candidates.push({ file: path.join(folder, name), mtime: info.mtimeMs })
    }
  }
  if (candidates.length === 0)
    throw new Error(
      `No ${input.id}${input.version ? `@${input.version}` : ""} bundle was found in ${localRoot(input.home)}. Pack it there, then install.`,
    )
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0]!.file
}

async function findLocal(input: { id: string; version?: string; home: string }) {
  const directory = path.join(localRoot(input.home), input.id)
  const versions = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const names = versions
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersions)
  const version = input.version ?? names.at(-1)
  if (!version) return undefined
  const files = await readdir(path.join(directory, version)).catch(() => [])
  const file = files.find((name) => name.endsWith(".ocplugin"))
  return file ? path.join(directory, version, file) : undefined
}

async function readManifest(entries: Map<string, File>, opencodeVersion?: string): Promise<Manifest> {
  const file = entries.get("ocplugin.json")
  if (!file) throw new Error("This is not a plugin bundle: ocplugin.json is missing.")
  const parsed: unknown = JSON.parse(await file.text())
  if (typeof parsed !== "object" || parsed === null) throw new Error("This plugin bundle has an unreadable manifest.")
  const manifest = parsed as Partial<Manifest>
  if (typeof manifest.id !== "string" || typeof manifest.version !== "string" || typeof manifest.apiVersion !== "number")
    throw new Error("This plugin bundle has an unreadable manifest.")
  // An unreadable entry falls back to the legacy paths like a missing one, so a bundle built before the `main`
  // standard still installs while its author migrates.
  const declared = Option.getOrUndefined(Schema.decodeUnknownOption(PluginManifest.Entry)(manifest.entry)) ?? {}
  const entry = requireEntries(manifest.id, declared, entries)
  requireDisplay(manifest.display)
  requireSkills(manifest.skills, entries)
  requireAssets(manifest.assets)
  requireConfiguration(manifest.configuration)
  const runtime = requireRuntime(manifest.runtime)
  requireVersion(manifest.requires, opencodeVersion)
  return (runtime === undefined ? { ...manifest, entry } : { ...manifest, entry, runtime }) as Manifest
}

/**
 * Finds a shipped file for every part the bundle declares, preferring the `main` entry and falling back to the legacy
 * paths with a deprecation warning. A part with neither is refused with the path its author has to create.
 */
function requireEntries(
  id: string,
  declared: PluginManifest.Entry,
  entries: Map<string, File>,
): PluginManifest.Entry {
  const server = resolveKind(id, declared, entries, "server")
  const gui = resolveKind(id, declared, entries, "gui")
  const tui = resolveKind(id, declared, entries, "tui")
  const rpc = resolveKind(id, declared, entries, "rpc")
  return { server, ...(gui ? { gui } : {}), ...(tui ? { tui } : {}), ...(rpc ? { rpc } : {}) }
}

/**
 * One part: its declared entry first, then the legacy paths, each tried with that kind's extensions in order. A part
 * missing every candidate is refused with the files the author may ship.
 */
function resolveKind(
  id: string,
  declared: PluginManifest.Entry,
  entries: Map<string, File>,
  kind: "server",
): string
function resolveKind(
  id: string,
  declared: PluginManifest.Entry,
  entries: Map<string, File>,
  kind: PluginManifest.Kind,
): string | undefined
function resolveKind(
  id: string,
  declared: PluginManifest.Entry,
  entries: Map<string, File>,
  kind: PluginManifest.Kind,
): string | undefined {
  const wanted = declared[kind]
  const found = Host.entryCandidates(kind, wanted).find((candidate) =>
    PluginManifest.Extensions[kind].some((extension) => entries.has(`${candidate}${extension}`)),
  )
  if (!found) {
    if (!wanted && kind !== "server") return undefined
    throw new Error(
      `This plugin bundle has no ${kind} entry. Expected ${PluginManifest.expectedPath(
        kind,
        wanted ?? `${kind}/main`,
      )}; tried ${entryFiles(kind, wanted).join(", ")}.`,
    )
  }
  if (found !== wanted) {
    // Install is a one-shot operation on a plain async function, outside any Effect fiber, so there is no structured
    // log pipeline to hand this to; this stays a console warning by design. The load path is different: `Host.resolve`
    // returns the fallback as data and `PluginModule` logs it once per load.
    console.warn(
      `[opencode] Plugin "${id}" ${kind} entry "${found}" is deprecated; this bundle should declare and ship "${kind}/main".`,
    )
  }
  return found
}

/** Every file a bundle may ship for one part, in the order the host accepts them. */
function entryFiles(kind: PluginManifest.Kind, wanted: PluginManifest.Entrypoint | undefined) {
  return Host.entryCandidates(kind, wanted).flatMap((candidate) =>
    PluginManifest.Extensions[kind].map((extension) => `${candidate}${extension}`),
  )
}

function requireDisplay(input: unknown) {
  if (input === undefined) return
  if (typeof input !== "object" || input === null)
    throw new Error("This plugin bundle has an unreadable display.")
  const display = input as Record<string, unknown>
  if (typeof display.name !== "string" || typeof display.description !== "string")
    throw new Error("This plugin bundle has a display without a name and description.")
  if (display.category !== undefined && typeof display.category !== "string")
    throw new Error("This plugin bundle has a display category that is not text.")
  if (
    display.tools !== undefined &&
    !(Array.isArray(display.tools) && display.tools.every((value) => typeof value === "string"))
  )
    throw new Error("This plugin bundle has a display tool list that is not text.")
  if (display.icon !== undefined && typeof display.icon !== "string")
    throw new Error("This plugin bundle has a display icon that is not text.")
}

function requireSkills(input: unknown, entries: Map<string, File>) {
  if (input === undefined) return
  if (!Array.isArray(input)) throw new Error("This plugin bundle has an unreadable skills list.")
  for (const skill of input) {
    if (typeof skill !== "object" || skill === null) throw new Error("This plugin bundle has an unreadable skill.")
    const { id, name, description, path: skillPath } = skill as Record<string, unknown>
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof description !== "string" ||
      typeof skillPath !== "string"
    )
      throw new Error("This plugin bundle has a skill without an id, name, description and path.")
    if (!entries.has(skillPath)) throw new Error(`This plugin bundle is incomplete: ${skillPath} is missing.`)
  }
}

function requireAssets(input: unknown) {
  if (input === undefined) return
  if (!Array.isArray(input) || !input.every((value) => typeof value === "string"))
    throw new Error("This plugin bundle has an unreadable assets list.")
}

function requireConfiguration(input: unknown) {
  if (input === undefined) return
  if (!PluginConfiguration.isConfiguration(input))
    throw new Error(
      "This plugin bundle has an invalid configuration: only string, number, boolean and string-array properties are supported.",
    )
}

/** A declared runtime must be readable, since installing the plugin schedules preparing its environment. */
function requireRuntime(input: unknown): PluginManifest.Runtime | undefined {
  if (input === undefined) return undefined
  const runtime = Option.getOrUndefined(Schema.decodeUnknownOption(PluginManifest.Runtime)(input))
  if (!runtime)
    throw new Error(
      "This plugin bundle has an invalid runtime: python must be a version constraint and dependencies a list of package specs.",
    )
  return runtime
}

function requireVersion(input: unknown, opencodeVersion: string | undefined) {
  if (input === undefined) return
  if (typeof input !== "object" || input === null) throw new Error("This plugin bundle has unreadable requirements.")
  const required = (input as { opencode?: unknown }).opencode
  if (required === undefined) return
  if (typeof required !== "string") throw new Error("This plugin bundle requires an unreadable OpenCode version.")
  if (opencodeVersion === undefined) return
  const minimum = required.replace(/^[\^~>=v\s]+/, "")
  if (compareVersions(opencodeVersion, minimum) < 0)
    throw new Error(`This plugin needs OpenCode >= ${minimum}; this app is ${opencodeVersion}.`)
}

/**
 * The bundle's entry imports the host's own `effect` and `@opencode/*` modules, and a plugin directory lives outside
 * any node_modules tree. Link each host module into the plugin so those imports resolve to the same instances the
 * host already loaded.
 */
async function linkExternals(directory: string, externals: readonly string[]) {
  if (externals.length === 0) return
  const require = createRequire(import.meta.url)
  for (const name of externals) {
    const manifest = require.resolve(`${name}/package.json`)
    const target = path.join(directory, "node_modules", ...name.split("/"))
    await mkdir(path.dirname(target), { recursive: true })
    await symlink(path.dirname(manifest), target, process.platform === "win32" ? "junction" : "dir")
  }
}

async function exists(target: string) {
  return stat(target).then(
    (info) => info.isDirectory(),
    () => false,
  )
}

async function installedVersion(target: string, fallback: string) {
  const manifest = await readFile(path.join(target, "ocplugin.json"), "utf8").then(
    (text) => JSON.parse(text) as { version?: unknown },
    () => undefined,
  )
  return typeof manifest?.version === "string" ? manifest.version : fallback
}

function random() {
  return Math.random().toString(36).slice(2, 10)
}
