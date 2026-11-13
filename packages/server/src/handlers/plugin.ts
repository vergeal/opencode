import { Plugin } from "@opencode/core/plugin"
import { App } from "@opencode/core/app"
import { PluginBundle } from "@opencode/core/plugin/bundle"
import { PluginInbox } from "@opencode/core/plugin/inbox"
import { PluginLocal } from "@opencode/core/plugin/local"
import { PluginSupervisor } from "@opencode/core/plugin/supervisor"
import { PluginUpdate } from "@opencode/core/plugin/update"
import { Global } from "@opencode/util/global"
import { InvalidRequestError, PluginNotFoundError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Cause, Effect, Exit } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { KV } from "@opencode/core/kv"
import { Api } from "../api"
import { response } from "../location"

export const PluginHandler = HttpApiBuilder.group(Api, "server.plugin", (handlers) =>
  handlers
    .handle("plugin.list", () =>
      Effect.gen(function* () {
        return yield* response(Plugin.Service.use((plugin) => plugin.list()))
      }),
    )
    .handle("plugin.gui", (ctx) =>
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const bundle = yield* plugins.gui(ctx.query.id)
        if (!bundle)
          return yield* new PluginNotFoundError({
            pluginID: ctx.query.id,
            message: `No active plugin with a ./gui-experimental bundle: ${ctx.query.id}`,
          })
        return yield* response(Effect.succeed(bundle))
      }),
    )
    .handle("plugin.reload", (ctx) =>
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const inventory = yield* plugins.list()
        const plugin = inventory.find((entry) => entry.id === ctx.payload.id)
        if (!plugin)
          return yield* new PluginNotFoundError({
            pluginID: ctx.payload.id,
            message: `Plugin is not in the current server inventory: ${ctx.payload.id}`,
          })
        // A retry clears this target's backoff and asks the supervisor to activate again; the trigger queue coalesces it
        // with any reload already waiting, so this never starts a second activation chain.
        const supervisor = yield* PluginSupervisor.Service
        yield* supervisor.retry(
          plugin.source.type === "package"
            ? plugin.source.target
            : plugin.source.type === "local"
              ? plugin.source.path
              : ctx.payload.id,
        )
        return yield* response(Effect.succeed({ id: ctx.payload.id }))
      }),
    )
    .handle("plugin.runtimeRetry", (ctx) =>
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const inventory = yield* plugins.list()
        const plugin = inventory.find((entry) => entry.id === ctx.payload.id)
        if (!plugin?.runtime)
          return yield* new PluginNotFoundError({
            pluginID: ctx.payload.id,
            message: `Plugin is not in the current server inventory with a runtime: ${ctx.payload.id}`,
          })
        // Retrying prepares the environment only: the plugin stays loaded, and the status changes arrive through
        // Plugin.Event.Updated like any other inventory change.
        yield* plugins.runtimeRetry(ctx.payload.id)
        return yield* response(Effect.succeed({ id: ctx.payload.id }))
      }),
    )
    .handle("plugin.inbox.list", () =>
      Effect.gen(function* () {
        const kv = yield* KV.Service
        return yield* response(PluginInbox.list(kv))
      }),
    )
    .handle("plugin.inbox.mark", (ctx) =>
      Effect.gen(function* () {
        const kv = yield* KV.Service
        yield* PluginInbox.mark(kv, ctx.payload.id)
      }),
    )
    .handle("plugin.inbox.delete", (ctx) =>
      Effect.gen(function* () {
        const kv = yield* KV.Service
        yield* PluginInbox.remove(kv, ctx.payload.id)
      }),
    )
    .handle("plugin.check", (ctx) =>
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const inventory = yield* plugins.list()
        const targets = [
          ...new Set(inventory.flatMap((plugin) => (plugin.source.type === "package" ? [plugin.source.target] : []))),
        ].filter((target) => ctx.payload.target === undefined || target === ctx.payload.target)
        if (ctx.payload.target !== undefined && !targets.length)
          return yield* new InvalidRequestError({
            message: `Plugin package is not in the current server inventory: ${ctx.payload.target}`,
            field: "target",
          })
        const updates = yield* PluginUpdate.Service
        const outdated = new Map(
          yield* Effect.forEach(
            targets,
            (target) => updates.check(target, { refresh: true }).pipe(Effect.map((value) => [target, value] as const)),
            { concurrency: "unbounded" },
          ),
        )
        return yield* response(
          Effect.succeed(
            inventory.map((plugin) => {
              if (plugin.source.type !== "package" || !outdated.has(plugin.source.target)) return plugin
              return {
                ...plugin,
                source: {
                  type: "package" as const,
                  target: plugin.source.target,
                  ...(plugin.source.version ? { version: plugin.source.version } : {}),
                  ...(outdated.get(plugin.source.target) ? { outdated: true as const } : {}),
                  ...(plugin.source.updating ? { updating: true as const } : {}),
                },
              }
            }),
          ),
        )
      }),
    )
    .handle("plugin.local", () =>
      Effect.gen(function* () {
        const global = yield* Global.Service
        const entries = yield* Effect.promise(() => PluginLocal.list({ home: global.home }))
        return yield* response(Effect.succeed(entries))
      }),
    )
    .handle("plugin.bundle", (ctx) =>
      Effect.gen(function* () {
        const global = yield* Global.Service
        const app = yield* App.Metadata
        const installed = yield* Effect.tryPromise({
          try: () =>
            PluginBundle.install({
              id: ctx.payload.id,
              version: ctx.payload.version,
              config: global.config,
              cwd: process.cwd(),
              home: global.home,
              opencodeVersion: app.version,
            }),
          catch: (error) =>
            new InvalidRequestError({
              message: error instanceof Error ? error.message : String(error),
              field: "id",
            }),
        })
        // The install only wrote files. Wait for the plugin source to reload and activate so every session's next
        // step and this response observe the same settled inventory.
        yield* settle(ctx.payload.id, true)
        return yield* response(Effect.succeed({ ...installed, id: ctx.payload.id }))
      }),
    )
    .handle("plugin.uninstall", (ctx) =>
      Effect.gen(function* () {
        const global = yield* Global.Service
        const plugins = yield* Plugin.Service
        // Run the plugin's own cleanup while its files still exist; the directory is removed next.
        yield* plugins.uninstall(Plugin.ID.make(ctx.payload.id))
        const removed = yield* Effect.tryPromise({
          try: () => PluginBundle.uninstall({ id: ctx.payload.id, home: global.home, config: global.config }),
          catch: (error) =>
            new InvalidRequestError({
              message: error instanceof Error ? error.message : String(error),
              field: "id",
            }),
        })
        yield* settle(ctx.payload.id, false)
        return yield* response(Effect.succeed({ ...removed, id: ctx.payload.id }))
      }),
    )
    .handle("plugin.update", (ctx) =>
      Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const inventory = new Set(
          (yield* plugins.list()).flatMap((plugin) => (plugin.source.type === "package" ? [plugin.source.target] : [])),
        )
        const unknown = ctx.payload.targets.filter((target) => !inventory.has(target))
        if (unknown.length)
          return yield* new InvalidRequestError({
            message: `Plugin packages are not in the current server inventory: ${unknown.join(", ")}`,
            field: "targets",
          })
        const updates = yield* PluginUpdate.Service
        // Let every update run to completion instead of interrupting the rest on the first failure.
        const failures = yield* Effect.forEach(
          ctx.payload.targets,
          (target) =>
            updates.update(target).pipe(
              Effect.exit,
              Effect.map((exit) => (Exit.isFailure(exit) ? [`${target}: ${Cause.pretty(exit.cause)}`] : [])),
            ),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((results) => results.flat()))
        if (failures.length)
          return yield* new ServiceUnavailableError({
            message: `Failed to update plugin packages: ${failures.join("; ")}`,
            service: "plugin",
          })
      }),
    ),
)

/** Bounded wait until the plugin inventory reflects an install or uninstall, so callers never read the old state. */
function settle(pluginID: Plugin.ID, present: boolean) {
  return Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const listed = (yield* plugins.list()).some((plugin) => plugin.id === pluginID)
      if (listed === present) return
      yield* Effect.sleep(100)
    }
  })
}
