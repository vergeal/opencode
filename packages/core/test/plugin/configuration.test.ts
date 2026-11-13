import { expect } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Exit } from "effect"
import { PluginConfiguration } from "@opencode/core/plugin/configuration"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const configuration = {
  title: "DB tool",
  properties: {
    endpoint: { type: "string" as const, default: "" },
    timeout: { type: "number" as const, default: 30 },
    mode: { type: "string" as const, enum: ["ro", "rw"], default: "ro" },
  },
}

it.effect("fills declared defaults and drops undeclared keys", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const data = path.join(temp.path, ".opencode", "plugin-data", "test.config")
    yield* Effect.promise(() => mkdir(data, { recursive: true }))
    yield* Effect.promise(() => writeFile(path.join(data, "config.json"), JSON.stringify({ mode: "rw", unknown: 1 })))

    const config = PluginConfiguration.make({ home: temp.path, id: "test.config", configuration })

    expect(yield* config.get()).toEqual({ endpoint: "", timeout: 30, mode: "rw" })
  }),
)

it.effect("updates declared keys and notifies listeners with the merged values", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const config = PluginConfiguration.make({ home: temp.path, id: "test.config", configuration })
    const seen = new Array<Record<string, unknown>>()

    config.onChange((next) => void seen.push(next))
    yield* config.update({ timeout: 5 })

    expect(seen).toEqual([{ endpoint: "", timeout: 5, mode: "ro" }])
    expect(yield* config.get()).toEqual({ endpoint: "", timeout: 5, mode: "ro" })
  }),
)

it.effect("rejects unknown keys and values of the wrong type", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const config = PluginConfiguration.make({ home: temp.path, id: "test.config", configuration })

    expect(Exit.isFailure(yield* config.update({ unknown: 1 }).pipe(Effect.exit))).toBe(true)
    expect(Exit.isFailure(yield* config.update({ timeout: "soon" }).pipe(Effect.exit))).toBe(true)
    expect(Exit.isFailure(yield* config.update({ mode: "write" }).pipe(Effect.exit))).toBe(true)
  }),
)

it.effect("removes a listener when unsubscribed", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const config = PluginConfiguration.make({ home: temp.path, id: "test.config", configuration })
    const seen = new Array<Record<string, unknown>>()
    const unsubscribe = config.onChange((next) => void seen.push(next))

    unsubscribe()
    yield* config.update({ timeout: 1 })

    expect(seen).toEqual([])
  }),
)
