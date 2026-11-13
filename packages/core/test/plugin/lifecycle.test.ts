import { expect } from "bun:test"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { Plugin } from "@opencode/core/plugin"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const id = Plugin.ID.make("lifecycle-target")

const generation = (input: {
  readonly revision: string
  readonly setup?: () => void
  readonly onInstall?: () => Effect.Effect<void>
  readonly onUninstall?: () => Effect.Effect<void>
}): Plugin.Generation => {
  const onInstall = input.onInstall
  const onUninstall = input.onUninstall

  return {
    id: "lifecycle-target",
    revision: input.revision,
    effect: () => Effect.sync(() => input.setup?.()),
    ...(onInstall === undefined ? {} : { onInstall: () => onInstall() }),
    ...(onUninstall === undefined ? {} : { onUninstall: () => onUninstall() }),
  }
}

const listed = (plugins: Plugin.Interface) =>
  plugins.list().pipe(Effect.map((items) => items.some((item) => item.id === id)))

it.effect("creates the plugin directories before activate and keeps data after uninstall", () =>
  Effect.gen(function* () {
    const target = `lifecycle-paths-${crypto.randomUUID().slice(0, 8)}`
    const plugins = yield* Plugin.Service
    const seen = new Array<{ readonly data: string; readonly cache: string; readonly log: string }>()

    yield* plugins.activate([
      {
        id: target,
        revision: "1",
        effect: (host) => Effect.sync(() => void seen.push(host.paths)),
      },
    ])
    expect(seen).toHaveLength(1)
    const paths = seen[0]!
    yield* Effect.addFinalizer(() => Effect.promise(() => rm(paths.data, { recursive: true, force: true })))

    expect(existsSync(paths.data)).toBe(true)
    expect(existsSync(paths.cache)).toBe(true)
    expect(paths.data.endsWith(path.join(".opencode", "plugin-data", target))).toBe(true)
    expect(paths.log.endsWith(path.join(".opencode", "logs", "plugin", `${target}.log`))).toBe(true)

    yield* plugins.uninstall(Plugin.ID.make(target))

    expect(existsSync(paths.cache)).toBe(false)
    expect(existsSync(paths.data)).toBe(true)
  }),
)

it.effect("runs onInstall once on the first load and runs setup on every load", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const calls = new Array<string>()
    const plugin = generation({
      revision: "1",
      setup: () => void calls.push("setup"),
      onInstall: () => Effect.sync(() => void calls.push("install")),
    })

    yield* plugins.activate([plugin])
    expect(calls).toEqual(["install", "setup"])

    yield* plugins.activate([plugin])
    expect(calls).toEqual(["install", "setup"])
  }),
)

it.effect("does not run onInstall again for a new revision", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const calls = new Array<string>()

    yield* plugins.activate([
      generation({ revision: "1", setup: () => void calls.push("setup-1"), onInstall: () => Effect.sync(() => void calls.push("install")) }),
    ])
    yield* plugins.activate([generation({ revision: "2", setup: () => void calls.push("setup-2") })])

    expect(calls).toEqual(["install", "setup-1", "setup-2"])
  }),
)

it.effect("does not run onInstall when a disabled plugin is enabled again", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const calls = new Array<string>()
    const plugin = generation({
      revision: "1",
      setup: () => void calls.push("setup"),
      onInstall: () => Effect.sync(() => void calls.push("install")),
    })

    yield* plugins.activate([plugin])
    yield* plugins.activate([])
    yield* plugins.activate([plugin])

    expect(calls.filter((call) => call === "install")).toHaveLength(1)
    expect(calls.filter((call) => call === "setup")).toHaveLength(2)
  }),
)

it.effect("runs onUninstall once while the plugin is still listed, then removes it", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const calls = new Array<string>()
    const listedDuringRun = new Array<boolean>()

    yield* plugins.activate([
      generation({
        revision: "1",
        onUninstall: () =>
          Effect.gen(function* () {
            calls.push("uninstall")
            listedDuringRun.push(yield* listed(plugins))
          }),
      }),
    ])

    yield* plugins.uninstall(id)

    expect(calls).toEqual(["uninstall"])
    expect(listedDuringRun).toEqual([true])
    expect(yield* listed(plugins)).toBe(false)
  }),
)

it.effect("does not run onUninstall for a plugin that is not active", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const calls = new Array<string>()

    yield* plugins.activate([
      generation({ revision: "1", onUninstall: () => Effect.sync(() => void calls.push("uninstall")) }),
    ])
    yield* plugins.activate([])

    yield* plugins.uninstall(id)

    expect(calls).toEqual([])
  }),
)

it.effect("removes the plugin even when onUninstall fails", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service

    yield* plugins.activate([generation({ revision: "1", onUninstall: () => Effect.die("boom") })])

    yield* plugins.uninstall(id)

    expect(yield* listed(plugins)).toBe(false)
  }),
)

it.effect("times out an onUninstall that never finishes and still removes the plugin", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service

    yield* plugins.activate([generation({ revision: "1", onUninstall: () => Effect.never })])

    const fiber = yield* plugins.uninstall(id).pipe(Effect.forkChild)
    yield* TestClock.adjust("3 seconds")
    yield* Fiber.join(fiber)

    expect(yield* listed(plugins)).toBe(false)
  }),
)

it.effect("still runs setup when onInstall fails", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const calls = new Array<string>()

    yield* plugins.activate([
      generation({ revision: "1", setup: () => void calls.push("setup"), onInstall: () => Effect.die("boom") }),
    ])

    expect(calls).toEqual(["setup"])
    expect(yield* listed(plugins)).toBe(true)
  }),
)
