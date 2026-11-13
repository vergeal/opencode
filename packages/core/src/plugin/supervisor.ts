export * as PluginSupervisor from "./supervisor.js"

import { Event } from "@opencode/schema/config"
import { Cause, Clock, Context, Effect, Layer, Queue, Stream } from "effect"
import { ConfigPluginSource } from "../config/plugin/source.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Npm } from "@opencode/util/npm"
import { Plugin } from "../plugin.js"
import { InstancePlugins } from "./instance.js"
import { PluginInternal } from "./internal.js"
import { PluginModule } from "./module.js"
import { SdkPlugins } from "./sdk.js"
import { PluginUpdate } from "./update.js"
import { Watcher } from "../filesystem/watcher.js"

/** One target's consecutive load failures and when the next attempt may start. */
type Backoff = { count: number; nextAt: number }

type Retries = {
  /** The previous activation's failures by target, reused while a target waits out its backoff. */
  readonly retained: ReadonlyMap<string, Plugin.Failure>
  readonly attempts: Map<string, Backoff>
  /** The last operation seen per target; a changed operation is a new intent and clears its backoff. */
  readonly signatures: Map<string, string>
}

const resolve = Effect.fn("PluginSupervisor.resolve")(function* (
  modules: Effect.Success<ReturnType<typeof PluginModule.make>>,
  pre: readonly Plugin.Generation[],
  post: readonly Plugin.Generation[],
  operations: readonly ConfigPluginSource.Operation[],
  install: boolean,
  running: ReadonlyMap<string, Plugin.Generation>,
  retries: Retries,
) {
  const matches = (selector: string, target: string) =>
    selector === "*" || (selector.endsWith(".*") ? target.startsWith(selector.slice(0, -1)) : selector === target)
  const definitions = [...pre, ...post]
  // A built-in plugin that declares `defaultEnabled: false` ships with the app but waits for an explicit config
  // entry, so installing it from the plugin browser is what switches it on.
  const enabled = new Set(
    definitions.filter((plugin) => plugin.defaultEnabled !== false).map((plugin) => plugin.id),
  )
  const packages = new Map<string, Plugin.Generation>()
  const pending = new Set<string>()
  const failures = new Map<string, Plugin.Failure>()
  const plugins = () => [...definitions, ...packages.values()]
  // One instant for the whole pass: every target's window is measured against the same clock the retry tests advance.
  const now = yield* Clock.currentTimeMillis

  // A failed revision never became a generation, so the one already running keeps its place.
  const retain = (target: string) => {
    const previous = packages.get(target) ?? running.get(target)
    if (!previous) return
    packages.set(target, previous)
    enabled.add(previous.id)
  }

  for (const operation of operations) {
    if (operation.type === "remove") {
      if (operation.target === "*") {
        failures.clear()
        retries.attempts.clear()
        retries.signatures.clear()
      } else {
        retries.attempts.delete(operation.target)
        retries.signatures.delete(operation.target)
      }
      plugins()
        .filter((plugin) => matches(operation.target, plugin.id) && !PluginInternal.guarded.has(plugin.id))
        .forEach((plugin) => enabled.delete(plugin.id))
      continue
    }

    // A changed operation is a new intent (a saved config entry or an install), so it retries at once instead of
    // waiting out the previous failure's backoff.
    const signature = JSON.stringify(operation)
    if (retries.signatures.get(operation.target) !== signature) {
      retries.signatures.set(operation.target, signature)
      retries.attempts.delete(operation.target)
    }

    const matched = plugins().filter((plugin) => matches(operation.target, plugin.id))
    const selectsPlugins =
      matched.length > 0 ||
      operation.target === "*" ||
      operation.target.endsWith(".*") ||
      operation.target.startsWith("opencode.")
    if (selectsPlugins) {
      matched.forEach((plugin) => enabled.add(plugin.id))
      continue
    }

    // Inside its backoff window a failed target is neither resolved nor imported again: keep the running generation and
    // report the previous failure unchanged, so repeated activations cannot hammer a broken package.
    const backoff = retries.attempts.get(operation.target)
    const failed = retries.retained.get(operation.target)
    if (backoff && failed && backoff.nextAt > now) {
      failures.set(operation.target, failed)
      retain(operation.target)
      continue
    }

    const plugin = yield* modules.load(operation, { install }).pipe(
      Effect.catchCause((cause) => {
        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        const error = Cause.squash(cause)
        return Effect.logWarning("failed to load plugin", { target: operation.target, ref, cause }).pipe(
          Effect.as(
            error instanceof PluginModule.LoadError
              ? { error: error.message, ref, reason: error.reason ?? { kind: "load-failed" as const } }
              : { error: Cause.pretty(cause), ref, reason: { kind: "load-failed" as const } },
          ),
        )
      }),
    )
    if ("blocked" in plugin) {
      const previous = packages.get(operation.target)
      if (previous) enabled.delete(previous.id)
      packages.delete(operation.target)
      failures.delete(operation.target)
      continue
    }
    if ("pending" in plugin) {
      pending.add(operation.target)
      continue
    }
    if ("error" in plugin) {
      failures.set(operation.target, {
        source: PluginModule.source(operation.target),
        state: { status: "failed", error: plugin.error, ref: plugin.ref, reason: plugin.reason },
        features: { server: true },
      })
      const count = (backoff?.count ?? 0) + 1
      retries.attempts.set(operation.target, { count, nextAt: now + Math.min(2 ** count * 1_000, 60_000) })
      retain(operation.target)
      continue
    }
    retries.attempts.delete(operation.target)
    failures.delete(operation.target)
    const previous = packages.get(operation.target)
    if (previous) enabled.delete(previous.id)
    packages.set(operation.target, plugin)
    enabled.add(plugin.id)
  }

  const ordered = [
    ...pre.filter((plugin) => enabled.has(plugin.id)),
    ...[...packages.values()].filter((plugin) => enabled.has(plugin.id)),
    ...post.filter((plugin) => enabled.has(plugin.id)),
  ]
  // Registry activation dies on a duplicate ID, which would drop the whole generation including builtins.
  // Keep the first occurrence in boot order and report later ones like any other plugin setup failure.
  const duplicate = (plugin: Plugin.Generation, index: number) =>
    ordered.findIndex((other) => other.id === plugin.id) !== index
  return {
    plugins: ordered.filter((plugin, index) => !duplicate(plugin, index)),
    packages: new Map([...packages].filter(([, plugin]) => enabled.has(plugin.id))),
    failures: [
      ...failures.values(),
      ...ordered.filter(duplicate).map((plugin) => ({
        id: Plugin.ID.make(plugin.id),
        source: plugin.source ?? { type: "builtin" as const },
        state: { status: "failed" as const, error: `Duplicate plugin ID: ${plugin.id}` },
        features: plugin.features ?? { server: true as const },
      })),
    ],
    // What a skipped target reuses on the next activation; duplicate failures have no target and are not retained.
    retained: failures,
    pending: [...pending],
  }
})

/** A retry request from the plugin browser: drop one target's backoff and ask for another activation. */
export interface Interface {
  readonly retry: (target: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginSupervisor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* Plugin.Service
    const sdk = yield* SdkPlugins.Service
    const instance = yield* InstancePlugins.Service
    const sources = yield* ConfigPluginSource.Service
    const modules = yield* PluginModule.make()
    const bus = yield* Bus.Service
    const updates = yield* PluginUpdate.Service
    const internal = yield* PluginInternal.list()
    let release: Effect.Effect<void> | undefined = yield* registry.hold()
    yield* Effect.addFinalizer(() => release ?? Effect.void)
    // Built-ins capture services from this layer; unload them before those services close.
    yield* Effect.addFinalizer(registry.close)
    let packages = new Set<string>()
    // Last generation handed to the registry per target; a failed reload keeps it in place.
    let running = new Map<string, Plugin.Generation>()
    let outdated = new Set<string>()
    const updating = new Set<string>()
    // Backoff and operation signatures live only in this process: a restart forgets them and retries everything.
    const attempts = new Map<string, Backoff>()
    const signatures = new Map<string, string>()
    let retained = new Map<string, Plugin.Failure>()
    let generation = 0
    let observed = 0

    const activate = Effect.fn("PluginSupervisor.activate")(function* () {
      const current = ++generation
      // Combine internal plugins with host-contributed plugins in boot order.
      // Instance-bound plugins come last: later activation can override earlier
      // container writes, so the instance's explicit choices win over globals.
      const pre = [...internal.pre, ...sdk.all(), ...instance.all()]
      const post = internal.post
      const operations = yield* sources.operations()
      const source = (source: Plugin.Source) =>
        source.type === "package"
          ? {
              ...source,
              ...(outdated.has(source.target) ? { outdated: true as const } : {}),
              ...(updating.has(source.target) ? { updating: true as const } : {}),
            }
          : source
      const apply = (resolved: { readonly plugins: readonly Plugin.Generation[]; readonly failures: readonly Plugin.Failure[] }) =>
        registry.activate(
          resolved.plugins.map((plugin) => (plugin.source ? { ...plugin, source: source(plugin.source) } : plugin)),
          resolved.failures.map((failure) => ({ ...failure, source: source(failure.source) })),
        )
      const targets = (resolved: {
        readonly plugins: readonly Plugin.Generation[]
        readonly failures: readonly Plugin.Failure[]
      }) =>
        new Set(
          [...resolved.plugins, ...resolved.failures].flatMap((plugin) =>
            plugin.source?.type === "package" ? [plugin.source.target] : [],
          ),
        )
      const check = (active: number, resolved: { readonly plugins: readonly Plugin.Generation[]; readonly failures: readonly Plugin.Failure[] }) =>
        Effect.forEach(
          targets(resolved),
          (target) => updates.check(target).pipe(Effect.map((available) => [target, available] as const)),
          { concurrency: "unbounded" },
        ).pipe(
          Effect.flatMap((checked) => {
            if (active !== generation) return Effect.void
            const next = new Set(checked.flatMap(([target, available]) => (available ? [target] : [])))
            if (next.size === outdated.size && [...next].every((target) => outdated.has(target))) return Effect.void
            outdated = next
            return apply(resolved)
          }),
          Effect.forkScoped({ startImmediately: true }),
        )

      // Activate everything available locally before waiting on missing package installs.
      const immediate = yield* resolve(modules, pre, post, operations, false, running, {
        retained,
        attempts,
        signatures,
      })
      retained = immediate.retained
      yield* apply(immediate)
      running = immediate.packages
      packages = targets(immediate)
      yield* check(current, immediate)
      if (!immediate.pending.length) return
      // Installing a package needs the network. Keep it off the activation path: local plugins are already serving, and
      // the install's result joins the registry only if no later activation superseded this one.
      yield* Effect.gen(function* () {
        const resolved = yield* resolve(modules, pre, post, operations, true, running, {
          retained,
          attempts,
          signatures,
        })
        if (current !== generation) return
        retained = resolved.retained
        running = resolved.packages
        packages = targets(resolved)
        yield* apply(resolved)
        yield* check(current, resolved)
      }).pipe(Effect.forkScoped({ startImmediately: true }))
    })
    // Start source consumers before activation, without an extra merge/debounce boundary delaying them.
    // Each source owns its upstream subscriptions; the queue retains the latest observed request.
    const triggers = yield* Queue.sliding<number>(1)
    // Make accepted work visible to awaitActivation before coalescing the burst.
    const notify = Effect.gen(function* () {
      observed++
      if (!release) release = yield* registry.hold()
      yield* Queue.offer(triggers, observed)
    })
    const watch = <A>(stream: Stream.Stream<A>) =>
      stream.pipe(
        Stream.runForEach(() => notify),
        Effect.forkScoped({ startImmediately: true }),
      )
    // A file change is a user's intent to reload, so it clears the signatures that would otherwise keep a failed
    // target inside its backoff window. `attempts` is keyed by an operation signature that ignores helper files, so a
    // helper fix leaves it unchanged; clearing the signatures makes the next `resolve` treat every target as new and
    // delete its backoff. Configured source reads and watched module files both count as user edits. The periodic
    // refresh below stays inside the backoff: it is not an edit.
    const reloaded = <A>(stream: Stream.Stream<A>) =>
      stream.pipe(Stream.tap(() => Effect.sync(() => signatures.clear())))
    yield* watch(reloaded(sources.changes()))
    yield* watch(reloaded(modules.changes()))
    yield* watch(Stream.fromEffectRepeat(Effect.sleep("24 hours")))
    yield* watch(bus.subscribe([Event.Updated, SdkPlugins.Updated]))
    yield* watch(
      updates.changes().pipe(
        Stream.filter((update) => packages.has(update.target)),
        Stream.tap((update) =>
          Effect.sync(() => {
            update.outdated ? outdated.add(update.target) : outdated.delete(update.target)
            update.updating ? updating.add(update.target) : updating.delete(update.target)
          }),
        ),
      ),
    )
    // Run initial activation immediately; debounce only later requests. One consumer serializes both.
    yield* Stream.concat(Stream.succeed(0), Stream.fromQueue(triggers).pipe(Stream.debounce("100 millis"))).pipe(
      Stream.runForEach((target) =>
        Effect.gen(function* () {
          yield* activate().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload plugins", { cause })))
          if (observed !== target) return
          const settled = release
          release = undefined
          if (settled) yield* settled
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )

    return Service.of({
      // The same trigger path every source change uses: no second activation chain, and the queue coalesces a retry
      // with the reloads already waiting.
      retry: (target) =>
        Effect.gen(function* () {
          attempts.delete(target)
          signatures.delete(target)
          yield* notify
        }),
    })
  }),
)

const nodeDeps = [
  Plugin.node,
  SdkPlugins.node,
  InstancePlugins.node,
  ConfigPluginSource.node,
  PluginUpdate.node,
  Bus.node,
  Npm.node,
  Watcher.node,
  PluginInternal.requirements,
] as const

export const node = makeLocationNode({ service: Service, layer, deps: nodeDeps })

/** An inert supervisor: no activation, and a retry that does nothing. */
export const empty = Layer.succeed(Service, Service.of({ retry: () => Effect.void }))
