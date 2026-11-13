export * as PluginModule from "./module.js"

import type { Plugin } from "@opencode/plugin/effect/plugin"
import { Host } from "@opencode/plugin/host"
import { Display, GuiBundle, Reason, type Source } from "@opencode/schema/plugin"
import { PluginManifest } from "@opencode/schema/plugin-manifest"
import { createPluginSources } from "@opencode/plugin/source"
import { Hash } from "@opencode/util/hash"
import { Npm } from "@opencode/util/npm"
import { Deferred, Duration, Effect, FiberSet, Option, PubSub, Schema, Stream } from "effect"
import path from "path"
import { existsSync, readFileSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import type { ConfigPluginSource } from "../config/plugin/source.js"
import type { Generation } from "../plugin.js"
import { PluginPromise } from "./promise.js"
import { Config } from "../config.js"
import { ManagedPolicy } from "../managed-policy.js"
import { PluginConfiguration } from "./configuration.js"
import { Watcher } from "../filesystem/watcher.js"

/** How long a plugin's package install and module import may take before the load fails like any other. */
const LOAD_TIMEOUT_MS = 15_000

export const make = Effect.fn("PluginModule.make")(function* (settings?: { readonly loadTimeout?: Duration.Input }) {
  const loadTimeout = settings?.loadTimeout ?? LOAD_TIMEOUT_MS
  const config = yield* Config.Service
  const watcher = yield* Watcher.Service
  const scope = yield* Effect.scope
  const runPromise = yield* FiberSet.makeRuntimePromise()
  const changes = yield* PubSub.unbounded<void>()
  const watched = new Set<string>()
  const watch = Effect.fn("PluginModule.watch")(function* (file: string) {
    if (watched.has(file)) return
    watched.add(file)
    const ready = yield* Deferred.make<void>()
    const target = yield* Effect.promise(() => watchTarget(file))
    const updates = yield* watcher.subscribe(target, Deferred.succeed(ready, undefined))
    yield* updates.pipe(
      Stream.runForEach(() => PubSub.publish(changes, undefined)),
      Effect.ensuring(Deferred.succeed(ready, undefined)),
      Effect.forkIn(scope, { startImmediately: true }),
    )
    yield* Deferred.await(ready)
  })
  const sources = yield* Effect.acquireRelease(
    Effect.sync(() => createPluginSources((file) => runPromise(watch(file)))),
    (sources) => Effect.sync(() => sources.dispose()),
  )
  return {
    load: (
      operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
      options?: { readonly install?: boolean },
    ) =>
      Effect.gen(function* () {
        const version = operation.target.lastIndexOf("@")
        const target =
          path.isAbsolute(operation.target) || version <= 0 ? operation.target : operation.target.slice(0, version)
        if (ManagedPolicy.decision(ManagedPolicy.statements(yield* config.entries()), "plugin.use", target) === "deny")
          return { blocked: true as const }
        return yield* load(operation, sources, watch, loadTimeout, options)
      }),
    changes: () => Stream.fromPubSub(changes),
  }
})

// A local plugin's directory (or legacy standalone file), where clients resolve its other parts.
export function source(target: string, version?: string): Source {
  if (path.isAbsolute(target)) return { type: "local", path: target }
  return { type: "package", target, ...(version ? { version } : {}) }
}

// A missing dependency may have missing parents too. Watch the nearest existing
// ancestor recursively so creating the rest of the path can trigger recovery.
function watchTarget(file: string): Promise<Watcher.WatchInput> {
  return stat(file).then(
    (info) => ({ path: file, type: info.isDirectory() ? "directory" : "file" }),
    (cause) => {
      if (path.dirname(file) === file) throw cause
      return watchTarget(path.dirname(file))
    },
  )
}

const GuiOptions = GuiBundle.fields.options

const Hook = <A>(guard: (input: unknown) => input is A) => Schema.declare<A>(guard).pipe(Schema.optional)

type PromisePlugin = Parameters<typeof PluginPromise.fromPromise>[0]
const PromiseEntry = Schema.declare<NonNullable<PromisePlugin["activate"]>>(
  (input): input is NonNullable<PromisePlugin["activate"]> => typeof input === "function",
)
const PromiseHooks = {
  onInstall: Hook<NonNullable<PromisePlugin["onInstall"]>>(
    (input): input is NonNullable<PromisePlugin["onInstall"]> => typeof input === "function",
  ),
  onUninstall: Hook<NonNullable<PromisePlugin["onUninstall"]>>(
    (input): input is NonNullable<PromisePlugin["onUninstall"]> => typeof input === "function",
  ),
}

const Module = Schema.Struct({
  default: Schema.Union([
    Schema.Struct({
      id: Schema.String,
      display: Display.pipe(Schema.optional),
      effect: Schema.declare<Plugin["effect"]>((input): input is Plugin["effect"] => typeof input === "function"),
      onInstall: Hook<NonNullable<Plugin["onInstall"]>>(
        (input): input is NonNullable<Plugin["onInstall"]> => typeof input === "function",
      ),
      onUninstall: Hook<NonNullable<Plugin["onUninstall"]>>(
        (input): input is NonNullable<Plugin["onUninstall"]> => typeof input === "function",
      ),
    }),
    // `setup` is the deprecated spelling of `activate`; a module may declare either one.
    Schema.Struct({
      id: Schema.String,
      display: Display.pipe(Schema.optional),
      activate: PromiseEntry,
      setup: Hook<NonNullable<PromisePlugin["setup"]>>(
        (input): input is NonNullable<PromisePlugin["setup"]> => typeof input === "function",
      ),
      ...PromiseHooks,
    }),
    Schema.Struct({
      id: Schema.String,
      display: Display.pipe(Schema.optional),
      activate: Hook<NonNullable<PromisePlugin["activate"]>>(
        (input): input is NonNullable<PromisePlugin["activate"]> => typeof input === "function",
      ),
      setup: PromiseEntry,
      ...PromiseHooks,
    }),
  ]),
})

export class LoadError extends Schema.TaggedError<LoadError>()("PluginModule.LoadError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
  /** Set when the load itself hit the deadline, so the supervisor can report a timeout instead of a generic load. */
  reason: Schema.optional(Reason),
}) {}

const load = Effect.fn("PluginModule.load")(function* (
  operation: Extract<ConfigPluginSource.Operation, { type: "add" }>,
  sources: ReturnType<typeof createPluginSources>,
  watch: (file: string) => Effect.Effect<void>,
  loadTimeout: Duration.Input,
  options?: { readonly install?: boolean },
) {
  const local = path.isAbsolute(operation.target)
  const deadline = Duration.fromInputUnsafe(loadTimeout)
  const timeoutSeconds = Duration.toSeconds(deadline)
  const timeoutMillis = Duration.toMillis(deadline)
  const timedOut = () =>
    new LoadError({
      message: `Plugin load timed out after ${timeoutSeconds}s`,
      reason: { kind: "load-timeout", seconds: timeoutSeconds },
    })
  const npm = yield* Npm.Service
  // Installing a package and importing its code are the only steps that leave this process: a package manager that
  // never returns, or a plugin whose top level never settles, must not hold the generation. Time out those steps and
  // fail like any other load so the supervisor records the target and retries on a later activation. Local reads
  // (the manifest, the GUI bundle) stay outside the deadline.
  //
  // The deadline guards those two steps only, with a wall-clock timer. Wrapping the whole load in `Effect.timeout`
  // would race the controlled test clock (one `TestClock.adjust` past the deadline fails an in-flight load and the
  // supervisor retries it, so two installs overlap) and would interrupt a module that already started evaluating,
  // leaving it active without its RPC domains. An import that overruns keeps running in the background; the next
  // attempt reads its cached result.
  //
  // `npm.add` is a child process: the race abandons this fiber at the deadline, not the install itself, which may
  // still finish in the background. The next attempt then finds the package installed.
  const prepared = yield* Effect.gen(function* () {
    const installed = local
      ? undefined
      : yield* withWallClockDeadline(
          options?.install === false ? npm.resolve(operation.target) : npm.add(operation.target),
          timeoutMillis,
          timedOut,
        )
    // Legacy auto-discovery still admits standalone server sources. Configured
    // local plugins always arrive here as directories.
    const entrypoints: Host.Entrypoints =
      local && (yield* Effect.promise(() => stat(operation.target))).isFile()
        ? { server: pathToFileURL(operation.target).href }
        : yield* Effect.sync(() => Host.resolve(installed ?? { directory: operation.target }))
    if (entrypoints.deprecated)
      yield* Effect.forEach(
        entrypoints.deprecated,
        (warning) =>
          Effect.logWarning("plugin uses a legacy entry", {
            target: operation.target,
            kind: warning.kind,
            found: warning.found,
            expected: warning.expected,
          }),
        { discard: true },
      )
    const entrypoint = entrypoints.server
    // A TUI-only package is not the server's to list; the TUI loads it from its own config.
    const found = entrypoint || entrypoints.gui
    if (!local && options?.install === false && !found) return { pending: true as const }
    if (!found) return yield* new LoadError({ message: `Plugin entrypoint not found: ${operation.target}` })
    yield* Effect.log({ msg: "loading plugin", id: operation.target, entrypoint: found })
    // A package with only a GUI part (and maybe a TUI part) has nothing to run here: its id is its package name, and its
    // other parts load from this listing.
    const server = entrypoint
      ? yield* loadServer(entrypoint, local ? sources : undefined, installed?.revision, timeoutMillis, timedOut)
      : undefined
    return { pending: false as const, installed, entrypoints, entrypoint, server }
  })
  if (prepared.pending) return prepared
  const plugin = prepared.server?.plugin ?? {
    id: Host.packageID(prepared.installed ?? { directory: operation.target }),
    effect: () => Effect.void,
    onInstall: undefined,
    onUninstall: undefined,
  }
  const revision = JSON.stringify([
    operation,
    prepared.server ? prepared.server.version : prepared.installed?.revision,
  ])
  // A bundle's manifest declares its flat configuration and, when it uses an interpreter, its runtime; a plugin
  // without one gets no `ctx.config` values and no environment.
  const directory = local
    ? (yield* Effect.promise(() => stat(operation.target))).isFile()
      ? path.dirname(operation.target)
      : operation.target
    : prepared.installed?.directory
  // Read the manifest synchronously: an awaited read adds a scheduling boundary to every activation, which changes
  // when a reload's debounce window starts relative to a controlled test clock. The file is small and local.
  const manifest = directory === undefined ? undefined : yield* Effect.sync(() => readManifest(directory))
  // A local plugin's `./gui-experimental` bundle is outside the server entry's import graph: watch it, and let its
  // content change the GUI's revision, so an edit reloads the GUI like a server or TUI edit reloads theirs. A package's
  // bundle changes only with its installed version. The GUI's revision is a hash: windows receive it, and the operation
  // holds the options.
  const gui = local && prepared.entrypoints.gui ? fileURLToPath(prepared.entrypoints.gui) : undefined
  if (gui) yield* watch(gui)
  const bundle = gui ? Hash.sha256(yield* Effect.promise(() => readFile(gui))) : undefined
  // The GUI receives the same options as the server entry; they cross to the app, so they must be JSON.
  const guiOptions = prepared.entrypoints.gui
    ? yield* Schema.decodeUnknownEffect(GuiOptions)(operation.options).pipe(
        Effect.mapError(
          (cause) => new LoadError({ message: "Plugin options must be JSON to reach its ./gui-experimental", cause }),
        ),
      )
    : {}
  return {
    id: plugin.id,
    ...(plugin.display === undefined ? {} : { display: plugin.display }),
    features: {
      ...(prepared.entrypoint ? { server: true as const } : {}),
      ...(prepared.entrypoints.tui ? { tui: true as const } : {}),
      ...(prepared.entrypoint && prepared.entrypoints.rpc ? { rpc: true as const } : {}),
      ...(prepared.entrypoints.gui ? { gui: true as const } : {}),
    },
    gui: prepared.entrypoints.gui
      ? {
          file: prepared.entrypoints.gui,
          revision: Hash.sha256(JSON.stringify([revision, bundle])),
          options: guiOptions,
        }
      : undefined,
    revision,
    source: source(operation.target, prepared.installed?.version),
    effect: (host) => plugin.effect({ ...host, options: operation.options }),
    ...(manifest?.configuration === undefined ? {} : { configuration: manifest.configuration }),
    ...(manifest?.runtime === undefined ? {} : { runtime: manifest.runtime }),
    ...(plugin.onInstall === undefined
      ? {}
      : { onInstall: (host) => plugin.onInstall!({ ...host, options: operation.options }) }),
    ...(plugin.onUninstall === undefined
      ? {}
      : { onUninstall: (host) => plugin.onUninstall!({ ...host, options: operation.options }) }),
  } satisfies Generation
})

const loadServer = Effect.fn("PluginModule.loadServer")(function* (
  entrypoint: string,
  sources: ReturnType<typeof createPluginSources> | undefined,
  revision: string | undefined,
  timeoutMillis: number,
  timedOut: () => LoadError,
) {
  const loaded = yield* Effect.promise(() =>
    withDeadline(
      sources ? sources.read(entrypoint) : Host.load(entrypoint).then((module) => ({ module, version: revision })),
      timeoutMillis,
      timedOut,
    ),
  )
  const value = (yield* Schema.decodeUnknownEffect(Module)(loaded.module).pipe(
    Effect.mapError(
      (cause) =>
        new LoadError({
          message: "Plugin must export a default definition with an id and an effect or setup function.",
          cause,
        }),
    ),
  )).default
  return { plugin: "effect" in value ? value : PluginPromise.fromPromise(value), version: loaded.version }
})

/** Races an Effect against a wall-clock deadline, so a controlled test clock cannot fire it. */
function withWallClockDeadline<A, E, R>(self: Effect.Effect<A, E, R>, millis: number, timedOut: () => LoadError) {
  // A promise-based sleep cannot be interrupted: the losing fiber would stay alive until the deadline. `callback`
  // registers a finalizer that clears the timer when the race ends.
  const deadline = Effect.callback<void>((resume) => {
    const timer = setTimeout(() => resume(Effect.void), millis)
    return Effect.sync(() => clearTimeout(timer))
  })
  return Effect.raceFirst(self, deadline.pipe(Effect.andThen(Effect.fail(timedOut()))))
}

/** Rejects when an import outlives the deadline. The import keeps running and caches its result for the next attempt. */
function withDeadline<T>(work: Promise<T>, millis: number, timedOut: () => LoadError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timedOut()), millis)
    timer.unref?.()
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** The manifest's configuration and runtime are optional. Its configuration is only validated strictly on install. */
function readManifest(directory: string) {
  const file = path.join(directory, "ocplugin.json")
  if (!existsSync(file)) return undefined
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { configuration?: unknown; runtime?: unknown }
  return {
    configuration: PluginConfiguration.isConfiguration(parsed.configuration) ? parsed.configuration : undefined,
    runtime: Option.getOrUndefined(Schema.decodeUnknownOption(PluginManifest.Runtime)(parsed.runtime)),
  }
}
