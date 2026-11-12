import { expect, test } from "bun:test"
import { chromeCandidates, launchArgs, parseVersion, probeEndpoint } from "./discovery"

const wire = { Browser: "Chrome/131.0.6778.86", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc" }
const version = { browser: wire.Browser, webSocketDebuggerUrl: wire.webSocketDebuggerUrl }

function respond(body: string, status = 200) {
  return (async () => new Response(body, { status })) as unknown as typeof fetch
}

function fail(code: string, name = "TypeError") {
  const cause = Object.assign(new Error("connect failed"), { code })
  const error = new Error("fetch failed", { cause })
  error.name = name

  return (async () => {
    throw error
  }) as unknown as typeof fetch
}

test("a port answering with a version document is ready", async () => {
  const result = await probeEndpoint("http://127.0.0.1:9222/json/version", { fetch: respond(JSON.stringify(wire)) })

  expect(result).toEqual({ status: "ready", version })
})

test("a refused connection is refused", async () => {
  const result = await probeEndpoint("http://127.0.0.1:9222/json/version", { fetch: fail("ECONNREFUSED") })

  expect(result).toEqual({ status: "refused", detail: "connect failed" })
})

test("a probe that does not answer in time is a timeout", async () => {
  const result = await probeEndpoint("http://127.0.0.1:9222/json/version", {
    fetch: fail("ABORT_ERR", "TimeoutError"),
  })

  expect(result.status).toBe("timeout")
})

test("a non-JSON reply is invalid, not a timeout or a refusal", async () => {
  const result = await probeEndpoint("http://127.0.0.1:9222/json/version", { fetch: respond("<html>hello</html>") })

  expect(result).toEqual({ status: "invalid", detail: "response is not JSON" })
})

test("JSON that is not a version document is invalid", async () => {
  const result = await probeEndpoint("http://127.0.0.1:9222/json/version", {
    fetch: respond(JSON.stringify({ ready: true })),
  })

  expect(result).toEqual({ status: "invalid", detail: "response is not a CDP version document" })
})

test("an HTTP error is invalid", async () => {
  const result = await probeEndpoint("http://127.0.0.1:9222/json/version", { fetch: respond("no", 500) })

  expect(result).toEqual({ status: "invalid", detail: "HTTP 500" })
})

test("parseVersion requires both fields", () => {
  expect(parseVersion(wire)).toEqual(version)
  expect(parseVersion({ Browser: "Chrome/1" })).toBeUndefined()
  expect(parseVersion({ webSocketDebuggerUrl: "ws://x" })).toBeUndefined()
  expect(parseVersion(null)).toBeUndefined()
  expect(parseVersion("Chrome")).toBeUndefined()
})

test("launch args name the port and a separate profile", () => {
  expect(launchArgs({ port: 9222, userDataDir: "/tmp/opencode-chrome" })).toEqual([
    "--remote-debugging-port=9222",
    "--user-data-dir=/tmp/opencode-chrome",
  ])
})

test("macOS tries the user's own Chrome before the system copy", () => {
  expect(chromeCandidates({ platform: "darwin", home: "/Users/ada" })).toEqual([
    "/Users/ada/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Users/ada/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ])
})

test("Windows tries the per-user install, then the program files installs", () => {
  const candidates = chromeCandidates({
    platform: "win32",
    env: {
      LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    },
  })

  expect(candidates.slice(0, 3)).toEqual([
    "C:\\Users\\ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ])
})
