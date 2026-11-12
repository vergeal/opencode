// OpenCode Chrome Agent service worker. It discovers the OpenCode bridge on
// loopback, pairs with a token, keeps a WebSocket open, and routes DOM commands
// into the active tab through chrome.scripting.

const VERSION = "1.0.0"
const PORT_START = 8642
const PORT_END = 8662
const RECONNECT_MS = 1500

let socket
let bridge = { port: null, token: null }
let connecting = false
let reconnectTimer

const log = (...args) => console.log("[opencode-chrome]", ...args)

async function loadConfig() {
  const stored = await chrome.storage.local.get(["port", "token"])
  bridge = { port: stored.port ?? null, token: stored.token ?? null }
}

async function saveConfig(port, token) {
  bridge = { port, token }
  await chrome.storage.local.set({ port, token })
}

async function discoverPort() {
  if (bridge.port) {
    const found = await probe(bridge.port)
    if (found) return bridge.port
  }
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (await probe(port)) return port
  }
  return null
}

async function probe(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(600) }).catch(
    () => null,
  )
  if (!response?.ok) return false
  const body = await response.json().catch(() => null)
  return body?.service === "opencode-chrome"
}

async function pair(port) {
  const response = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: "POST",
    headers: { "x-opencode-pair": "1" },
    signal: AbortSignal.timeout(3_000),
  })
  if (!response.ok) throw new Error(`Pairing failed with HTTP ${response.status}.`)
  const body = await response.json()
  if (!body?.token) throw new Error("Pairing returned no token.")
  await saveConfig(port, body.token)
  return body.token
}

function welcomeUrl() {
  return chrome.runtime.getURL("welcome.html")
}

/**
 * The dedicated window starts on about:blank. Turn that placeholder into the
 * extension's own start page so the user never sees an empty tab, but leave any
 * page the user or agent already opened alone.
 */
async function settleStartup(attempt = 0) {
  try {
    const tabs = await chrome.tabs.query({})
    const blank = tabs.filter((tab) => typeof tab.id === "number" && tab.url === "about:blank")
    if (tabs.length === 1 && blank.length === 1) {
      await chrome.tabs.update(blank[0].id, { url: welcomeUrl() })
      return
    }
    if (tabs.length === 0 && attempt < 5) setTimeout(() => settleStartup(attempt + 1), 400)
  } catch (error) {
    if (attempt < 5) return setTimeout(() => settleStartup(attempt + 1), 400)
    await chrome.storage.local.set({ startupError: String(error?.message ?? error) }).catch(() => {})
  }
}

async function closeWelcomeTabs(keep) {
  const welcome = welcomeUrl()
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) {
    if (tab.id !== keep && tab.url === welcome) await chrome.tabs.remove(tab.id).catch(() => {})
  }
}

async function connect() {
  if (connecting || socket?.readyState === WebSocket.OPEN) return
  connecting = true
  try {
    await loadConfig()
    const port = await discoverPort()
    if (!port) {
      log("no bridge found")
      setBadge("off", "#6b7280")
      scheduleReconnect()
      return
    }
    const token = bridge.token ?? (await pair(port))
    if (bridge.port !== port) await saveConfig(port, token)
    log("connecting to", port)
    const next = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`)
    socket = next
    next.addEventListener("open", () => {
      log("connected")
      setBadge("on", "#34d399")
      send({ type: "hello", version: VERSION, userAgent: navigator.userAgent })
      settleStartup()
    })
    next.addEventListener("message", async (event) => {
      const message = JSON.parse(event.data)
      if (message.type === "ping") return send({ type: "pong" })
      if (message.type !== "command") return
      try {
        const value = await run(message.op, message.input ?? {})
        send({ type: "result", id: message.id, ok: true, value })
      } catch (error) {
        send({ type: "result", id: message.id, ok: false, error: String(error?.message ?? error) })
      }
    })
    next.addEventListener("close", async () => {
      if (socket !== next) return
      socket = undefined
      setBadge("off", "#6b7280")
      // A rejected token is common after OpenCode restarts; pair again before retrying.
      await chrome.storage.local.remove("token").catch(() => {})
      scheduleReconnect()
    })
    next.addEventListener("error", () => {})
  } catch (error) {
    log("connect failed", error)
    setBadge("off", "#ef4444")
    scheduleReconnect()
  } finally {
    connecting = false
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(connect, RECONNECT_MS)
  keepAlarm()
}

// The service worker can be suspended before a setTimeout fires, so keep an
// alarm registered as a durable wake-up. Creating it repeatedly is idempotent.
function keepAlarm() {
  try {
    chrome.alarms.create("opencode-reconnect", { periodInMinutes: 0.5 })
  } catch {}
}

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(message))
  return true
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text === "on" ? "" : "!" }).catch(() => {})
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {})
  chrome.action
    .setTitle({ title: text === "on" ? "OpenCode Chrome Agent · connected" : "OpenCode Chrome Agent · not connected" })
    .catch(() => {})
}

async function run(op, input) {
  if (op === "status") return status()
  if (op === "tabs.list") return tabsList()
  if (op === "tabs.open") return tabsOpen(input)
  if (op === "tabs.close") return tabsClose(input)
  if (op === "tabs.focus") return tabsFocus(input)
  if (op === "navigate") return navigate(input)
  if (op === "back") return tabAction(input, (tabId) => chrome.tabs.goBack(tabId))
  if (op === "forward") return tabAction(input, (tabId) => chrome.tabs.goForward(tabId))
  if (op === "reload") return reload(input)
  if (op === "screenshot") return screenshot(input)
  if (op === "console") return consoleMessages(input)
  if (op === "dialogs") return pageDialogs(input)
  if (op === "evaluate") return evaluate(input)
  if (op === "upload") return upload(input)
  if (
    [
      "snapshot",
      "find",
      "click",
      "click_at",
      "drag",
      "hover",
      "fill",
      "select",
      "check",
      "press",
      "scroll",
      "wait",
      "highlight",
    ].includes(op)
  )
    return content(input.tabID, op, input)
  throw new Error(`Unknown Chrome bridge operation ${op}.`)
}

async function status() {
  const tabs = await chrome.tabs.query({})
  const stored = await chrome.storage.local.get("startupError").catch(() => ({}))
  return {
    connected: socket?.readyState === WebSocket.OPEN,
    version: VERSION,
    port: bridge.port,
    chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "",
    tabs: tabs.length,
    startupError: stored?.startupError ?? null,
  }
}

async function tabsList() {
  const tabs = await chrome.tabs.query({})
  return {
    tabs: tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => ({
        id: tab.id,
        windowID: tab.windowId,
        url: tab.url ?? "",
        title: tab.title ?? "",
        active: tab.active,
        pinned: tab.pinned,
        status: tab.status ?? "complete",
      })),
  }
}

async function tabsOpen(input) {
  const tab = await chrome.tabs.create({ url: input.url ?? "about:blank", active: input.active ?? true })
  if (tab.id === undefined) throw new Error("Chrome did not return a tab ID.")
  await waitForTab(tab.id)
  await closeWelcomeTabs(tab.id)
  return describe(tab.id)
}

async function tabsClose(input) {
  await chrome.tabs.remove(input.tabID)
  return { ok: true }
}

async function tabsFocus(input) {
  const tab = await chrome.tabs.update(input.tabID, { active: true })
  if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
  return describe(input.tabID)
}

async function navigate(input) {
  await chrome.tabs.update(input.tabID, { url: input.url })
  await waitForTab(input.tabID)
  return describe(input.tabID)
}

async function tabAction(input, action) {
  await action(input.tabID)
  await waitForTab(input.tabID)
  return describe(input.tabID)
}

async function reload(input) {
  await chrome.tabs.reload(input.tabID)
  await waitForTab(input.tabID)
  return describe(input.tabID)
}

async function describe(tabID) {
  const tab = await chrome.tabs.get(tabID)
  return {
    id: tab.id,
    windowID: tab.windowId,
    url: tab.url ?? "",
    title: tab.title ?? "",
    active: tab.active,
    pinned: tab.pinned,
    status: tab.status ?? "complete",
  }
}

function waitForTab(tabID, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    const listener = (id, info) => {
      if (id === tabID && info.status === "complete") finish()
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(listener)
      reject(new Error(`Tab ${tabID} did not finish loading within ${timeoutMs}ms.`))
    }, timeoutMs)
    chrome.tabs.onUpdated.addListener(listener)
    chrome.tabs.get(tabID).then((tab) => {
      if (tab.status === "complete") finish()
    })
  })
}

async function ensureContent(tabID) {
  try {
    const response = await chrome.tabs.sendMessage(tabID, { __opencodeContent: true, op: "ping" })
    if (response?.ok) return
  } catch {}
  await chrome.scripting.executeScript({ target: { tabId: tabID }, files: ["content.js"] })
}

async function content(tabID, op, input) {
  await ensureContent(tabID)
  const response = await chrome.tabs.sendMessage(tabID, { __opencodeContent: true, op, input })
  if (!response) throw new Error(`Tab ${tabID} did not answer ${op}.`)
  if (!response.ok) throw new Error(response.error)
  return response.value
}

async function evaluate(input) {
  if (input.ref) return content(input.tabID, "evaluate", input)
  await ensureContent(input.tabID)
  const results = await chrome.scripting.executeScript({
    target: { tabId: input.tabID },
    world: input.world === "isolated" ? "ISOLATED" : "MAIN",
    func: (source) => {
      const value = (0, eval)(source)
      try {
        return JSON.parse(JSON.stringify(value ?? null))
      } catch {
        return String(value)
      }
    },
    args: [String(input.script)],
  })
  const result = results[0]
  if (result?.error) throw new Error(String(result.error.message ?? result.error))
  return { value: result?.result ?? null }
}

async function upload(input) {
  return content(input.tabID, "upload", { ref: input.ref, files: input.files })
}

async function screenshot(input) {
  const tab = await chrome.tabs.get(input.tabID)
  const format = input.format ?? "png"
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format,
    quality: format === "png" ? undefined : (input.quality ?? 80),
  })
  if (!input.ref) return { dataUrl, mime: `image/${format}` }
  const rect = await content(input.tabID, "rect", { ref: input.ref })
  return { ...(await crop(dataUrl, rect, format, input.quality)), rect }
}

async function crop(dataUrl, rect, format, quality) {
  const source = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const ratio = rect.devicePixelRatio
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(rect.width * ratio)),
    Math.max(1, Math.round(rect.height * ratio)),
  )
  const context = canvas.getContext("2d")
  context.drawImage(
    source,
    Math.round(rect.x * ratio),
    Math.round(rect.y * ratio),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  const output = await canvas.convertToBlob({ type: `image/${format}`, quality: (quality ?? 80) / 100 })
  const buffer = await output.arrayBuffer()
  let binary = ""
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return { dataUrl: `data:image/${format};base64,${btoa(binary)}`, mime: `image/${format}` }
}

async function consoleMessages(input) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: input.tabID },
    world: "MAIN",
    func: (level, limit) => window.__opencodeAgentHooks?.console(level, limit) ?? [],
    args: [input.level ?? "info", input.limit ?? 100],
  })
  return { messages: results[0]?.result ?? [] }
}

async function pageDialogs(input) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: input.tabID },
    world: "MAIN",
    func: (limit) => window.__opencodeAgentHooks?.dialogs(limit) ?? [],
    args: [input.limit ?? 50],
  })
  return { dialogs: results[0]?.result ?? [] }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "opencode.connect") {
    chrome.storage.local.remove("token").then(connect)
    sendResponse({ ok: true })
    return undefined
  }
  if (message?.type === "opencode.status") {
    if (socket?.readyState !== WebSocket.OPEN && !connecting) connect()
    status().then((value) => sendResponse({ ok: true, value }))
    return true
  }
  return undefined
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "opencode-reconnect") return
  connect()
})

chrome.runtime.onInstalled.addListener(() => {
  keepAlarm()
  connect()
})

chrome.runtime.onStartup.addListener(() => {
  keepAlarm()
  connect()
})

keepAlarm()
loadConfig().then(connect)
