import { expect } from "bun:test"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { PluginSecrets } from "@opencode/core/plugin/secrets"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("round-trips a secret without writing plain text", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const secrets = PluginSecrets.make({ home: temp.path, id: "test.secrets" })

    yield* secrets.set("token", "hunter2")
    expect(yield* secrets.get("token")).toBe("hunter2")

    const file = path.join(temp.path, ".opencode", "secrets", "test.secrets.json")
    const text = yield* Effect.promise(() => readFile(file, "utf8"))
    expect(text).not.toContain("hunter2")
    expect((yield* Effect.promise(() => stat(file))).mode & 0o777).toBe(0o600)

    yield* secrets.delete("token")
    expect(yield* secrets.get("token")).toBeUndefined()
  }),
)

it.effect("keeps the key private and stable across reads", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const first = PluginSecrets.make({ home: temp.path, id: "test.secrets" })
    const second = PluginSecrets.make({ home: temp.path, id: "test.secrets" })

    yield* first.set("token", "one")
    expect(yield* second.get("token")).toBe("one")
    expect((yield* Effect.promise(() => stat(path.join(temp.path, ".opencode", "secrets.key")))).mode & 0o777).toBe(0o600)
  }),
)

it.effect("names the file after the plugin id", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const secrets = PluginSecrets.make({ home: temp.path, id: "@scope/plugin" })

    yield* secrets.set("token", "one")

    expect(yield* Effect.promise(() => stat(path.join(temp.path, ".opencode", "secrets", "@scope+plugin.json"))))
      .toBeDefined()
  }),
)
