import { Browser } from "@opencode/plugin-browser/rpc"
import electron, { type BrowserWindow, type WebContents } from "electron"
import type { Protocol } from "devtools-protocol"
import { Schema } from "effect"
import type { Embeds } from "@opencode/plugin/gui/main"
import { createElectronCdp, abortError, waitFor } from "./cdp"
import { createBrowserFiles } from "./files"
import { createDiagnostics } from "./diagnostics"
import { loadIcon } from "./icon"
import { pageLetter, pageReload, pageShortcut, type PageShortcut } from "./keys"
import { createPageCdp } from "./page-cdp"
import type { Shared } from "./page-shared"
import {
  createDocumentState,
  documentGeneration,
  documentIcon,
  documentTab,
  isDocumentClosed,
  transitionDocument,
  type DocumentEvent,
} from "./page-machine"
import { createProfiling } from "./profiling"
import type { BrowserNetwork } from "./network"
import {
  allowedDestination,
  committedLoad,
  destinationOrigin,
  fileURLWithin,
  localFileURL,
  normalizeURL,
  refusal,
  type Policy,
} from "./policy"
import type { PaneElement } from "./ipc"

/** The shared state a page of the pane uses; exported for the pane's other page implementations. */
export type { Shared }

// Captures and downloads belong to the tab, not whichever document it now shows; navigate replaces it anyway.
const retainedOperations: readonly Browser.Method[] = [
  "navigate",
  "files.list",
  "files.get",
  "trace.stop",
  "trace.analyze",
  "cpu.stop",
  "cpu.analyze",
  "heap.summary",
  "heap.query",
  "heap.object",
  "heap.compare",
]

// Input the page receives while the element picker is on would pick an element instead.
const pointerOperations: readonly Browser.Method[] = [
  "click",
  "hover",
  "drag",
  "fill",
  "fill_form",
  "select",
  "check",
  "press",
  "scroll",
  "files.drop",
]

/** Virtual key codes of the named keys `press` accepts. */
// Chromium DevTools' element picker colors, so the overlay matches the Elements panel.
const inspectHighlight: Protocol.Overlay.HighlightConfig = {
  showInfo: true,
  showStyles: true,
  showAccessibilityInfo: true,
  colorFormat: "hex",
  contrastAlgorithm: "aa",
  contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
  eventTargetColor: { r: 255, g: 196, b: 196, a: 0.66 },
  // SAFETY: CDP's Overlay.HighlightConfig names these two fields; they are the protocol's, not ours to rename.
  /* oxlint-disable anti-slop/no-shape-in-symbol-names -- see SAFETY above */
  shapeColor: { r: 96, g: 82, b: 177, a: 0.8 },
  shapeMarginColor: { r: 96, g: 82, b: 127, a: 0.6 },
  /* oxlint-enable anti-slop/no-shape-in-symbol-names */
}

const pickedHighlight = { ...inspectHighlight, showInfo: false, showStyles: false, showAccessibilityInfo: false }

// Chromium rejects mode "none" without a config. A rejected call leaves the picker armed, and the
// next hideHighlight would put its hover tool back.
const inspectOff = { mode: "none", highlightConfig: inspectHighlight }

// Chromium's zoom presets, so a step lands where it would in the system browser.
const zoomSteps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

/** A page's icon as a data URL, and its zoom factor, 1 at 100%. */
export type PageDetail = { icon?: string; zoom: number }

/** The zoom a key press asks for: the system browser's zoom keys, with the platform's modifier already checked. */
function zoomKey(input: Electron.Input) {
  if (input.key === "=" || input.key === "+" || input.code === "NumpadAdd") return "in"

  if (input.key === "-" || input.code === "NumpadSubtract") return "out"

  if (input.key === "0") return "reset"
}

/**
 * The address a cookie is removed by: its domain without the leading dot, its path, and its scheme. An IPv6 host
 * needs its brackets in a URL.
 */
function cookieURL(cookie: Electron.Cookie) {
  const domain = (cookie.domain ?? "").replace(/^\./, "")
  const host = domain.includes(":") && !domain.startsWith("[") ? `[${domain}]` : domain

  return `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`
}

/** The next preset in the direction, or 100%; the current factor at either end. */
function zoomStep(current: number, direction: "in" | "out" | "reset") {
  if (direction === "reset") return 1

  if (direction === "in") return zoomSteps.find((step) => step > current + 0.001) ?? current

  return zoomSteps.findLast((step) => step < current - 0.001) ?? current
}

export type BrowserPage = ReturnType<typeof createBrowserPage>

export function createBrowserPage(
  win: BrowserWindow,
  options: {
    id: Browser.TabID
    partition: string
    network: BrowserNetwork | null
    publish: (error?: string) => void
    /** Reports the element picker starting, stopping, or picking an element. */
    inspect?: (event: { active: boolean; element?: PaneElement }) => void
    /** Reports the page's icon or zoom changing. */
    detail?: (detail: PageDetail) => void
    /** The page's zoom changed, which Chromium applies to every page of the same origin in the partition. */
    zoomed?: () => void
    /** Hands a browser or shell shortcut to the app window. */
    shortcut?: (shortcut: PageShortcut) => void
    /** The page took keyboard focus. */
    focused?: () => void
    fail: () => void
    /** Adopts a page the document opened; a background one leaves the current tab selected. */
    popup: (options: Electron.BrowserWindowConstructorOptions, background: boolean) => WebContents
    initialize?: boolean
    restore?: Browser.Tab
    popupOptions?: Electron.BrowserWindowConstructorOptions
    /** Directories whose files may load as file:// documents; empty when the server is remote. */
    fileRoots?: () => ReadonlyArray<string>
    shared: Shared
    embeds: Embeds
  },
) {
  const policy: Policy = {
    get fileRoots() {
      return options.fileRoots?.() ?? []
    },
  }

  const view = new electron.WebContentsView({
    ...options.popupOptions,
    webPreferences: {
      partition: options.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
      backgroundThrottling: false,
      // Agent navigation, including in hidden tabs, must not take the user's keyboard focus.
      focusOnNavigation: false,
    },
  })

  const contents = view.webContents
  const detachNetwork = options.network?.attach(contents)
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return

    if (pageReload(input, process.platform === "darwin")) {
      event.preventDefault()
      contents.reload()

      return
    }

    if (input.key === "Escape" && inspecting) {
      event.preventDefault()
      void toggleInspect(false)

      return
    }

    const shortcut = pageShortcut(input, process.platform === "darwin")

    if (shortcut) {
      event.preventDefault()
      options.shortcut?.(shortcut)

      return
    }

    if (input.alt || !(process.platform === "darwin" ? input.meta : input.control)) return

    // The same chord as Chromium DevTools' element picker.
    if (input.shift && pageLetter(input) === "c") {
      event.preventDefault()
      void toggleInspect(!inspecting)

      return
    }

    const direction = zoomKey(input)

    if (!direction) return
    event.preventDefault()
    zoom(direction)
  })
  // Ctrl or Cmd with the mouse wheel; Electron leaves applying it to the app.
  contents.on("zoom-changed", (_event, direction) => zoom(direction))

  const zoom = (direction: "in" | "out" | "reset") => {
    const current = contents.getZoomFactor()
    const next = zoomStep(current, direction)

    if (next === current) return
    contents.setZoomFactor(next)
    options.zoomed?.()
  }

  let documentState = createDocumentState(options.restore)
  const closed = () => isDocumentClosed(documentState)
  let reported = ""

  const detail = () => {
    if (closed()) return
    // Chromium's factor for the outermost presets can land a rounding error outside them.
    const next: PageDetail = { zoom: Math.min(5, Math.max(0.25, contents.getZoomFactor())) }
    const icon = documentIcon(documentState)

    if (icon) next.icon = icon
    const key = `${next.zoom}:${next.icon ?? ""}`

    if (key === reported) return
    reported = key
    options.detail?.(next)
  }

  const cdp = createElectronCdp(contents)
  const documents = new Map<string, string>()
  const sourceURLs = () => [...new Set([contents.getURL(), ...documents.values()])].sort()
  const files = createBrowserFiles(sourceURLs)
  const diagnostics = createDiagnostics(cdp)
  const core = createPageCdp({
    cdp,
    files,
    diagnostics,
    shared: options.shared,
    // A hidden WebContentsView can hold its compositor; this makes a scrolled element's position current.
    nudge: async () => {
      await contents.capturePage(undefined, { stayHidden: false, stayAwake: true })
    },
  })
  const profiling = createProfiling(contents, cdp, files, sourceURLs, options.shared)
  let inspecting = false
  // Bumped by every picker toggle and hide, so a pick still being described can tell it was cancelled.
  let picks = 0
  let flash: ReturnType<typeof setTimeout> | undefined
  const dialogs = new Set<() => void>()
  let dialog: { type: string; message: string; defaultValue: string } | null = null
  let dialogURL = ""
  let dialogRevision = 0
  let revision = 0
  cdp.on("Page.frameNavigated", ({ frame }) => {
    documents.set(frame.id, frame.url)
    revision++
  })
  cdp.on("Page.frameDetached", ({ frameId }) => {
    documents.delete(frameId)
    revision++
  })

  const state = () =>
    documentTab(documentState, {
      id: options.id,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    })

  // Every state report goes through here, so a page that was disposed publishes nothing.
  const publish = (error?: string) => {
    if (!closed()) options.publish(error)
  }

  const dispatch = (event: DocumentEvent) => {
    const next = transitionDocument(documentState, event)
    documentState = next.state
    next.effects.forEach((effect) => {
      switch (effect.type) {
        case "reset-document":
          documents.clear()
          core.refs.clear()
          core.picked.clear()

          if (inspecting) void toggleInspect(false)
          break
        case "clear-diagnostics":
          diagnostics.clear()
          break
        case "show":
          // The renderer's layout requests may lag behind navigation; the page decides
          // whether there is a document worth exposing over the themed background.
          embed.show(effect.visible)
          break
        case "publish":
          publish()
          break
        case "detail":
          detail()
          break
        case "load-icon":
          // Never rejects: an icon that does not load is none.
          void loadIcon(effect.favicons, options.network).then((icon) =>
            dispatch({ type: "icon.loaded", attempt: effect.attempt, icon }),
          )
      }
    })
  }

  contents.on("did-start-loading", () => dispatch({ type: "loading.started" }))
  contents.on("did-stop-loading", () => dispatch({ type: "loading.stopped", title: contents.getTitle() }))
  contents.on("did-start-navigation", (event) =>
    dispatch({
      type: "navigation.started",
      url: event.url,
      isMainFrame: event.isMainFrame,
      isSameDocument: event.isSameDocument,
    }),
  )
  contents.on("did-navigate", (_event, url, status, statusText) =>
    dispatch({ type: "navigation.committed", url, status, statusText, title: contents.getTitle() }),
  )
  contents.on("did-fail-load", (_event, code, description, url, isMainFrame) =>
    dispatch({ type: "navigation.failed", code, description, url, isMainFrame }),
  )
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) =>
    dispatch({ type: "navigation.in-page", url, title: contents.getTitle(), isMainFrame }),
  )
  contents.on("dom-ready", () => dispatch({ type: "document.ready" }))
  contents.on("page-title-updated", () => dispatch({ type: "title.updated", title: contents.getTitle() }))
  contents.on("page-favicon-updated", (_event, favicons) => dispatch({ type: "icon.updated", favicons }))
  contents.on("focus", () => {
    if (!closed()) options.focused?.()
  })
  contents.on("render-process-gone", () => {
    if (!closed()) options.fail()
  })
  contents.debugger.on("detach", () => {
    if (!closed()) options.fail()
  })
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  contents.session.setPermissionCheckHandler(() => false)
  contents.session.setDevicePermissionHandler(() => false)
  contents.session.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  contents.on("content-bounds-updated", (event) => event.preventDefault())

  // Sub-frames keep Chromium's own rules so blob:/data: viewers and sandboxed previews still load,
  // except file: documents, which must stay inside the allowed roots at every depth.
  const guard = (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
    if (event.url === "about:blank") return

    if (event.isMainFrame ? allowedDestination(event.url, policy) : !localFileURL(event.url)) return

    if (!event.isMainFrame && fileURLWithin(event.url, policy.fileRoots ?? [])) return
    event.preventDefault()
    // The same reason a typed address gets, so a blocked link and a blocked address read alike.
    publish(refusal(event.url, policy) ?? "ERR_BLOCKED_BY_CLIENT")
  }

  contents.on("will-frame-navigate", guard)
  contents.on("will-redirect", guard)
  // Links opened with Cmd or Ctrl arrive as background tabs, and stay behind the current one as in the system browser.
  contents.setWindowOpenHandler(({ url, disposition }) =>
    url === "about:blank" || destinationOrigin(url)
      ? {
          action: "allow",
          outlivesOpener: true,
          overrideBrowserWindowOptions: {
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true,
              webviewTag: false,
              devTools: false,
              // Electron applies these preferences before the popup is adopted by our view.
              focusOnNavigation: false,
              partition: options.partition,
            },
          },
          createWindow: (popupOptions) => options.popup(popupOptions, disposition === "background-tab"),
        }
      : { action: "deny" },
  )

  const download = (_event: Electron.Event, item: Electron.DownloadItem, source: WebContents) => {
    if (source !== contents) return

    try {
      const file = files.add(item.getFilename(), item.getMimeType() || "application/octet-stream", [
        ...sourceURLs(),
        ...item.getURLChain(),
      ])

      item.setSavePath(file.path)
      item.on("updated", () => {
        file.bytes = item.getReceivedBytes()

        if (file.bytes > Browser.MAX_FILE_BYTES) item.cancel()
      })
      item.once("done", (_event, status) => {
        file.bytes = item.getReceivedBytes()
        file.state = status === "completed" ? "completed" : "failed"
      })
    } catch {
      item.cancel()
      publish("download_failed")
    }
  }

  contents.session.on("will-download", download)
  core.track((sessionId) => {
    void Promise.all([
      diagnostics.enable(sessionId),
      cdp.send("Page.enable", {}, sessionId),
      cdp.send(
        "Target.setAutoAttach",
        {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
          filter: [{ type: "iframe", exclude: false }, { exclude: true }],
        },
        sessionId,
      ),
      ...(inspecting ? [arm(sessionId)] : []),
    ]).catch(() => undefined)
  })
  // Each out-of-process frame runs its own picker; the frame under the pointer reports the click.
  cdp.on("Overlay.inspectNodeRequested", ({ backendNodeId }, sessionID) => {
    if (!inspecting) return
    void inspected(backendNodeId, sessionID).catch(() => {
      void hideHighlight()
      options.inspect?.({ active: false })
    })
  })
  cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
    core.sessions.forEach((id, frameID) => {
      if (id === sessionId) {
        core.sessions.delete(frameID)
        core.parents.delete(frameID)
      }
    })
  })
  cdp.on("Page.javascriptDialogOpening", (event) => {
    dialogURL = event.url
    dialogRevision++
    dialog = {
      type: event.type,
      message: event.message.slice(0, Browser.MAX_TEXT),
      defaultValue: event.defaultPrompt ?? "",
    }
    dialogs.forEach((reject) => reject())
    publish()
  })
  cdp.on("Page.javascriptDialogClosed", () => {
    dialogRevision++
    dialog = null
    publish()
  })
  // Hidden tabs keep a desktop-sized viewport until the renderer lays the embed out.
  view.setBounds({ x: 0, y: 0, width: 1000, height: 700 })
  const embed = options.embeds.create(view, win)
  // A hidden page cannot be picked from, and a comment's frozen still already shows the
  // picked element, so hiding ends the picker, any pick in progress, and the highlight.
  embed.on("visible", (visible) => {
    if (visible || closed()) return
    picks++
    void (inspecting ? toggleInspect(false) : hideHighlight())
  })

  const load = (url: string) => {
    let committed = false

    const commit = () => {
      committed = true
    }

    contents.once("did-navigate", commit)

    return contents
      .loadURL(url)
      .catch((error: Error) => {
        if (!committedLoad(error, committed)) throw error
      })
      .finally(() => contents.off("did-navigate", commit))
  }

  const ready = Promise.all([
    files.ready,
    ...(options.initialize === false
      ? []
      : [
          load(normalizeURL(options.restore?.url || "about:blank", policy)).catch((error: Error) => {
            if (!options.restore) throw error
            // A dev server may have stopped while this page was unloaded. Keep its tab available to retry.
            publish(error.message)
          }),
        ]),
    diagnostics.enable(),
    cdp.send("Page.enable"),
    cdp.send("DOM.enable"),
    cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "iframe", exclude: false }, { exclude: true }],
    }),
  ]).then(() => undefined)

  return {
    view,
    contents,
    state,
    ready,
    /** The host embed the renderer lays this page out with. */
    embed: embed.id,
    async inspect(enabled: boolean) {
      if (closed()) return
      await ready
      await toggleInspect(enabled)
    },
    async highlight(ref?: Browser.Ref) {
      if (closed()) return
      await highlightPicked(ref).catch(() => undefined)
    },
    zoom(direction: "in" | "out" | "reset") {
      if (!closed()) zoom(direction)
    },
    async site() {
      const url = contents.getURL()

      if (closed() || !destinationOrigin(url)) return { cookies: 0 }

      return { cookies: (await contents.session.cookies.get({ url })).length }
    },
    /**
     * Deletes what the page's site stored: the cookies its address can read, and its origin's storage. Resolves once
     * the page reloaded without them, so a count read next includes what the reload set again.
     */
    async clearSite() {
      const url = contents.getURL()
      const origin = destinationOrigin(url)

      if (closed() || !origin) return
      const cookies = await contents.session.cookies.get({ url })
      await Promise.all(cookies.map((cookie) => contents.session.cookies.remove(cookieURL(cookie), cookie.name)))
      await contents.session.clearStorageData({
        origin,
        storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage", "filesystem", "shadercache"],
      })

      if (closed()) return
      contents.reload()
      // A slow page still cleared; the count then reads what it set so far.
      await waitFor(() => closed() || !contents.isLoading(), new AbortController().signal, 30_000).catch(
        () => undefined,
      )
    },
    /** Reports the page's icon and zoom when either changed since the last report. */
    detail,
    async execute(command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
      await ready
      abortError(signal)

      if (closed())
        throw new Error(
          "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID; do not reuse the closed tab's refs.",
        )

      if (inspecting && pointerOperations.includes(command.action.type)) await toggleInspect(false)

      if (dialog && command.action.type !== "dialog")
        throw new Error(
          'A JavaScript dialog is open. Inspect it with browser.dialog({tabID,action:"get"}), then explicitly accept or dismiss it before continuing.',
        )

      if (command.inspect) return { value: await inspect(command.action), files: [] }

      if (command.target && JSON.stringify(await inspect(command.action)) !== JSON.stringify(command.target))
        throw new Error(
          "Browser target changed while permission was pending. Take a fresh snapshot or listing and request the action again; it was not executed.",
        )

      if (
        command.generation !== undefined &&
        command.generation !== documentGeneration(documentState) &&
        !retainedOperations.includes(command.action.type)
      )
        throw new Error(
          "The document changed before this operation ran. Call browser.tabs.list({}) to check its current URL, then browser.snapshot({tabID}) for fresh refs. Reconsider the action before retrying on the new page.",
        )
      const modal = Promise.withResolvers<never>()
      const cancelled = Promise.withResolvers<never>()
      // The action underneath the race keeps running after a dialog wins it; it checks this
      // signal before each further step, so a validation alert on one field stops the rest.
      // A navigation is left alone: its beforeunload dialog is answered through browser.dialog
      // and the pending load then proceeds or not.
      const run = new AbortController()

      const cancel = () => {
        run.abort()
        cancelled.reject(
          new Error(
            "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
          ),
        )
      }

      signal.addEventListener("abort", cancel, { once: true })

      const reject = () => {
        if (command.action.type !== "navigate") run.abort()
        modal.reject(
          new Error(
            'A JavaScript dialog opened while the action was running. Inspect it with browser.dialog({tabID,action:"get"}) and accept or dismiss it. Do not repeat the original action just to close the dialog.',
          ),
        )
      }

      if (command.action.type !== "dialog") dialogs.add(reject)

      try {
        return await Promise.race([
          execute(command.action, command.files, run.signal, command.target),
          modal.promise,
          cancelled.promise,
        ])
      } finally {
        signal.removeEventListener("abort", cancel)
        dialogs.delete(reject)
      }
    },
    async dispose() {
      if (closed()) return
      dispatch({ type: "disposed" })
      clearTimeout(flash)
      detachNetwork?.()
      contents.session.off("will-download", download)
      await profiling.dispose()
      cdp.dispose()
      core.refs.clear()
      core.picked.clear()
      embed.dispose()

      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
      await files.dispose()
    },
  }

  async function execute(
    action: Browser.Action,
    transfers: readonly Browser.File[],
    signal: AbortSignal,
    approved?: Browser.Target,
  ): Promise<Browser.Result> {
    const captureSources = sourceURLs()
    const transfer = (id: Browser.FileID) => files.transfer(id, approved?.resources)

    const result = <T>(value: T, attached: Browser.File[] = []): Browser.Result => {
      const json = Schema.decodeUnknownSync(Schema.Json)(value)

      if (JSON.stringify(json).length > 512_000)
        throw new Error(
          "Browser result exceeds 512000 JSON characters. Request fewer entries, reduce snapshot depth, or return only selected fields from the evaluation script. Repeating the same request will not reduce its output.",
        )

      return { value: json, files: attached }
    }

    switch (action.type) {
      case "navigate": {
        const url = normalizeURL(action.url, policy)
        const cancel = () => contents.stop()
        signal.addEventListener("abort", cancel, { once: true })

        try {
          await load(url)
        } finally {
          signal.removeEventListener("abort", cancel)
        }

        abortError(signal)

        return result(state())
      }

      case "back":
      case "forward":
      case "reload":
      case "stop": {
        if (action.type === "back" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()

        if (action.type === "forward" && contents.navigationHistory.canGoForward())
          contents.navigationHistory.goForward()

        if (action.type === "reload") contents.reload()

        if (action.type === "stop") contents.stop()

        if (action.type !== "stop") await waitFor(() => !contents.isLoading(), signal, 30_000)

        return result(state())
      }

      case "frames":
        return result({ tab: state(), frames: await core.frames() })
      case "snapshot":
      case "find":
        return result({ tab: state(), ...(await core.snapshot(action)) })
      case "evaluate": {
        if (action.ref && action.frameID)
          throw new Error(
            "Pass either ref or frameID to browser.evaluate, not both. A ref already runs in its element's frame.",
          )
        const context = action.frameID ? core.contexts.get(action.frameID) : undefined

        if (action.frameID && !context)
          throw new Error(
            "Frame context is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab, or omit frameID to target the main frame.",
          )
        const element = action.ref ? core.target(action.ref) : undefined
        const objectId = element ? await core.resolve(element) : undefined

        // With a ref, the script is a function that receives the element as its argument and as `this`.
        const value = await (element && objectId
          ? cdp
              .send(
                "Runtime.callFunctionOn",
                {
                  objectId,
                  functionDeclaration: action.script,
                  arguments: [{ objectId }],
                  awaitPromise: true,
                  returnByValue: true,
                  userGesture: true,
                },
                element.sessionID,
              )
              .finally(() => cdp.send("Runtime.releaseObject", { objectId }, element.sessionID).catch(() => undefined))
          : cdp.send(
              "Runtime.evaluate",
              {
                expression: action.script,
                contextId: context?.id,
                awaitPromise: true,
                returnByValue: true,
                userGesture: true,
              },
              context?.sessionID,
            ))

        if (value.exceptionDetails)
          throw new Error(
            `Page JavaScript threw an exception. Check the script and ${action.ref ? "ref" : "frameID"}; inspect the page before repeating code with side effects. Details: ${(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text).slice(0, 800)}`,
          )
        abortError(signal)

        return result({ tab: state(), value: value.result.value ?? null })
      }

      case "click":
        await core.click(core.target(action.ref), action.button ?? "left", action.count ?? 1, action.modifiers)
        break
      case "hover":
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...(await core.point(core.target(action.ref))),
        })
        break
      case "drag": {
        const source = core.target(action.from)
        const destination = core.target(action.to)
        await core.point(destination)
        const from = await core.point(source)
        const box = await core.rect(destination)
        const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const html5 = await core.call(source, "function() { return this.draggable; }")
        let data: Protocol.Input.DragData | undefined

        const off = cdp.on("Input.dragIntercepted", (event) => {
          data = event.data
        })

        await cdp.send("Input.setInterceptDrags", { enabled: true })
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from })
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...from,
          button: "left",
          buttons: 1,
          clickCount: 1,
        })

        try {
          for (let i = 1; i <= 10; i++) {
            abortError(signal)
            await cdp.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: from.x + ((to.x - from.x) * i) / 10,
              y: from.y + ((to.y - from.y) * i) / 10,
              button: "left",
              buttons: 1,
            })
          }

          if (html5) await waitFor(() => data !== undefined, signal, 2_000)

          if (data) {
            for (const type of ["dragEnter", "dragOver", "drop"])
              await cdp.send("Input.dispatchDragEvent", { type, ...to, data })
          }
        } finally {
          off()
          await cdp.send("Input.setInterceptDrags", { enabled: false })
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 })
        }

        break
      }

      case "fill":
        await core.fill(core.target(action.ref), action.text, signal)
        break
      case "fill_form":
        for (const field of action.fields) {
          abortError(signal)

          if (field.type === "text") await core.fill(core.target(field.ref), field.value, signal)

          if (field.type === "select") await core.select(core.target(field.ref), field.values)

          if (field.type === "check") await core.check(core.target(field.ref), field.checked)
        }

        break
      case "select":
        await core.select(core.target(action.ref), action.values)
        break
      case "check":
        await core.check(core.target(action.ref), action.checked)
        break
      case "press":
        await core.key(action.key)
        break
      case "scroll": {
        const bounds = view.getBounds()
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: bounds.width / 2,
          y: bounds.height / 2,
          deltaX: action.deltaX ?? 0,
          deltaY: action.deltaY,
        })
        break
      }

      case "wait": {
        if (action.condition !== "load" && !action.text)
          throw new Error(
            'browser.wait requires non-empty text for condition "text" or "textGone". Use condition "load" without text to wait for loading.',
          )
        await waitFor(
          async () => {
            if (action.condition === "load") return !contents.isLoading()
            const context = action.frameID ? core.contexts.get(action.frameID) : undefined

            if (action.frameID && !context)
              throw new Error(
                "Frame context is unavailable. Call browser.frames({tabID}) and use a frameID from this tab.",
              )

            const value = await cdp.send(
              "Runtime.evaluate",
              {
                expression: `document.body?.innerText.includes(${JSON.stringify(action.text)}) ?? false`,
                returnByValue: true,
                contextId: context?.id,
              },
              context?.sessionID,
            )

            return Boolean(value.result.value) === (action.condition === "text")
          },
          signal,
          action.timeoutMs,
        ).catch((error) => {
          if (signal.aborted) throw error
          throw new Error(
            `browser.wait failed for condition ${JSON.stringify(action.condition)} (timeoutMs: ${action.timeoutMs ?? 10_000}). Inspect browser.snapshot({tabID}) and check text/frameID before retrying; timeoutMs can be increased up to 30000 for a genuinely slow page. Details: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
        break
      }

      case "screenshot": {
        if (action.ref && action.fullPage)
          throw new Error(
            "Choose either ref for an element screenshot or fullPage:true for the whole page. Remove the other argument before retrying.",
          )
        await waitFor(() => view.getVisible() && win.isVisible() && !win.isMinimized(), signal, 3_000).catch(
          (error) => {
            if (signal.aborted) throw error
            throw new Error(
              "Screenshot needs a visible tab. Call browser.tabs.focus and keep its desktop window visible.",
            )
          },
        )
        const element = action.ref ? await core.rect(core.target(action.ref), true) : undefined
        const metrics = await cdp.send("Page.getLayoutMetrics")

        const bounds = element
          ? {
              ...element,
              x: element.x + metrics.cssVisualViewport.pageX,
              y: element.y + metrics.cssVisualViewport.pageY,
            }
          : action.fullPage
            ? metrics.cssContentSize
            : {
                x: metrics.cssVisualViewport.pageX,
                y: metrics.cssVisualViewport.pageY,
                width: metrics.cssVisualViewport.clientWidth,
                height: metrics.cssVisualViewport.clientHeight,
              }

        const pixelRatio = contents.getZoomFactor() * electron.screen.getDisplayMatching(win.getBounds()).scaleFactor
        const scale = Math.min(1, (action.maxWidth ?? 2000) / (bounds.width * pixelRatio))

        if (bounds.width <= 0 || bounds.height <= 0)
          throw new Error(
            "Element or page has no visible screenshot area. Take a fresh snapshot and choose a visible element, or omit ref to capture the viewport.",
          )

        if (bounds.width * bounds.height * (scale * pixelRatio) ** 2 > 16_000_000)
          throw new Error("Screenshot exceeds 16 megapixels; capture an element or use a smaller maxWidth.")
        const format = action.format ?? "jpeg"

        const capture = await cdp.send("Page.captureScreenshot", {
          format,
          quality: format === "png" ? undefined : (action.quality ?? 80),
          captureBeyondViewport: true,
          clip: { ...bounds, scale },
        })

        const id = await files.save(`screenshot.${format}`, `image/${format}`, Buffer.from(capture.data, "base64"), [
          ...captureSources,
          ...sourceURLs(),
        ])

        return result({ tab: state() }, [await transfer(id)])
      }

      case "dialog": {
        if (action.action !== "get") {
          if (!dialog)
            throw new Error(
              'This tab has no JavaScript dialog to handle. browser.dialog({tabID,action:"get"}) returns null when none is open; continue without accepting or dismissing one.',
            )
          await cdp.send("Page.handleJavaScriptDialog", {
            accept: action.action === "accept",
            promptText: action.promptText,
          })
          dialog = null
        }

        return result({ tab: state(), dialog })
      }

      case "files.upload":
      case "files.drop": {
        if (!transfers.length)
          throw new Error(
            "Upload command has no file bytes. Supply server-local paths to browser.files.upload/drop; do not call the desktop RPC directly with desktop paths. If paths were supplied, report a client/server transfer mismatch.",
          )

        const local = await Promise.all(
          transfers.map(async (file) => files.get(await files.save(file.name, file.mime, file.data)).path),
        )

        const element = core.target(action.ref)

        if (action.type === "files.upload")
          await cdp.send("DOM.setFileInputFiles", { files: local, backendNodeId: element.backendID }, element.sessionID)

        if (action.type === "files.drop") {
          const position = await core.point(element)

          for (const type of ["dragEnter", "dragOver", "drop"])
            await cdp.send("Input.dispatchDragEvent", {
              type,
              ...position,
              data: { items: [], files: local, dragOperationsMask: 1 },
            })
        }

        break
      }

      case "files.list":
        return result({ tab: state(), files: files.list() })
      case "files.get":
        return result({ tab: state() }, [await transfer(action.fileID)])
      case "console":
        return result({ tab: state(), ...diagnostics.console(action) })
      case "network.list":
        return result({ tab: state(), ...diagnostics.list(action) })
      case "network.get":
        return result({ tab: state(), ...(await diagnostics.get(action)) })
      case "trace.start":
        await profiling.startTrace(action.durationMs)

        return result({ tab: state(), recording: true })
      case "trace.stop": {
        const value = await profiling.stopTrace()

        return result({ tab: state(), durationMs: value.durationMs, incomplete: value.incomplete }, [
          await transfer(value.id),
        ])
      }

      case "cpu.start":
        await profiling.startCpu()

        return result({ tab: state(), recording: true })
      case "cpu.stop": {
        const value = await profiling.stopCpu()

        return result({ tab: state(), durationMs: value.durationMs }, [await transfer(value.id)])
      }

      case "heap.snapshot":
        return result({ tab: state() }, [await transfer(await profiling.heap())])
      case "trace.analyze":
      case "cpu.analyze":
      case "heap.summary":
      case "heap.query":
      case "heap.object":
      case "heap.compare":
        return result({ tab: state(), ...(await profiling.analyze(action)) })
      case "lighthouse": {
        const { audit } = await import("./lighthouse")
        const report = await audit(contents, files, cdp, captureSources)

        return result(
          { tab: state(), scores: report.scores, failures: report.failures },
          await Promise.all(report.files.map(transfer)),
        )
      }

      default:
        throw new Error(
          "This operation was routed to a page instead of the tab manager. Report a desktop/plugin routing mismatch; changing tab IDs or repeating the operation will not fix it.",
        )
    }

    abortError(signal)

    return result(state())
  }

  async function inspect(action: Browser.Action): Promise<Browser.Target> {
    // Most CDP queries cannot run while a JavaScript dialog blocks the renderer.
    if (action.type === "dialog")
      return {
        resources: [dialog ? dialogURL : contents.getURL()],
        key: `${documentGeneration(documentState)}:${dialogRevision}:${Boolean(dialog)}`,
      }

    const fileIDs =
      action.type === "heap.compare" ? [action.before, action.after] : "fileID" in action ? [action.fileID] : []

    if (fileIDs.length)
      return {
        resources: [...new Set(fileIDs.flatMap((id) => files.get(id).resources))].sort(),
        key: JSON.stringify(fileIDs),
      }

    if (action.type === "network.get") return { resources: [diagnostics.info(action.id).url], key: action.id }

    if (action.type === "trace.stop" || action.type === "cpu.stop")
      return profiling.target(action.type === "trace.stop" ? "trace" : "cpu")
    const tree = await core.frames()
    tree.forEach((frame) => documents.set(frame.id, frame.url))

    const selectedRefs =
      action.type === "drag"
        ? [action.from, action.to]
        : action.type === "fill_form"
          ? action.fields.map((field) => field.ref)
          : "ref" in action && action.ref
            ? [action.ref]
            : []

    const selected = selectedRefs.map(core.target)

    const frameIDs = selected.length
      ? selected.map((element) => element.frameID)
      : "frameID" in action && action.frameID
        ? [action.frameID]
        : []

    const urls = frameIDs.map((id) => {
      const frame = tree.find((frame) => frame.id === id)

      if (!frame) throw new Error("Frame is unavailable. Call browser.frames({tabID}) and use a current frameID.")

      return frame.url
    })

    const capture = ["screenshot", "lighthouse", "trace.start", "cpu.start", "heap.snapshot"].includes(action.type)

    return {
      resources: [
        ...new Set(
          action.type === "navigate"
            ? [new URL(normalizeURL(action.url, policy)).href]
            : capture
              ? sourceURLs()
              : urls.length
                ? urls
                : [contents.getURL()],
        ),
      ].sort(),
      key: JSON.stringify([documentGeneration(documentState), revision, selected]),
    }
  }

  async function toggleInspect(enabled: boolean) {
    picks++

    if (enabled !== inspecting) {
      inspecting = enabled
      clearTimeout(flash)
      await Promise.all(
        [undefined, ...core.sessions.values()].map((sessionID) =>
          (enabled ? arm(sessionID) : cdp.send("Overlay.setInspectMode", inspectOff, sessionID)).catch(() => undefined),
        ),
      )

      if (!enabled) await hideHighlight()
    }

    // A later toggle may have finished first; report where the picker ended up.
    options.inspect?.({ active: inspecting })
  }

  async function arm(sessionID?: string) {
    // The main target enables DOM at startup; frame targets only need it for the picker.
    if (sessionID) await cdp.send("DOM.enable", {}, sessionID)
    await cdp.send("Overlay.enable", {}, sessionID)

    // The picker may have been turned off while the domains were enabling.
    if (!inspecting) return
    await cdp.send("Overlay.setInspectMode", { mode: "searchForNode", highlightConfig: inspectHighlight }, sessionID)
  }

  async function inspected(backendID: number, sessionID?: string) {
    inspecting = false
    const pick = ++picks
    const navigation = documentGeneration(documentState)
    await Promise.all(
      [undefined, ...core.sessions.values()].map((id) =>
        cdp.send("Overlay.setInspectMode", inspectOff, id).catch(() => undefined),
      ),
    )
    // Keep the box model on the picked element, without the tooltip, while the renderer freezes the page.
    await cdp.send("Overlay.highlightNode", { backendNodeId: backendID, highlightConfig: pickedHighlight }, sessionID)
    const element = { backendID, frameID: await frameOf(backendID, sessionID), sessionID }
    const [details, box, accessible] = await Promise.all([
      core.describe(element),
      core.rect(element),
      core.accessibility(element),
    ])
    await painted(sessionID)

    // Escape, a toggle, hiding, or navigation while the element was described cancels the pick.
    if (closed()) return

    if (pick !== picks || navigation !== documentGeneration(documentState)) {
      if (!inspecting) await hideHighlight()
      options.inspect?.({ active: inspecting })

      return
    }

    const ref = options.shared.ref()
    core.picked.set(ref, element)
    const zoom = contents.getZoomFactor()

    // The pick focused the page; the comment editor opens in the app window. Focus only moves
    // within a focused window, so synthetic input never raises a background window.
    if (!win.isDestroyed() && win.isFocused()) win.webContents.focus()
    options.inspect?.({
      active: false,
      element: {
        ref: Browser.Ref.make(ref),
        ...details,
        ...accessible,
        rect: { x: box.x * zoom, y: box.y * zoom, width: box.width * zoom, height: box.height * zoom },
      },
    })
  }

  async function highlightPicked(ref?: Browser.Ref) {
    clearTimeout(flash)
    const element = ref ? core.picked.get(ref.replace(/^@/, "")) : undefined

    if (!element) return hideHighlight()
    await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendID }, element.sessionID)
    await cdp.send(
      "Overlay.highlightNode",
      { backendNodeId: element.backendID, highlightConfig: pickedHighlight },
      element.sessionID,
    )
    flash = setTimeout(() => void hideHighlight(), 1_500)
  }

  async function hideHighlight() {
    await Promise.all(
      [undefined, ...core.sessions.values()].map((sessionID) =>
        cdp.send("Overlay.hideHighlight", {}, sessionID).catch(() => undefined),
      ),
    )
  }

  // The picker names a node but not its frame. A target owns its root frame plus any same-process
  // child frames, so match the node's document against each child frame's content document.
  async function frameOf(backendID: number, sessionID?: string) {
    const tree = await core.frames()
    const owned = tree.filter((frame) => core.sessionFor(frame.id, tree) === sessionID)
    const root =
      owned.find((frame) => !frame.parentID || core.sessionFor(frame.parentID, tree) !== sessionID) ?? tree[0]
    const nested = owned.filter((frame) => frame !== root)

    if (!nested.length) return root.id
    // The node and its document join one object group, released even when a later call rejects.
    const objectGroup = `frame-of-${crypto.randomUUID()}`

    const described = await (async () => {
      const node = await cdp.send("DOM.resolveNode", { backendNodeId: backendID, objectGroup }, sessionID)

      const document = node.object.objectId
        ? await cdp.send(
            "Runtime.callFunctionOn",
            {
              objectId: node.object.objectId,
              functionDeclaration: "function() { return this.ownerDocument; }",
              objectGroup,
            },
            sessionID,
          )
        : undefined

      return document?.result.objectId
        ? await cdp.send("DOM.describeNode", { objectId: document.result.objectId }, sessionID)
        : undefined
    })().finally(() => void cdp.send("Runtime.releaseObjectGroup", { objectGroup }, sessionID).catch(() => undefined))

    const owners = await Promise.all(
      nested.map(async (frame) => {
        const owner = await cdp.send("DOM.getFrameOwner", { frameId: frame.id }, sessionID).catch(() => undefined)

        const iframe = owner
          ? await cdp.send("DOM.describeNode", { backendNodeId: owner.backendNodeId }, sessionID).catch(() => undefined)
          : undefined

        return { id: frame.id, document: iframe?.node.contentDocument?.backendNodeId }
      }),
    )

    return owners.find((owner) => owner.document === described?.node.backendNodeId)?.id ?? root.id
  }

  // Wait until the compositor shows the picked highlight without the hover tooltip, so the
  // renderer's still of the page includes it. A stalled page must not hold the comment back.
  async function painted(sessionID?: string) {
    await Promise.race([
      cdp
        .send(
          "Runtime.evaluate",
          {
            expression: "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
            awaitPromise: true,
          },
          sessionID,
        )
        .catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 150)),
    ])
  }
}
