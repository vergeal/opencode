import { expect } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const id = "test.reload"

/** A plugin whose setup is the given body, so the same file can arrive broken and later fixed. */
const plugin = (setup: string) => `export default {
  id: ${JSON.stringify(id)},
  async setup() {
    ${setup}
  },
}`

it.live(
  "retries a failed plugin through the reload endpoint and reports unknown ids as not found",
  () =>
    Effect.gen(function* () {
      const home = path.join(os.tmpdir(), `oc-reload-${crypto.randomUUID()}`)
      const directory = path.join(home, "plugins", id)
      const entry = path.join(directory, "index.js")

      yield* Effect.promise(() => mkdir(directory, { recursive: true }))
      yield* Effect.promise(() =>
        writeFile(path.join(directory, "package.json"), JSON.stringify({ name: id, type: "module" })),
      )
      yield* Effect.promise(() => writeFile(entry, plugin('throw new Error("broken plugin")')))

      const previous = process.env.OPENCODE_TEST_HOME
      process.env.OPENCODE_TEST_HOME = home
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.OPENCODE_TEST_HOME
          else process.env.OPENCODE_TEST_HOME = previous
        }),
      )
      yield* Effect.addFinalizer(() => Effect.promise(() => rm(home, { recursive: true, force: true })))

      const handler = yield* ServerFetch.make({
        app: { version: "test" },
        database: { path: ":memory:" },
        fs: { filewatcher: false },
        models: { fetch: false },
        config: { content: JSON.stringify({ plugins: [directory] }) },
      })
      const request = (pathname: string, init?: RequestInit) =>
        Effect.promise(() => handler(new Request(`http://opencode.local${pathname}`, init)))

      const inventory = Effect.gen(function* () {
        const response = yield* request("/api/plugin")
        const body = (yield* Effect.promise(() => response.json())) as {
          data: ReadonlyArray<{ id: string; state: { status: string } }>
        }
        return body.data
      })

      const waitStatus = (status: string) =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < 200; attempt++) {
            const listed = yield* inventory
            if (listed.find((plugin) => plugin.id === id)?.state.status === status) return
            yield* Effect.sleep("50 millis")
          }
          return yield* Effect.die(new Error(`plugin never became ${status}`))
        })

      // Activation is asynchronous: wait until the broken setup is reported before retrying it.
      yield* waitStatus("failed")

      // Fixing the file and retrying must reload the code, not merely re-report the recorded failure.
      yield* Effect.promise(() => writeFile(entry, plugin("")))
      const reloaded = yield* request("/api/experimental/plugin/reload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      })
      expect(reloaded.status).toBe(200)
      yield* waitStatus("active")

      const missing = yield* request("/api/experimental/plugin/reload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "test.missing" }),
      })
      expect(missing.status).toBe(404)
    }),
  { timeout: 30_000 },
)
