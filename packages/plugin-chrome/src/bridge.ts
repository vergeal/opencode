export * as ChromeBridge from "./bridge.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { ChromeInstall } from "./install.js"
import { Chrome } from "./rpc.js"

const PORT_START = 8642
const PORT_END = 8662

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type State = {
  extension?: { socket: Bun.ServerWebSocket<undefined>; version: string }
  pending: Map<string, Pending>
}

export type Bridge = {
  readonly port: number
  readonly connected: () => boolean
  readonly version: () => string
  readonly request: (op: string, input: Record<string, unknown>, timeoutMs?: number) => Effect.Effect<unknown, Error>
}

export const make = Effect.fn("ChromeBridge.make")(function* (ctx: Pick<Context, "options">) {
  const token = yield* ChromeInstall.readToken()
  const state: State = { pending: new Map() }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => start(token, ctx.options, state)),
    (server) => Effect.sync(() => server.stop(true)),
  )

  const request = (op: string, input: Record<string, unknown>, timeoutMs = 30_000) =>
    Effect.tryPromise({
      try: () => {
        const extension = state.extension
        if (!extension) {
          return Promise.reject(
            new Error(
              "The OpenCode Chrome extension is not connected. Call chrome.setup, finish its one-time installation steps, then retry.",
            ),
          )
        }
        const id = crypto.randomUUID()
        return new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            state.pending.delete(id)
            reject(new Error(`Chrome extension did not answer ${op} within ${timeoutMs}ms.`))
          }, timeoutMs)
          state.pending.set(id, { resolve, reject, timer })
          extension.socket.send(JSON.stringify({ type: "command", id, op, input }))
        })
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })

  return {
    port: server.port ?? 0,
    connected: () => state.extension !== undefined,
    version: () => state.extension?.version ?? "",
    request,
  } satisfies Bridge
})

function start(token: string, options: Record<string, unknown>, state: State) {
  const preferred = typeof options.port === "number" ? options.port : undefined
  const ports = preferred
    ? [preferred]
    : Array.from({ length: PORT_END - PORT_START + 1 }, (_, index) => PORT_START + index)
  const denied = (message: string) => new Response(message, { status: 401 })

  const serve = (port: number) =>
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(request, server) {
        const url = new URL(request.url)
        const origin = request.headers.get("origin") ?? ""
        if (url.pathname === "/health")
          return Response.json({ service: "opencode-chrome", version: 1 }, { headers: { "x-opencode-chrome": "1" } })
        if (url.pathname === "/pair") {
          // A web page can send this request but cannot satisfy the custom header without a CORS preflight,
          // and this server never answers preflight with an allow-origin header.
          if (request.method !== "POST" || request.headers.get("x-opencode-pair") !== "1") return denied("Not a client.")
          if (origin && !origin.startsWith("chrome-extension://")) return denied("Origin denied.")
          return Response.json({ service: "opencode-chrome", token })
        }
        if (url.pathname === "/ws") {
          if (!origin.startsWith("chrome-extension://")) return denied("Origin denied.")
          if (url.searchParams.get("token") !== token) return denied("Token denied.")
          if (server.upgrade(request)) return undefined as unknown as Response
          return denied("Upgrade failed.")
        }
        return new Response("Not found", { status: 404 })
      },
      websocket: {
        open(socket) {
          state.extension?.socket.close(1000, "replaced")
          state.extension = { socket, version: "" }
        },
        message(socket, raw) {
          const decoded = Schema.decodeUnknownOption(Chrome.ExtensionMessage)(
            JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)),
          )
          if (decoded._tag === "None") return
          const message = decoded.value
          if (message.type === "hello") {
            if (state.extension?.socket === socket) state.extension.version = message.version
            return
          }
          if (message.type === "pong") return
          const entry = state.pending.get(message.id)
          if (!entry) return
          state.pending.delete(message.id)
          clearTimeout(entry.timer)
          if (message.ok) entry.resolve(message.value ?? null)
          else entry.reject(new Error(message.error ?? "Chrome operation failed."))
        },
        close(socket) {
          if (state.extension?.socket !== socket) return
          state.extension = undefined
          state.pending.forEach((entry) => {
            clearTimeout(entry.timer)
            entry.reject(new Error("The Chrome extension disconnected before answering. Check that Chrome is still running, then retry."))
          })
          state.pending.clear()
        },
      },
    })

  for (const port of ports) {
    try {
      return serve(port)
    } catch (error) {
      if (port === ports.at(-1)) throw error
    }
  }
  throw new Error("No free loopback port for the Chrome bridge.")
}
