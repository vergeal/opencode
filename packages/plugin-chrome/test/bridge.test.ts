import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { ChromeBridge } from "../src/bridge"

const extensionOrigin = "chrome-extension://abcdefghijklmnop"
const socketOptions: Bun.WebSocketOptions = { headers: { origin: extensionOrigin } }
// The DOM lib shadows Bun's WebSocket overload, which accepts connection options.
const openSocket = WebSocket as unknown as new (url: string, options: Bun.WebSocketOptions) => WebSocket

async function withBridge<T>(run: (bridge: ChromeBridge.Bridge) => Promise<T>) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const bridge = yield* ChromeBridge.make({ options: { port: 0 } })
        return yield* Effect.promise(() => run(bridge))
      }),
    ),
  )
}

async function connect(bridge: ChromeBridge.Bridge) {
  const pair = await fetch(`http://127.0.0.1:${bridge.port}/pair`, {
    method: "POST",
    headers: { "x-opencode-pair": "1", origin: extensionOrigin },
  })
  const { token } = await pair.json()
  const socket = new openSocket(`ws://127.0.0.1:${bridge.port}/ws?token=${token}`, socketOptions)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error("socket failed"))
  })
  return { socket, token }
}

describe("chrome bridge", () => {
  it("reports health without a token", async () => {
    await withBridge(async (bridge) => {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/health`)
      expect(response.headers.get("x-opencode-chrome")).toBe("1")
      expect(await response.json()).toMatchObject({ service: "opencode-chrome" })
    })
  })

  it("refuses pairing without the extension header", async () => {
    await withBridge(async (bridge) => {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/pair`, { method: "POST" })
      expect(response.status).toBe(401)
    })
  })

  it("refuses a page origin", async () => {
    await withBridge(async (bridge) => {
      const response = await fetch(`http://127.0.0.1:${bridge.port}/pair`, {
        method: "POST",
        headers: { "x-opencode-pair": "1", origin: "https://example.com" },
      })
      expect(response.status).toBe(401)
    })
  })

  it("refuses a websocket with the wrong token", async () => {
    await withBridge(async (bridge) => {
      const socket = new openSocket(`ws://127.0.0.1:${bridge.port}/ws?token=wrong`, socketOptions)
      const failed = await new Promise<boolean>((resolve) => {
        socket.onopen = () => resolve(false)
        socket.onerror = () => resolve(true)
      })
      expect(failed).toBe(true)
    })
  })

  it("round-trips a command to a connected extension", async () => {
    await withBridge(async (bridge) => {
      const { socket } = await connect(bridge)
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data))
        socket.send(JSON.stringify({ type: "result", id: message.id, ok: true, value: { ok: true } }))
      }
      const value = await Effect.runPromise(bridge.request("click", { tabID: 1, ref: "e1" }))
      expect(value).toEqual({ ok: true })
      expect(bridge.connected()).toBe(true)
      socket.close()
    })
  })

  it("reports a disconnected bridge instead of hanging", async () => {
    await withBridge(async (bridge) => {
      expect(bridge.connected()).toBe(false)
      const error = await Effect.runPromise(Effect.flip(bridge.request("status", {})))
      expect(error.message).toContain("chrome.setup")
    })
  })
})
