import { rm, mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Effect } from "effect"
import { ChromeBridge } from "../src/bridge"

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const extension = "/Users/ekko/Projects/opencode-chrome-agent/packages/plugin-chrome/extension"
const profile = await mkdtemp(join(tmpdir(), "oc-chrome-e2e-"))
const site = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    new Response(
      `<!doctype html><html><body style="height:3000px">
        <h1>E2E</h1>
        <label for="u">Name</label><input id="u">
        <button id="b" onclick="document.title='clicked'">Submit</button>
        <select id="s"><option value="a">A</option><option value="b">B</option></select>
      </body></html>`,
      { headers: { "content-type": "text/html" } },
    ),
})

const proc = Bun.spawn(
  [
    chrome,
    "--headless=new",
    // Chrome 137+ gates --load-extension behind this feature flag; turn it off so
    // a test profile can load the unpacked extension.
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    `--user-data-dir=${profile}`,
    `--load-extension=${extension}`,
    "--no-first-run",
    "--no-default-browser-check",
    `http://127.0.0.1:${site.port}/`,
  ],
  { stdout: "ignore", stderr: "ignore" },
)

try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bridge = yield* ChromeBridge.make({ options: { port: 8642 } })
        console.log("bridge port", bridge.port)
        const deadline = Date.now() + 20_000
        while (!bridge.connected()) {
          if (Date.now() > deadline) throw new Error("extension never connected")
          yield* Effect.promise(() => Bun.sleep(200))
        }
        console.log("extension connected", bridge.version())

        const tabs = (yield* bridge.request("tabs.list", {})) as any
        console.log("tabs", tabs.tabs.map((tab: any) => tab.url))
        const tab = tabs.tabs.find((entry: any) => entry.url.includes(`:${site.port}`)) ?? tabs.tabs[0]
        if (!tab) throw new Error("no tab")

        const snapshot = (yield* bridge.request("snapshot", { tabID: tab.id })) as any
        console.log("--- snapshot ---\n" + snapshot.content)
        const ref = snapshot.content.split("\n").find((line: string) => line.includes('button "Submit"'))?.match(/\[ref=(e\d+)\]/)?.[1]
        const nameRef = snapshot.content.split("\n").find((line: string) => line.includes('textbox "Name"'))?.match(/\[ref=(e\d+)\]/)?.[1]

        console.log("click", yield* bridge.request("click", { tabID: tab.id, ref }))
        console.log("fill", yield* bridge.request("fill", { tabID: tab.id, ref: nameRef, text: "opencode" }))
        console.log("title", yield* bridge.request("evaluate", { tabID: tab.id, script: "document.title" }))
        console.log("value", yield* bridge.request("evaluate", { tabID: tab.id, script: "document.getElementById('u').value" }))
        console.log("wait", yield* bridge.request("wait", { tabID: tab.id, condition: "text", text: "Submit", timeoutMs: 2000 }))
        console.log("highlight", yield* bridge.request("highlight", { tabID: tab.id, ref, text: "checking" }))
        console.log("console", yield* bridge.request("console", { tabID: tab.id }))
        try {
          const shot = (yield* bridge.request("screenshot", { tabID: tab.id })) as any
          console.log("screenshot", shot.mime, shot.dataUrl.length)
        } catch (error) {
          console.log("screenshot failed", String(error))
        }
      }),
    ),
  )
} finally {
  proc.kill()
  site.stop(true)
  await rm(profile, { recursive: true, force: true })
}
