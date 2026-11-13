export * as Plugin from "./plugin.js"
export { Event, GuiBundle, ID, Info, Source, State } from "@opencode/schema/plugin"

import { mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { Global } from "@opencode/util/global"
import { PluginPaths } from "./plugin/paths.js"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/schema/plugin"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import type { PersistentPty } from "./persistent-pty.js"
import { Cause, Context, Duration, Effect, Exit, Latch, Layer, Logger, Queue, References, Scope, Semaphore } from "effect"
import { Bus } from "./bus.js"
import { PluginHost } from "./plugin/host.js"
import { PluginRuntime } from "./plugin/runtime.js"
import { type Failure, type Generation, Service } from "./plugin/service.js"
import { State } from "./state.js"

export { awaitActivation, type Failure, type Generation, type Interface, Service } from "./plugin/service.js"

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const global = yield* Global.Service
    const scope = yield* Scope.make()
    // One slot per requested definition in activation order, including ones whose setup failed, so
    // the prefix diff below stays index-aligned and a failed revision is not retried until it changes.
    const active = new Map<Plugin.ID, Slot>()
    // Ids loaded in this process, so re-enabling after a disable is a load, not a first install.
    const known = new Set<Plugin.ID>()
    const lock = Semaphore.makeUnsafe(1)
    const ready = yield* Latch.make(true)
    const pending = new Set<object>()
    let closed = false
    const holdUnsafe = () => {
      if (closed) return Effect.void
      const token = {}
      pending.add(token)
      ready.closeUnsafe()
      return Effect.sync(() => {
        if (pending.delete(token) && pending.size === 0) ready.openUnsafe()
      })
    }
    const hold = () => Effect.sync(holdUnsafe)
    const pendingFailures = yield* Queue.unbounded<PendingFailure>()
    let discovered: readonly Failure[] = []
    let inventory: Plugin.Info[] = []
    // Interpreter environments are per plugin id, not per activation: a reload keeps a ready environment, and an
    // `activate` that only sees unchanged revisions still re-checks it, so a manifest edited or a directory removed
    // outside the host is noticed on the next load.
    const runtimes = new Map<Plugin.ID, Plugin.Runtime>()
    const snapshot = () =>
      [...Array.from(active.values()).map((slot) => slotInfo(slot, runtimes.get(slot.plugin.id))), ...discovered]
    // A changed `./gui-experimental` bundle alone restarts nothing; its revision is part of what changes, so the event
    // tells the app to reload it.
    const publish = State.changes(
      (items: readonly Plugin.Info[]) => [items, Array.from(active.values(), (entry) => entry.plugin.gui?.revision)],
      () => bus.publish(Plugin.Event.Updated, {}).pipe(Effect.asVoid),
    )
    const list = Effect.fn("Plugin.list")(function* () {
      return inventory
    })
    // One preparation per plugin id at a time: a reload that lands while pip is running must not start a second one.
    const preparingRuntime = new Set<Plugin.ID>()
    const prepareRuntime = Effect.fn("Plugin.prepareRuntime")(function* (plugin: Generation & { readonly id: Plugin.ID }) {
      if (!plugin.runtime || preparingRuntime.has(plugin.id)) return
      const id = plugin.id
      preparingRuntime.add(id)
      const status = yield* PluginRuntime.prepare({ home: global.home, id, runtime: plugin.runtime }).pipe(
        Effect.catchCause((cause) =>
          Effect.succeed({ status: "failed" as const, error: Cause.pretty(cause), ref: `err_${id}` }),
        ),
      )
      preparingRuntime.delete(id)
      // Uninstall during preparation removes the environment, so finishing must not recreate it for a plugin that is
      // no longer loaded.
      if (!active.has(id)) {
        yield* Effect.promise(() =>
          rm(PluginRuntime.directory({ home: global.home, id }), { recursive: true, force: true }),
        )
        return
      }
      runtimes.set(id, status)
      // A prepared environment changes what the browser shows without restarting the plugin, so announce it like any
      // other inventory change.
      yield* lock.withPermit(
        Effect.gen(function* () {
          if (closed) return
          inventory = snapshot()
          yield* publish(inventory)
        }),
      )
    })
    // Detect cheaply and synchronously; only the slow work (creating the venv, installing) runs in the background.
    const ensureRuntime = Effect.fn("Plugin.ensureRuntime")(function* (plugin: Generation & { readonly id: Plugin.ID }) {
      if (!plugin.runtime) {
        runtimes.delete(plugin.id)
        return
      }
      const status = yield* PluginRuntime.detect({ home: global.home, id: plugin.id, runtime: plugin.runtime })
      if (status === "ready") {
        runtimes.set(plugin.id, { status: "ready" })
        return
      }
      runtimes.set(plugin.id, { status: "preparing" })
      yield* prepareRuntime(plugin).pipe(Effect.forkIn(scope))
    })
    const runtimeRetry = Effect.fn("Plugin.runtimeRetry")(function* (id: Plugin.ID) {
      const plugin = active.get(id)?.plugin
      if (!plugin?.runtime || preparingRuntime.has(id)) return
      runtimes.set(id, { status: "preparing" })
      yield* lock.withPermit(
        Effect.gen(function* () {
          if (closed) return
          inventory = snapshot()
          yield* publish(inventory)
        }),
      )
      yield* prepareRuntime(plugin).pipe(Effect.forkIn(scope))
    })
    const gui = Effect.fn("Plugin.gui")(function* (id: Plugin.ID) {
      const gui = active.get(id)?.plugin.gui
      if (!gui) return undefined
      // A plugin that resolved a `./gui-experimental` file but cannot read it now is a server fault, not a missing
      // bundle.
      const code = yield* Effect.promise(() => readFile(fileURLToPath(gui.file), "utf8"))
      return { code, revision: gui.revision, options: gui.options } satisfies Plugin.GuiBundle
    })
    const hostContext = yield* Effect.context<Effect.Services<ReturnType<typeof PluginHost.make>>>()
    const load = Effect.fnUntraced(function* (plugin: Generation, reason: "install" | "load") {
      const activation: Activation = { plugin, scope: yield* Scope.fork(scope) }
      const inherit = yield* State.inherit()
      const grouped = State.group((failure, refresh) => {
        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        activation.failure = {
          // The client renders `reason`; `error` stays as the log detail, which is what a bug report needs.
          error: Cause.pretty(Cause.die(failure.cause)),
          ref,
          reason: { kind: "transform-failed", state: failure.state },
        }
        Queue.offerUnsafe(pendingFailures, {
          plugin,
          scope: activation.scope,
          failure,
          refresh,
          ref,
          release: holdUnsafe(),
        })
      })
      // The host creates the plugin's directories before `activate`, so the entry never sees a missing path.
      const paths = PluginPaths.make({ home: global.home, id: plugin.id })
      yield* Effect.promise(async () => {
        await mkdir(paths.data, { recursive: true })
        await mkdir(paths.cache, { recursive: true })
        await mkdir(path.dirname(paths.log), { recursive: true })
      })
      const host = yield* PluginHost.make({ list }, plugin.id, {
        scope: activation.scope,
        configuration: plugin.configuration,
      }).pipe(Effect.provideContext(hostContext))
      const hook = reason === "install" ? plugin.onInstall : undefined
      // A hook shares the activation scope, so anything it registers is released with this instance.
      if (hook)
        yield* Effect.suspend(() => hook(host)).pipe(
          Effect.updateContext((context: Context.Context<never>) =>
            Context.make(Scope.Scope, activation.scope).pipe(
              Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
              Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
            ),
          ),
          Effect.timeout("3 seconds"),
          Effect.catchCause((cause) =>
            Effect.logWarning("plugin lifecycle hook failed", { "plugin.id": plugin.id, reason, cause }),
          ),
        )
      // The deadline is a timeout guard for an activation that *suspends in an interruptible way*: `Effect.timeout`
      // races the activation against a sleep and interrupts the loser, so `Effect.never` and `Effect.sleep` unwind.
      // It cannot stop a synchronous loop (it blocks the thread) or a promise created outside Effect
      // (`Effect.promise(() => new Promise(() => {}))` is not interruptible); those need worker isolation, which is
      // out of scope here. Thirty seconds because probing a port or fetching remote configuration at activation is
      // legitimate and slower than a few seconds; disabling a merely slow plugin would be a false failure.
      const exit = yield* Effect.suspend(() => plugin.effect(host)).pipe(
        grouped,
        inherit,
        Effect.updateContext((context: Context.Context<never>) =>
          Context.make(Scope.Scope, activation.scope).pipe(
            Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
            Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
          ),
        ),
        Effect.withSpan("Plugin.load", { attributes: { "plugin.id": plugin.id } }),
        Effect.timeout(ACTIVATION_TIMEOUT),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && !activation.failure ? Scope.close(activation.scope, exit) : Effect.void,
        ),
        Effect.exit,
      )
      if (activation.failure || Exit.isSuccess(exit)) return { activation } as const
      yield* Effect.logWarning("failed to load plugin", {
        "plugin.id": plugin.id,
        cause: exit.cause,
      })
      // A timed-out activation is a plugin fault, not a broken package: disable it with a reason the client can
      // translate, instead of failing the target and waiting out its backoff.
      if (Cause.squash(exit.cause) instanceof Cause.TimeoutError) {
        activation.failure = {
          error: `Plugin activation did not finish within ${ACTIVATION_TIMEOUT_SECONDS}s`,
          ref: `err_${crypto.randomUUID().slice(0, 8)}`,
          reason: { kind: "activation-timeout", seconds: ACTIVATION_TIMEOUT_SECONDS },
        }
        return { activation } as const
      }
      return {
        error: Cause.pretty(exit.cause),
        ref: `err_${crypto.randomUUID().slice(0, 8)}`,
        reason: { kind: "load-failed" as const },
      } as const
    })

    const activate = Effect.fn("Plugin.activate")(function* (
      plugins: readonly Generation[],
      failures: readonly Failure[] = [],
    ) {
      const definitions = plugins.map((plugin) => ({ ...plugin, id: Plugin.ID.make(plugin.id) }))
      const ids = new Set<Plugin.ID>()
      for (const definition of definitions) {
        if (ids.has(definition.id)) yield* Effect.die(new Error(`Duplicate plugin ID: ${definition.id}`))
        ids.add(definition.id)
      }

      yield* Effect.acquireUseRelease(
        hold(),
        () =>
          lock.withPermit(
            Effect.gen(function* () {
              if (closed) return
              discovered = failures
              const current = Array.from(active.values())
              const changed = definitions.findIndex((definition, index) => {
                const entry = current[index]
                return entry?.plugin.id !== definition.id || entry.plugin.revision !== definition.revision
              })
              const prefix = changed === -1 ? definitions.length : changed
              for (const definition of definitions.slice(0, prefix)) {
                const entry = active.get(definition.id)
                if (entry) active.set(definition.id, { ...entry, plugin: definition })
              }
              if (prefix === definitions.length && active.size === definitions.length) {
                yield* Effect.forEach(definitions, ensureRuntime, { discard: true })
                inventory = snapshot()
                yield* publish(inventory)
                return
              }

              yield* State.batch(
                Effect.gen(function* () {
                  // Registrations are ordered by setup, so only the unchanged prefix can stay alive.
                  const previous = new Map(Array.from(active.entries()).slice(prefix))
                  yield* Effect.forEach(
                    Array.from(previous.entries()).toReversed(),
                    ([id, slot]) =>
                      Effect.gen(function* () {
                        active.delete(id)
                        if (slot.activation && !slot.activation.failure)
                          yield* Scope.close(slot.activation.scope, Exit.void)
                      }),
                    { discard: true },
                  )
                  for (const definition of definitions.slice(prefix)) {
                    const slot = previous.get(definition.id)
                    // Reordering healthy registrations does not authorize retrying a failed revision.
                    if (slot?.activation?.failure && slot.plugin.revision === definition.revision) {
                      active.set(definition.id, { ...slot, plugin: definition })
                      continue
                    }
                    const reason = known.has(definition.id) ? "load" : "install"
                    known.add(definition.id)
                    const result = yield* load(definition, reason)
                    if ("activation" in result) {
                      active.set(definition.id, {
                        plugin: definition,
                        activation: result.activation,
                      })
                      continue
                    }
                    active.set(definition.id, { plugin: definition, error: result })

                    const fallback = slot?.activation
                    if (!fallback || fallback.failure) continue
                    const restored = yield* load(fallback.plugin, "load")
                    if ("activation" in restored) {
                      active.set(definition.id, {
                        plugin: definition,
                        activation: restored.activation,
                        error: result,
                      })
                      continue
                    }
                    yield* Effect.logError("failed to restore plugin; deactivating", {
                      "plugin.id": definition.id,
                    })
                  }

                  yield* Effect.forEach(definitions, ensureRuntime, { discard: true })
                  inventory = snapshot()
                }),
              )
              yield* publish(inventory)
            }),
          ),
        (release) => release,
      )
    })

    const uninstall = Effect.fn("Plugin.uninstall")(function* (id: Plugin.ID) {
      yield* lock.withPermit(
        Effect.gen(function* () {
          if (closed) return
          const slot = active.get(id)
          if (!slot) return
          const activation = slot.activation
          if (!activation || activation.failure) return
          const hook = slot.plugin.onUninstall
          if (hook) {
            // The host is rebuilt for the hook: it is a plain value, and the running instance is still active.
            const host = yield* PluginHost.make({ list }, id, {
              scope: activation.scope,
              configuration: slot.plugin.configuration,
            }).pipe(Effect.provideContext(hostContext))
            yield* Effect.suspend(() => hook(host)).pipe(
              Effect.updateContext((context: Context.Context<never>) =>
                Context.make(Scope.Scope, activation.scope).pipe(
                  Context.add(Logger.CurrentLoggers, Context.get(context, Logger.CurrentLoggers)),
                  Context.add(References.MinimumLogLevel, Context.get(context, References.MinimumLogLevel)),
                ),
              ),
              Effect.timeout("3 seconds"),
              Effect.catchCause((cause) => Effect.logWarning("plugin onUninstall failed", { "plugin.id": id, cause })),
            )
          }
          active.delete(id)
          runtimes.delete(id)
          preparingRuntime.delete(id)
          yield* Scope.close(activation.scope, Exit.void)
          // `data` and `log` outlive the plugin; the rebuildable cache and interpreter environment do not.
          const paths = PluginPaths.make({ home: global.home, id })
          yield* Effect.promise(() =>
            Promise.all(
              [paths.cache, paths.runtime].map((directory) => rm(directory, { recursive: true, force: true })),
            ),
          )
          inventory = snapshot()
          yield* publish(inventory)
        }),
      )
    })

    yield* Queue.take(pendingFailures).pipe(
      Effect.flatMap((item) =>
        Effect.gen(function* () {
          yield* Effect.logWarning("disabled plugin after transform failure", {
            "plugin.id": item.plugin.id,
            state: item.failure.state,
            ref: item.ref,
            cause: Cause.die(item.failure.cause),
          })
          yield* lock.withPermit(
            Effect.gen(function* () {
              if (closed) return
              // Failure is already recorded on its exact activation, so an old queued item
              // cannot disable a replacement and teardown need not wait for this worker.
              inventory = snapshot()
              const refreshed = yield* State.batch(item.refresh).pipe(Effect.exit)
              yield* publish(inventory)
              if (Exit.isFailure(refreshed))
                yield* Effect.logWarning("failed to refresh state after disabling plugin", {
                  "plugin.id": item.plugin.id,
                  ref: item.ref,
                  cause: refreshed.cause,
                })
            }),
          )
        }).pipe(
          // Cleanup must also be scheduled if an inventory observer fails. User finalizers
          // may await readiness, so never join them under the activation lock or readiness hold.
          Effect.ensuring(
            Scope.close(item.scope, Exit.void).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to clean up disabled plugin", {
                  "plugin.id": item.plugin.id,
                  ref: item.ref,
                  cause,
                }),
              ),
              Effect.forkScoped({ startImmediately: true }),
            ),
          ),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) =>
              Effect.logError("failed to report disabled plugin", {
                "plugin.id": item.plugin.id,
                ref: item.ref,
                cause,
              }),
          ),
          Effect.ensuring(item.release),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    )

    const close = (exit: Exit.Exit<unknown, unknown>) =>
      lock.withPermit(
        Effect.gen(function* () {
          closed = true
          pending.clear()
          ready.openUnsafe()
          active.clear()
          yield* State.shutdown(Scope.close(scope, exit))
        }),
      )
    yield* Effect.addFinalizer(close)

    return Service.of({
      activate,
      close,
      awaitActivation: ready.await,
      hold,
      list,
      gui,
      uninstall,
      runtimeRetry,
    })
  }),
)

// `plugin` is the requested definition; `activation` is its last activation, which may have
// failed or be an older fallback while the requested revision keeps failing setup.
type Slot = {
  readonly plugin: Generation & { readonly id: Plugin.ID }
  readonly activation?: Activation
  readonly error?: FailureInfo
}

/** The failed half of `Plugin.State`, shared by an activation and a target that never loaded. */
type FailureInfo = {
  readonly error: string
  readonly ref?: string
  readonly reason?: Plugin.Reason
}

/**
 * How long an activation may suspend before its load is reported as a timeout. The module import already has a
 * deadline; this one covers the user code, which otherwise holds the activation lock and stops every plugin after it.
 */
const ACTIVATION_TIMEOUT_SECONDS = 30
const ACTIVATION_TIMEOUT = Duration.seconds(ACTIVATION_TIMEOUT_SECONDS)

// Share the activation across slot snapshots so teardown sees failures synchronously,
// including failures discovered after activate() has captured its previous slots.
type Activation = {
  readonly plugin: Generation
  readonly scope: Scope.Closeable
  failure?: FailureInfo
}

type PendingFailure = {
  readonly plugin: Generation
  readonly scope: Scope.Closeable
  readonly failure: State.Failure
  readonly refresh: Effect.Effect<void>
  readonly ref: string
  readonly release: Effect.Effect<void>
}

function slotInfo(slot: Slot, runtime?: Plugin.Runtime): Plugin.Info {
  const failure = slot.activation?.failure ?? slot.error
  return {
    id: slot.plugin.id,
    source: slot.plugin.source ?? { type: "builtin" },
    state: failure === undefined ? { status: "active" } : { status: "failed", ...failure },
    // Built-in and SDK plugins are server parts; a package lists its own parts.
    features: slot.plugin.features ?? { server: true },
    // Only a plugin that declares display metadata appears in the app's plugin browser.
    ...(slot.plugin.display === undefined ? {} : { display: slot.plugin.display }),
    // Only a plugin whose manifest declares `runtime` has an environment, so the field stays absent for the rest.
    ...(runtime === undefined ? {} : { runtime }),
  }
}

export const node: LayerNode.Provider<Service, PersistentPty.UnavailableError, typeof Node.tags.values.location> =
  Node.makeLocationNode({
    service: Service,
    layer,
    deps: [PluginHost.requirements],
  })
