import { expect, test } from "bun:test"
import { resolveBackend, type BackendDependencies } from "./backend"
import type { Cdp } from "./cdp"
import type { ProbeResult } from "./discovery"

const version = { browser: "Chrome/131.0.6778.86", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc" }

const input = {
  endpoint: "http://127.0.0.1:9222/json/version",
  port: 9222,
  userDataDir: "/tmp/chrome-profile",
  prefer: "external" as const,
}

function cdp(send: () => Promise<object> = async () => ({ product: "Chrome" })): Cdp {
  // SAFETY: the stub answers every CDP method with one fixed payload; tests never read a method-specific type from it.
  return { send: send as Cdp["send"], on: () => () => {}, dispose: () => {} }
}

/** A clock that advances once per sleep, so a launch that never answers ends instead of spinning. */
function clock() {
  let time = 0

  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms
    },
  }
}

function deps(overrides: BackendDependencies = {}): BackendDependencies {
  return {
    probe: async () => ({ status: "ready", version }),
    connect: () => cdp(),
    exists: async () => true,
    launch: async () => {},
    candidates: () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    ...clock(),
    readyTimeoutMs: 1_000,
    ...overrides,
  }
}

test("the pane's embedded view is the default, neither probing nor launching a Chrome", async () => {
  const calls: string[] = []

  const backend = await resolveBackend(
    { ...input, prefer: undefined },
    deps({
      probe: async () => {
        calls.push("probe")

        return { status: "ready", version }
      },
      launch: async () => void calls.push("launch"),
    }),
  )

  expect(backend).toEqual({
    mode: "embedded",
    reason: "preferred",
    detail: "The pane drives its own embedded view, so no local Chrome is launched or connected.",
  })
  expect(calls).toEqual([])
})

test("a Chrome already on the port is used", async () => {
  const backend = await resolveBackend(input, deps())

  expect(backend.mode).toBe("external")

  if (backend.mode !== "external") return

  expect(backend.version).toEqual(version)
  expect(backend.endpoint).toBe(input.endpoint)
})

test("a refused port launches the configured Chrome and waits for it", async () => {
  const launched: { path: string; args: readonly string[] }[] = []
  let probes = 0

  const backend = await resolveBackend(
    input,
    deps({
      probe: async () => {
        probes++

        return probes === 1 ? { status: "refused", detail: "connect failed" } : { status: "ready", version }
      },
      launch: async (path, args) => {
        launched.push({ path, args })
      },
    }),
  )

  expect(backend.mode).toBe("external")
  expect(launched).toEqual([
    {
      path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: ["--remote-debugging-port=9222", "--user-data-dir=/tmp/chrome-profile"],
    },
  ])
})

test("no Chrome installation falls back to the embedded browser without launching", async () => {
  const launched: string[] = []

  const backend = await resolveBackend(
    input,
    deps({
      probe: async () => ({ status: "refused", detail: "connect failed" }),
      exists: async () => false,
      launch: async (path) => {
        launched.push(path)
      },
    }),
  )

  expect(backend).toEqual({
    mode: "embedded",
    reason: "chrome-missing",
    detail: "No Google Chrome installation was found.",
  })
  expect(launched).toEqual([])
})

test("a probe timeout keeps the embedded browser instead of launching a second Chrome", async () => {
  let launched = false

  const backend = await resolveBackend(
    input,
    deps({
      probe: async () => ({ status: "timeout", detail: "no answer" }),
      launch: async () => {
        launched = true
      },
    }),
  )

  expect(backend).toEqual({ mode: "embedded", reason: "probe-timeout", detail: "no answer" })
  expect(launched).toBe(false)
})

test("a port serving something that is not CDP is invalid and falls back", async () => {
  const backend = await resolveBackend(
    input,
    deps({ probe: async () => ({ status: "invalid", detail: "response is not JSON" }) }),
  )

  expect(backend).toEqual({ mode: "embedded", reason: "probe-invalid", detail: "response is not JSON" })
})

test("a launch that fails falls back", async () => {
  const backend = await resolveBackend(
    input,
    deps({
      probe: async () => ({ status: "refused", detail: "connect failed" }),
      launch: async () => {
        throw new Error("permission denied")
      },
    }),
  )

  expect(backend).toEqual({ mode: "embedded", reason: "launch-failed", detail: "permission denied" })
})

test("a launched Chrome that never answers falls back", async () => {
  let probes = 0

  const backend = await resolveBackend(
    input,
    deps({
      probe: async (): Promise<ProbeResult> => {
        probes++

        return probes === 1
          ? { status: "refused", detail: "connect failed" }
          : { status: "refused", detail: "still down" }
      },
    }),
  )

  expect(backend.mode).toBe("embedded")

  if (backend.mode !== "embedded") return

  expect(backend.reason).toBe("launch-failed")
})

test("a socket that cannot complete the handshake falls back and is disposed", async () => {
  let disposed = false

  const backend = await resolveBackend(
    input,
    deps({
      connect: () => {
        const connection = cdp(async () => {
          throw new Error("closed")
        })

        return { ...connection, dispose: () => void (disposed = true) }
      },
    }),
  )

  expect(backend).toEqual({ mode: "embedded", reason: "connect-failed", detail: "closed" })
  expect(disposed).toBe(true)
})
