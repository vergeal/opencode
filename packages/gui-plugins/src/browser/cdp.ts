import type { WebContents } from "electron"
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js"
import { protocolError } from "./errors"

/**
 * The Chrome DevTools Protocol transport a page speaks its protocol through.
 *
 * A page's Page, Runtime, DOM, Input and Network logic is written against this shape only, so the same code runs on an
 * Electron `WebContents.debugger` and on a WebSocket to an external Chrome.
 */
export type Cdp = {
  send<Method extends keyof ProtocolMapping.Commands>(
    method: Method,
    params?: object,
    sessionID?: string,
  ): Promise<ProtocolMapping.Commands[Method]["returnType"]>
  on<Method extends keyof ProtocolMapping.Events>(
    method: Method,
    callback: (params: ProtocolMapping.Events[Method][0], sessionID?: string) => void,
  ): () => void
  dispose(): void
}

function dispatcher() {
  const listeners = new Map<string, Set<(params: unknown, sessionID?: string) => void>>()

  return {
    emit(name: string, params: unknown, sessionID?: string) {
      listeners.get(name)?.forEach((callback) => callback(params, sessionID))
    },
    on<Method extends keyof ProtocolMapping.Events>(
      method: Method,
      callback: (params: ProtocolMapping.Events[Method][0], sessionID?: string) => void,
    ) {
      const handler = (params: unknown, sessionID?: string) =>
        callback(params as ProtocolMapping.Events[Method][0], sessionID)

      const handlers = listeners.get(method) ?? new Set()
      handlers.add(handler)
      listeners.set(method, handlers)

      return () => {
        handlers.delete(handler)

        if (!handlers.size) listeners.delete(method)
      }
    },
    clear() {
      listeners.clear()
    },
  }
}

/**
 * A CDP connection over `WebContents.debugger`, the connection an embedded browser page uses.
 *
 * The debugger attaches lazily on the first command, because attaching in a page's constructor can race the view's
 * first navigation.
 */
export function createElectronCdp(contents: WebContents): Cdp {
  const events = dispatcher()
  const sessions = new Set([""])

  const receive = (_event: Electron.Event, name: string, params: unknown, sessionID?: string) => {
    if (!sessions.has(sessionID ?? "")) return

    if (name === "Target.attachedToTarget") {
      const event = params as ProtocolMapping.Events["Target.attachedToTarget"][0]

      if (event.targetInfo.type === "iframe") sessions.add(event.sessionId)
    }

    if (name === "Target.detachedFromTarget")
      sessions.delete((params as ProtocolMapping.Events["Target.detachedFromTarget"][0]).sessionId)
    events.emit(name, params, sessionID || undefined)
  }

  contents.debugger.on("message", receive)

  return {
    async send(method, params = {}, sessionID) {
      if (contents.isDestroyed())
        throw new Error(
          "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID, or browser.tabs.open({}) if no tabs remain.",
        )

      // attach can throw synchronously; sendCommand can reject asynchronously.
      try {
        if (!contents.debugger.isAttached()) contents.debugger.attach("1.3")

        return await contents.debugger.sendCommand(method, params, sessionID)
      } catch (error) {
        throw protocolError(method, error)
      }
    },
    on: events.on,
    dispose() {
      contents.debugger.off("message", receive)
      events.clear()
    },
  }
}

type Pending = { method: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }

/**
 * A CDP connection to a browser-level WebSocket, the connection an external Chrome exposes at
 * `/json/version`'s `webSocketDebuggerUrl`.
 *
 * Sessions are passed through as-is: a browser-level connection also reports events for the tab sessions it attached,
 * and the caller tracks which ones it owns.
 */
export function createWebSocketCdp(url: string): Cdp {
  const events = dispatcher()
  const pending = new Map<number, Pending>()
  const opened = Promise.withResolvers<void>()
  let socket: WebSocket | undefined
  let nextID = 1
  let failure: Error | undefined

  const close = (error: Error) => {
    failure ??= error
    opened.reject(failure)
    pending.forEach((request) => request.reject(failure))
    pending.clear()
  }

  const receive = (data: unknown) => {
    let message: {
      id?: number
      method?: string
      params?: unknown
      result?: unknown
      sessionId?: string
      error?: { message?: string }
    }

    try {
      message = JSON.parse(String(data))
    } catch {
      return
    }

    // A reply carries its result under `result`; an event carries `method` and `params`.
    if (message.id !== undefined) {
      const request = pending.get(message.id)

      if (!request) return
      pending.delete(message.id)

      if (message.error) {
        request.reject(new Error(message.error.message ?? `Chromium command ${request.method} failed.`))

        return
      }
      request.resolve(message.result)
      return
    }

    if (message.method) events.emit(message.method, message.params, message.sessionId)
  }

  try {
    const connection = new WebSocket(url)
    socket = connection
    connection.addEventListener("open", () => opened.resolve())
    connection.addEventListener("message", (event) => receive(event.data))
    connection.addEventListener("error", () => close(new Error(`CDP WebSocket to ${url} failed.`)))
    connection.addEventListener("close", () => close(new Error(`CDP WebSocket to ${url} closed.`)))
  } catch (error) {
    close(new Error(`CDP WebSocket to ${url} failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  return {
    async send(method, params = {}, sessionID) {
      await opened.promise

      if (!socket || socket.readyState !== WebSocket.OPEN) throw failure ?? new Error(`CDP WebSocket to ${url} closed.`)
      const id = nextID++
      const result = Promise.withResolvers<unknown>()
      pending.set(id, { method, resolve: result.resolve, reject: result.reject })
      socket.send(JSON.stringify({ id, method, params, ...(sessionID ? { sessionId: sessionID } : {}) }))

      try {
        const response = await result.promise
        // CDP returns `{ id, result }`; the transport hands the result back like `WebContents.debugger` does.
        return response as never
      } catch (error) {
        throw protocolError(method, error)
      }
    },
    on: events.on,
    dispose() {
      close(new Error(`CDP WebSocket to ${url} was closed.`))
      events.clear()
      socket?.close()
    },
  }
}

export function abortError(signal: AbortSignal) {
  if (signal.aborted)
    throw new Error(
      "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
    )
}

export async function waitFor(check: () => boolean | Promise<boolean>, signal: AbortSignal, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  const timeout = () => new Error(`Condition was not met within ${timeoutMs} ms.`)

  // A busy renderer can hold one check past the deadline, so each check races the remaining time.
  while (true) {
    abortError(signal)
    const remaining = deadline - Date.now()

    if (remaining <= 0) throw timeout()
    let timer: ReturnType<typeof setTimeout> | undefined

    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timeout()), remaining)
    })

    if (await Promise.race([check(), expired]).finally(() => clearTimeout(timer))) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
