import { describe, expect } from "bun:test"
import path from "node:path"
import { Deferred, Duration, Effect, Layer, LayerMap, Stream } from "effect"
import { TestClock } from "effect/testing"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { define } from "@opencode/plugin/effect/plugin"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Npm } from "@opencode/util/npm"
import { AISDK } from "@opencode/core/aisdk"
import { Command } from "@opencode/core/command"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Instance } from "@opencode/core/instance"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { AbsolutePath } from "@opencode/core/schema"
import { Database } from "../../src/database/database"
import { Bus } from "../../src/bus"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { advance } from "../lib/clock"
import { testEffect } from "../lib/effect"

const id = Plugin.ID.make("account-prompts")

// Host and instance plugins share one ID; each registers a distinct command so the winner is observable.
const greeter = (command: string, plugin: string = id) =>
  define({
    id: plugin,
    effect: (ctx) =>
      ctx.command.transform((editor) => editor.add({ name: command, execute: () => Effect.void })).pipe(Effect.asVoid),
  })

// Every supervisor activation scans the config plugin operations once, so counting scans counts activations.
const source: { activations: number; operations: ConfigPluginSource.Operation[] } = { activations: 0, operations: [] }
const sourceLayer = Layer.succeed(
  ConfigPluginSource.Service,
  ConfigPluginSource.Service.of({
    operations: () =>
      Effect.sync(() => {
        source.activations++
        return source.operations
      }),
    changes: () => Stream.never,
  }),
)

// Package resolution and installs are driven by the test: `resolveDirectory` is what a package target reports as
// installed (empty keeps it pending), and `installDirectory` is where `add` lands (empty makes it fail).
// Package resolution and installs are driven by the test: `resolveDirectory` is what a package target reports as
// already installed (empty keeps it pending for the background install), `installDirectory` is where `add` lands
// (empty makes it fail), and a `gate` holds an install open.
const npm = {
  resolves: 0,
  installs: 0,
  resolveDirectory: "",
  installDirectory: "",
  gate: undefined as Deferred.Deferred<void> | undefined,
}

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const map = yield* LayerMap.make(
      (ref: Location.Ref) =>
        Instance.layer(ref, { discovery: false, plugins: [greeter("instance-greet")], replacements: bindings }),
      { idleTimeToLive: Duration.infinity },
    )
    const bindings: LayerNode.Replacements = [
      Global.node.replace(tempGlobalLayer),
      offlineModels,
      ConfigPluginSource.node.replace(sourceLayer),
      Npm.node.replace(
        Layer.succeed(
          Npm.Service,
          Npm.Service.of({
            add: (pkg) =>
              Effect.gen(function* () {
npm.installs++
                if (!npm.installDirectory)
                  return yield* Effect.fail(
                    new Npm.InstallFailedError({
                      add: [pkg],
                      dir: "",
                      cause: new Error(`Cannot install ${pkg}`),
                    }),
                  )
                if (npm.gate) yield* Deferred.await(npm.gate)
                return { directory: npm.installDirectory, name: pkg }
              }),
            resolve: (name) =>
              Effect.sync(() => {
npm.resolves++
                return { directory: npm.resolveDirectory, name }
              }),
            check: () => Effect.succeed(false),
            update: (pkg) =>
              Effect.fail(
                new Npm.InstallFailedError({
                  add: [pkg],
                  dir: "",
                  cause: new Error(`Unexpected Npm.update(${pkg})`),
                }),
              ),
            which: () => Effect.undefined,
          }),
        ),
      ),
      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      Instance.node.replace(
        Layer.succeed(Instance.Service, {
          provide: (session) => Effect.provide(map.get(session.location)),
        }),
      ),
    ]
    return map
  }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    LocationServiceMap.node.replace(instances),
  ]),
)

describe("PluginSupervisor", () => {
  it.live("reports a duplicate plugin ID as a failure without dropping the generation", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      yield* sdk.register(greeter("host-greet"))
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const state = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        const commands = yield* Command.Service
        return {
          inventory: yield* plugins.list(),
          host: yield* commands.get("host-greet"),
          instance: yield* commands.get("instance-greet"),
        }
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )

      // Earlier boot order wins: the host SDK plugin activates and the instance copy is reported.
      expect(state.inventory.filter((plugin) => plugin.id === id)).toEqual([
        { id, source: { type: "sdk" }, state: { status: "active" }, features: { server: true } },
        {
          id,
          source: { type: "sdk" },
          state: { status: "failed", error: `Duplicate plugin ID: ${id}` },
          features: { server: true },
        },
      ])
      expect(state.host).toBeDefined()
      expect(state.instance).toBeUndefined()
      // Builtins stay active: the duplicate is a plugin failure, not a generation defect.
      expect(
        state.inventory.some((plugin) => plugin.id?.startsWith("opencode.") && plugin.state.status === "active"),
      ).toBe(true)
    }),
  )

  it.effect("activates the initial generation without waiting for the reload debounce", () =>
    Effect.gen(function* () {
      source.activations = 0
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        // The TestClock never advances here, so any timer between boot and the first activation would hang this.
        yield* plugins.awaitActivation
        expect(yield* commands.get("instance-greet")).toBeDefined()
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(source.activations).toBe(1)
    }),
  )

  it.effect("refreshes every 24 hours without adding an immediate reload", () =>
    Effect.gen(function* () {
      source.activations = 0
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
        yield* TestClock.adjust("23 hours")
        expect(source.activations).toBe(1)

        yield* TestClock.adjust("1 hour")
        yield* advance(() => source.activations === 2)
        yield* plugins.awaitActivation

        yield* TestClock.adjust("24 hours")
        yield* advance(() => source.activations === 3)
        yield* plugins.awaitActivation
        expect(source.activations).toBe(3)
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
    }),
  )

  it.effect("reloads for a trigger published while the initial generation is activating", () =>
    Effect.gen(function* () {
      source.activations = 0
      const sdk = yield* SdkPlugins.Service
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      yield* sdk.register(
        define({
          id: "gated",
          effect: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate))),
        }),
      )
      let late = false
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        yield* Deferred.await(entered)
        // Generation 0 is mid-setup: the reload feed must already be subscribed for this update to count.
        yield* sdk.register(
          define({
            id: "late",
            effect: (ctx) =>
              ctx.command
                .transform((editor) => editor.add({ name: "late-greet", execute: () => Effect.void }))
                .pipe(Effect.tap(() => Effect.sync(() => (late = true)))),
          }),
        )
        yield* Deferred.succeed(gate, undefined)
        yield* advance(() => late)
        yield* plugins.awaitActivation
        expect(yield* commands.get("late-greet")).toBeDefined()
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(source.activations).toBe(2)
    }),
  )

  for (const targets of [["opencode.config.policy", "opencode.provider.opencode", "opencode.config.agent"], ["*"]]) {
    it.effect(`keeps policy enforcement and the Console connection through plugin removals: ${targets}`, () =>
      Effect.gen(function* () {
        source.operations = targets.map((target) => ({ type: "remove", target }))
        const directory = yield* tmpdirScoped()
        const locations = yield* LocationServiceMap.Service
        const inventory = yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          return yield* plugins.list()
        }).pipe(
          Effect.scoped,
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        )
        const status = (id: string) => inventory.find((plugin) => plugin.id === id)?.state.status
        expect(status("opencode.config.policy")).toBe("active")
        expect(status("opencode.provider.opencode")).toBe("active")
        // Removals still apply to everything else, including instance and builtin plugins.
        expect(status("opencode.config.agent")).toBeUndefined()
        expect(inventory.some((plugin) => plugin.id === id)).toBe(targets[0] !== "*")
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            source.operations = []
          }),
        ),
      ),
    )
  }

  it.effect("coalesces a burst of reload triggers after the initial generation into one activation", () =>
    Effect.gen(function* () {
      source.activations = 0
      const sdk = yield* SdkPlugins.Service
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        yield* plugins.awaitActivation
        expect(source.activations).toBe(1)

        yield* sdk.register(greeter("greet-a", "a"))
        yield* sdk.register(greeter("greet-b", "b"))
        yield* sdk.register(greeter("greet-c", "c"))
        yield* advance(() => source.activations > 1)
        yield* plugins.awaitActivation
        expect(yield* commands.get("greet-a")).toBeDefined()
        expect(yield* commands.get("greet-c")).toBeDefined()
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(source.activations).toBe(2)
    }),
  )

  it.effect("reloads all booted locations when sdk.register is called inside a location context", () =>
    Effect.gen(function* () {
      source.activations = 0
      const sdk = yield* SdkPlugins.Service
      const dirA = yield* tmpdirScoped()
      const dirB = yield* tmpdirScoped()
      const refA = Location.Ref.make({ directory: AbsolutePath.make(dirA.path) })
      const refB = Location.Ref.make({ directory: AbsolutePath.make(dirB.path) })
      const locations = yield* LocationServiceMap.Service

      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
      }).pipe(Effect.provide(locations.get(refA)))

      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        yield* plugins.awaitActivation
      }).pipe(Effect.provide(locations.get(refB)))

      expect(source.activations).toBe(2)

      yield* sdk
        .register(greeter("greet-cross-location", "cross-location"))
        .pipe(Effect.provide(locations.get(refA)))

      yield* advance(() => source.activations === 4)

      for (const ref of [refA, refB]) {
        const command = yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const commands = yield* Command.Service
          yield* plugins.awaitActivation
          return yield* commands.get("greet-cross-location")
        }).pipe(Effect.provide(locations.get(ref)))
        expect(command).toBeDefined()
      }
    }),
  )

  it.effect("runs SDK plugin aisdk.sdk hooks before the dynamic npm fallback", () =>
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      const providerID = Provider.ID.make("cloudflare")
      const fakeLanguageModel: LanguageModelV3 = {
        specificationVersion: "v3",
        provider: "cloudflare",
        modelId: "workers-ai",
        supportedUrls: {},
        doGenerate: () => Promise.reject(new Error("unused")),
        doStream: () => Promise.reject(new Error("unused")),
      }
      yield* sdk.register(
        define({
          id: "cloudflare.aisdk",
          effect: (ctx) =>
            ctx.aisdk
              .hook(
                "sdk",
                (evt) => {
                  if (evt.package !== "agents/models/opencode") return Effect.void
                  evt.sdk = { languageModel: () => fakeLanguageModel }
                  return Effect.void
                },
                { providerID },
              )
              .pipe(Effect.asVoid),
        }),
      )
      const directory = yield* tmpdirScoped()
      const locations = yield* LocationServiceMap.Service
      const language = yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* plugins.awaitActivation
        return yield* aisdk.language(
          Model.Info.make({
            ...Model.Info.default(providerID, Model.ID.make("workers-ai")),
            modelID: Model.ID.make("workers-ai"),
            package: "aisdk:agents/models/opencode",
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
      expect(language).toBe(fakeLanguageModel)
    }),
  )

  it.live("activates local plugins before a package install finishes", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      // Real installs land under node_modules, so entry resolution by package name works from the returned directory.
      const packageDir = path.join(directory.path, "installed", "node_modules", "acme-pkg-plugin")
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(
            path.join(packageDir, "package.json"),
            JSON.stringify({ name: "acme-pkg-plugin", type: "module", main: "index.js" }),
          ),
          Bun.write(
            path.join(packageDir, "index.js"),
            `export default {
  id: "pkg-plugin",
  effect: (ctx) => ctx.command.transform((editor) => editor.add({ name: "pkg-greet", execute: () => {} })),
}`,
          ),
        ]),
      )

      const gate = yield* Deferred.make<void>()
      // A directory without an entrypoint: the first pass reports the package as pending, and the install supplies the
      // real directory with the plugin's code.
      const resolvedDir = path.join(directory.path, "resolved")
      yield* Effect.promise(() => Bun.write(path.join(resolvedDir, "package.json"), "{}"))
      npm.resolveDirectory = resolvedDir
      npm.installDirectory = packageDir
      npm.gate = gate
      source.operations = [{ type: "add", target: "acme-pkg-plugin", options: {} }]
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          npm.installDirectory = ""
          npm.gate = undefined
          source.operations = []
        }),
      )

      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const commands = yield* Command.Service

        // Activation returned although the install is still waiting: local plugins already serve, and the package
        // plugin is not listed yet.
        expect(yield* waitFor(commands.get("instance-greet"))).toBeDefined()
        expect(yield* commands.get("pkg-greet")).toBeUndefined()
        yield* waitUntil(() => npm.installs === 1)

        yield* Deferred.succeed(gate, undefined)
        expect(yield* waitFor(commands.get("pkg-greet"))).toBeDefined()
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
    }),
    { timeout: 20_000 },
  )

  it.effect("backs off a failing package and forgets the backoff after a successful load", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const packageDir = path.join(directory.path, "installed", "node_modules", "acme-broken-pkg")
      yield* Effect.promise(() =>
        Promise.all([
          Bun.write(
            path.join(packageDir, "package.json"),
            JSON.stringify({ name: "acme-broken-pkg", type: "module", main: "index.js" }),
          ),
          Bun.write(path.join(packageDir, "index.js"), 'export default { id: "broken-pkg", setup() {} }'),
        ]),
      )

      source.activations = 0
      npm.resolves = 0
      npm.installs = 0
      // A directory without an entrypoint keeps every pass on the install path, where `add` is what fails.
      const resolvedDir = path.join(directory.path, "resolved")
      yield* Effect.promise(() => Bun.write(path.join(resolvedDir, "package.json"), "{}"))
      npm.resolveDirectory = resolvedDir
      npm.installDirectory = ""
      source.operations = [{ type: "add", target: "acme-broken-pkg", options: {} }]
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          npm.resolveDirectory = ""
          npm.installDirectory = ""
          source.operations = []
        }),
      )

      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const sdk = yield* SdkPlugins.Service
        const failures = () =>
          plugins.list().pipe(
            Effect.map((inventory) => inventory.filter((plugin) => plugin.state.status === "failed").length),
          )
        // The backoff windows are seconds wide, so advance virtual time only far enough for the debounced trigger
        // (100ms) or a background install to land, and step past a window explicitly below.
        const tick = (condition: () => boolean) =>
          Effect.gen(function* () {
            for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)))
              yield* TestClock.adjust("100 millis")
            }
          })

        yield* tick(() => source.activations > 0)
        yield* tick(() => npm.installs === 1)
        const waitFailed = (count: number) =>
          Effect.gen(function* () {
            for (let attempt = 0; attempt < 100; attempt++) {
              if ((yield* failures()) === count) return
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)))
              yield* TestClock.adjust("100 millis")
            }
            return yield* Effect.die(new Error(`failure count ${count} was never recorded`))
          })
        yield* waitFailed(1)

        // A fresh activation whose install is still due; the package id is a new SDK plugin each time.
        const reload = (name: string) =>
          Effect.gen(function* () {
            const before = source.activations
            yield* sdk.register(greeter(`backoff-${name}`, name))
            yield* tick(() => source.activations > before)
          })

        // The first failure opened a 2s window: the next activation does not install or import the package again.
        yield* reload("a")
        expect(npm.installs).toBe(1)
        expect(yield* failures()).toBe(1)

        yield* TestClock.adjust("2 seconds")
        yield* reload("b")
        yield* tick(() => npm.installs === 2)
        expect(npm.installs).toBe(2)

        yield* TestClock.adjust("4 seconds")
        yield* reload("c")
        yield* tick(() => npm.installs === 3)
        expect(npm.installs).toBe(3)

        // The third failure opened an 8s window: a retry inside it still skips the load.
        yield* reload("d")
        expect(npm.installs).toBe(3)

        // Installing a working package and waiting out the window clears the record.
        yield* TestClock.adjust("8 seconds")
        npm.installDirectory = packageDir
        yield* reload("e")
        yield* tick(() => npm.installs === 4)
        expect(npm.installs).toBe(4)
        yield* waitFailed(0)
        expect(yield* failures()).toBe(0)

        // A successful load left no backoff: the next activation installs again right away.
        yield* reload("f")
        yield* tick(() => npm.installs === 5)
        expect(npm.installs).toBe(5)
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
    }),
  )
})

/** Polls until the effect reports a value; loading an installed package finishes after its activation returned. */
const waitFor = <A>(effect: Effect.Effect<A | undefined>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 300; attempt++) {
      const value = yield* effect
      if (value !== undefined) return value
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.die(new Error("plugin did not become available"))
  })

/** Polls a synchronous condition on the real clock, for state a background fiber updates. */
const waitUntil = (condition: () => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (condition()) return
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.die(new Error("condition never held"))
  })
