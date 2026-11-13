import { expect } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const id = "test.uninstall"

it.live("runs a plugin's uninstall callback before its directory is removed", () =>
  Effect.gen(function* () {
    const home = path.join(os.tmpdir(), `oc-uninstall-${crypto.randomUUID()}`)
    // The installed bundle directory is also what the config loads, so the uninstall removes the plugin's own files.
    const directory = path.join(home, ".opencode", "ocplugins", id)
    const mark = path.join(home, "uninstall.json")

    yield* Effect.promise(() => mkdir(directory, { recursive: true }))
    yield* Effect.promise(() =>
      writeFile(path.join(directory, "package.json"), JSON.stringify({ name: id, type: "module" })),
    )
    yield* Effect.promise(() =>
      writeFile(
        path.join(directory, "index.js"),
        `import { existsSync, writeFileSync } from "node:fs"
export default {
  id: ${JSON.stringify(id)},
  setup() {},
  onUninstall() {
    writeFileSync(${JSON.stringify(mark)}, JSON.stringify({ directoryExists: existsSync(${JSON.stringify(directory)}) }))
  },
}
`,
      ),
    )

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

    const listed = Effect.gen(function* () {
      const response = yield* request("/api/plugin")
      const body = (yield* Effect.promise(() => response.json())) as { data: ReadonlyArray<{ id: string }> }
      return body.data.some((item) => item.id === id)
    })

    // Activation is asynchronous: wait until the server inventory shows the plugin before uninstalling it.
    const activated = yield* Effect.gen(function* () {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (yield* listed) return true
        yield* Effect.sleep(50)
      }
      return false
    })
    expect(activated).toBe(true)

    const response = yield* request(`/api/experimental/plugin/uninstall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    })
    expect(response.status).toBe(200)

    const recorded = JSON.parse(yield* Effect.promise(() => readFile(mark, "utf8"))) as {
      directoryExists: boolean
    }
    expect(recorded.directoryExists).toBe(true)
    expect(existsSync(directory)).toBe(false)
  }),
)
