import { Browser } from "@opencode/plugin-browser/rpc"
import type { Protocol } from "devtools-protocol"
import { Schema } from "effect"
import { abortError, waitFor, type Cdp } from "./cdp"
import { createBrowserFiles, type BrowserFiles } from "./files"
import { createDiagnostics, type Diagnostics } from "./diagnostics"
import { createPageCdp } from "./page-cdp"
import type { Shared } from "./page-shared"
import { normalizeURL, type Policy } from "./policy"

/**
 * A tab driven in a local Chrome over CDP.
 *
 * It is not rendered in the app: the pane shows its address and says the page is in the local browser. The tool
 * surface is the page's, not the pane's: `tabs.*` stays in the pane, as it does for an embedded page.
 */
export type ExternalPage = {
  readonly state: () => Browser.Tab
  readonly ready: Promise<void>
  inspect: (enabled: boolean) => Promise<void>
  highlight: (ref?: Browser.Ref) => Promise<void>
  zoom: (direction: "in" | "out" | "reset") => void
  site: () => Promise<{ cookies: number }>
  clearSite: () => Promise<void>
  detail: () => { zoom: number }
  execute: (command: Browser.Command, signal: AbortSignal) => Promise<Browser.Result>
  dispose: () => Promise<void>
}

/** What an external page needs from the pane, which owns its lifetime and reports. */
export type ExternalPageInput = {
  readonly cdp: Cdp
  readonly shared: Shared
  readonly id: Browser.TabID
  readonly restore?: Browser.Tab
  /** Emits a state report; the pane reads `state()` for it. */
  readonly publish: (error?: string) => void
  readonly closed: () => boolean
  readonly fileRoots: () => readonly string[]
}

/** The zoom presets an external page steps through, matching the embedded browser. */
const zoomSteps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

function zoomStep(current: number, direction: "in" | "out" | "reset") {
  if (direction === "reset") return 1
  if (direction === "in") return zoomSteps.find((step) => step > current + 0.001) ?? current

  return zoomSteps.findLast((step) => step < current - 0.001) ?? current
}

/**
 * Creates a page in the external Chrome. The target is created and attached asynchronously; `ready` settles once it is
 * usable and rejects when the browser cannot create or attach the tab.
 *
 * @param input - The shared browser connection, the tab ID, and the pane's reports and lifetime.
 * @returns The page, usable immediately for its state and once `ready` for commands.
 */
export function createExternalPage(input: ExternalPageInput): ExternalPage {
  const cdp = input.cdp
  const files: BrowserFiles = createBrowserFiles(() => [tab.url])
  const diagnostics: Diagnostics = createDiagnostics(cdp)
  let sessionID: string | undefined
  let targetID: string | undefined
  let mainFrameID: string | undefined
  let revision = 0
  let dialogRevision = 0
  let dialog: { type: string; message: string; defaultValue: string } | null = null
  let dialogURL = ""
  let zoomFactor = 1
  let tab: Browser.Tab = input.restore ?? {
    id: input.id,
    url: "about:blank",
    title: "",
    loading: true,
    canGoBack: false,
    canGoForward: false,
    generation: 0,
  }
  const policy: Policy = {
    get fileRoots() {
      return input.fileRoots()
    },
  }

  const core = createPageCdp({
    cdp,
    files,
    diagnostics,
    shared: input.shared,
    session: () => sessionID,
  })

  const state = () => ({ ...tab })
  const publish = (error?: string) => {
    if (!input.closed()) input.publish(error)
  }
  const update = (patch: Partial<Browser.Tab>) => {
    tab = { ...tab, ...patch }
  }

  // A dialog that opens while an action runs rejects that action, as an embedded page's does.
  const dialogListeners = new Set<() => void>()

  const stopTracking = core.track((sessionId) => {
    void Promise.all([
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
    ]).catch(() => undefined)
  })

  const listeners = [
    cdp.on("Page.frameNavigated", ({ frame }) => {
      if (frame.parentId) return
      mainFrameID = frame.id
      revision++
      update({ url: frame.url, generation: tab.generation + 1, loadError: undefined })
      void refreshTitle()
      publish()
    }),
    cdp.on("Page.navigatedWithinDocument", ({ url }) => {
      revision++
      update({ url, generation: tab.generation + 1 })
      void refreshTitle()
      publish()
    }),
    cdp.on("Page.frameStartedLoading", ({ frameId }) => {
      if (mainFrameID && frameId !== mainFrameID) return
      update({ loading: true })
      publish()
    }),
    cdp.on("Page.loadEventFired", () => {
      update({ loading: false })
      void refreshHistory()
      void refreshTitle()
      publish()
    }),
    cdp.on("Page.javascriptDialogOpening", (event) => {
      dialogURL = event.url
      dialogRevision++
      dialog = {
        type: event.type,
        message: event.message.slice(0, Browser.MAX_TEXT),
        defaultValue: event.defaultPrompt ?? "",
      }
      publish()
    }),
    cdp.on("Page.javascriptDialogClosed", () => {
      dialogRevision++
      dialog = null
      publish()
    }),
    cdp.on("Network.loadingFailed", (event) => {
      if (event.type !== "Document") return
      update({ loadError: event.errorText, loading: false })
      publish()
    }),
    cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
      if (sessionId === sessionID) publish("browser.pane.registration.closed")
    }),
  ]

  const ready = (async () => {
    const created = await cdp.send("Target.createTarget", { url: input.restore?.url || "about:blank" })
    targetID = created.targetId
    const attached = await cdp.send("Target.attachToTarget", { targetId: created.targetId, flatten: true })
    sessionID = attached.sessionId
    await Promise.all([
      cdp.send("Page.enable", {}, sessionID),
      cdp.send("DOM.enable", {}, sessionID),
      cdp.send("Page.setLifecycleEventsEnabled", { enabled: true }, sessionID),
      diagnostics.enable(sessionID),
    ])
    const tree = await cdp.send("Page.getFrameTree", {}, sessionID)
    mainFrameID = tree.frameTree.frame.id
    await Promise.all([refreshHistory(), refreshTitle()])
  })()

  async function refreshHistory() {
    const history = await cdp.send("Page.getNavigationHistory", {}, sessionID).catch(() => undefined)

    if (!history) return
    update({
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
    })
  }

  async function refreshTitle() {
    if (!targetID) return
    const info = await cdp.send("Target.getTargetInfo", { targetId: targetID }).catch(() => undefined)
    const title = info?.targetInfo.title

    if (title === undefined || title === tab.title) return
    update({ title: title.slice(0, 2_048) })
  }

  const waitLoaded = (signal: AbortSignal) => waitFor(() => !tab.loading, signal, 30_000)

  async function navigate(url: string) {
    const result = await cdp.send("Page.navigate", { url }, sessionID)

    if (result.errorText) throw new Error(`${result.errorText}: ${url}`)
  }

  async function history(offset: -1 | 1) {
    const history = await cdp.send("Page.getNavigationHistory", {}, sessionID)
    const id = history.entries[history.currentIndex + offset]?.id

    if (id !== undefined) await cdp.send("Page.navigateToHistoryEntry", { entryId: id }, sessionID)
  }

  async function inspect(action: Browser.Action): Promise<Browser.Target> {
    if (action.type === "dialog")
      return {
        resources: [dialog ? dialogURL : tab.url],
        key: `${tab.generation}:${dialogRevision}:${Boolean(dialog)}`,
      }

    const fileIDs =
      action.type === "heap.compare" ? [action.before, action.after] : "fileID" in action ? [action.fileID] : []

    if (fileIDs.length)
      return {
        resources: [...new Set(fileIDs.flatMap((id) => files.get(id).resources))].sort(),
        key: JSON.stringify(fileIDs),
      }

    if (action.type === "network.get") return { resources: [diagnostics.info(action.id).url], key: action.id }

    if (["trace.stop", "cpu.stop", "trace.start", "cpu.start", "heap.snapshot", "lighthouse"].includes(action.type))
      throw new Error("This operation is not available for a page opened in the local Chrome.")

    const tree = await core.frames()

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
      const frame = tree.find((item) => item.id === id)

      if (!frame) throw new Error("Frame is unavailable. Call browser.frames({tabID}) and use a current frameID.")

      return frame.url
    })

    const capture = ["screenshot"].includes(action.type)

    return {
      resources: [
        ...new Set(
          action.type === "navigate"
            ? [new URL(normalizeURL(action.url, policy)).href]
            : capture
              ? [tab.url]
              : urls.length
                ? urls
                : [tab.url],
        ),
      ].sort(),
      key: JSON.stringify([tab.generation, revision, selected]),
    }
  }

  async function run(
    action: Browser.Action,
    transfers: readonly Browser.File[],
    signal: AbortSignal,
    approved?: Browser.Target,
  ): Promise<Browser.Result> {
    const captureSources = [tab.url]
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
        await navigate(url)
        await waitLoaded(signal)
        abortError(signal)

        return result(state())
      }
      case "back":
      case "forward":
      case "reload":
      case "stop": {
        if (action.type === "back") await history(-1)
        if (action.type === "forward") await history(1)
        if (action.type === "reload") await cdp.send("Page.reload", {}, sessionID)
        if (action.type === "stop") await cdp.send("Page.stopLoading", {}, sessionID)
        if (action.type !== "stop") await waitLoaded(signal)

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
                core.root(element.sessionID),
              )
              .finally(() =>
                cdp.send("Runtime.releaseObject", { objectId }, core.root(element.sessionID)).catch(() => undefined),
              )
          : cdp.send(
              "Runtime.evaluate",
              {
                expression: action.script,
                contextId: context?.id,
                awaitPromise: true,
                returnByValue: true,
                userGesture: true,
              },
              core.root(context?.sessionID),
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
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", ...(await core.point(core.target(action.ref))) },
          core.root(),
        )
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

        await cdp.send("Input.setInterceptDrags", { enabled: true }, core.root())
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from }, core.root())
        await cdp.send(
          "Input.dispatchMouseEvent",
          { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 },
          core.root(),
        )

        try {
          for (let index = 1; index <= 10; index++) {
            abortError(signal)
            await cdp.send(
              "Input.dispatchMouseEvent",
              {
                type: "mouseMoved",
                x: from.x + ((to.x - from.x) * index) / 10,
                y: from.y + ((to.y - from.y) * index) / 10,
                button: "left",
                buttons: 1,
              },
              core.root(),
            )
          }

          if (html5) await waitFor(() => data !== undefined, signal, 2_000)

          if (data)
            for (const type of ["dragEnter", "dragOver", "drop"])
              await cdp.send("Input.dispatchDragEvent", { type, ...to, data }, core.root())
        } finally {
          off()
          await cdp.send("Input.setInterceptDrags", { enabled: false }, core.root())
          await cdp.send(
            "Input.dispatchMouseEvent",
            { type: "mouseReleased", ...to, button: "left", clickCount: 1 },
            core.root(),
          )
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
        const metrics = await cdp.send("Page.getLayoutMetrics", {}, sessionID)
        const viewport = metrics.cssLayoutViewport
        await cdp.send(
          "Input.dispatchMouseEvent",
          {
            type: "mouseWheel",
            x: viewport.clientWidth / 2,
            y: viewport.clientHeight / 2,
            deltaX: action.deltaX ?? 0,
            deltaY: action.deltaY,
          },
          core.root(),
        )
        break
      }
      case "wait": {
        if (action.condition !== "load" && !action.text)
          throw new Error(
            'browser.wait requires non-empty text for condition "text" or "textGone". Use condition "load" without text to wait for loading.',
          )

        await waitFor(
          async () => {
            if (action.condition === "load") return !tab.loading
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
              core.root(context?.sessionID),
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
        const element = action.ref ? await core.rect(core.target(action.ref), true) : undefined
        const metrics = await cdp.send("Page.getLayoutMetrics", {}, sessionID)
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

        const ratio = await cdp.send(
          "Runtime.evaluate",
          { expression: "window.devicePixelRatio", returnByValue: true },
          core.root(),
        )
        const pixelRatio = (typeof ratio.result.value === "number" ? ratio.result.value : 1) * zoomFactor
        const scale = Math.min(1, (action.maxWidth ?? 2000) / (bounds.width * pixelRatio))

        if (bounds.width <= 0 || bounds.height <= 0)
          throw new Error(
            "Element or page has no visible screenshot area. Take a fresh snapshot and choose a visible element, or omit ref to capture the viewport.",
          )
        if (bounds.width * bounds.height * (scale * pixelRatio) ** 2 > 16_000_000)
          throw new Error("Screenshot exceeds 16 megapixels; capture an element or use a smaller maxWidth.")

        const format = action.format ?? "jpeg"
        const capture = await cdp.send(
          "Page.captureScreenshot",
          {
            format,
            quality: format === "png" ? undefined : (action.quality ?? 80),
            captureBeyondViewport: true,
            clip: { ...bounds, scale },
          },
          sessionID,
        )
        const id = await files.save(`screenshot.${format}`, `image/${format}`, Buffer.from(capture.data, "base64"), [
          ...captureSources,
        ])

        return result({ tab: state() }, [await transfer(id)])
      }
      case "dialog": {
        if (action.action !== "get") {
          if (!dialog)
            throw new Error(
              'This tab has no JavaScript dialog to handle. browser.dialog({tabID,action:"get"}) returns null when none is open; continue without accepting or dismissing one.',
            )
          await cdp.send(
            "Page.handleJavaScriptDialog",
            { accept: action.action === "accept", promptText: action.promptText },
            sessionID,
          )
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
          await cdp.send(
            "DOM.setFileInputFiles",
            { files: local, backendNodeId: element.backendID },
            core.root(element.sessionID),
          )

        if (action.type === "files.drop") {
          const position = await core.point(element)

          for (const type of ["dragEnter", "dragOver", "drop"])
            await cdp.send(
              "Input.dispatchDragEvent",
              { type, ...position, data: { items: [], files: local, dragOperationsMask: 1 } },
              core.root(),
            )
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
      case "trace.stop":
      case "trace.analyze":
      case "cpu.start":
      case "cpu.stop":
      case "cpu.analyze":
      case "heap.snapshot":
      case "heap.summary":
      case "heap.query":
      case "heap.object":
      case "heap.compare":
      case "lighthouse":
        throw new Error(
          "This operation is not available for a page opened in the local Chrome. Close that tab and reopen it with the embedded browser to record traces, CPU profiles, heap snapshots, or run Lighthouse.",
        )
      default:
        throw new Error(
          "This operation was routed to a page instead of the tab manager. Report a desktop/plugin routing mismatch; changing tab IDs or repeating the operation will not fix it.",
        )
    }

    abortError(signal)

    return result(state())
  }

  return {
    state,
    ready,
    async inspect() {
      // The element picker paints an Electron overlay over an embedded page; a local Chrome has the user's own
      // DevTools instead.
    },
    async highlight() {},
    zoom(direction) {
      const next = zoomStep(zoomFactor, direction)

      if (next === zoomFactor) return
      zoomFactor = next
      void cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: next }, sessionID).catch(() => undefined)
      input.publish()
    },
    async site() {
      if (!tab.url) return { cookies: 0 }
      const result = await cdp.send("Network.getCookies", { urls: [tab.url] }, sessionID).catch(() => undefined)

      return { cookies: result?.cookies.length ?? 0 }
    },
    async clearSite() {
      const url = tab.url

      if (!url || url === "about:blank") return
      const cookies = await cdp.send("Network.getCookies", { urls: [url] }, sessionID).catch(() => undefined)

      for (const cookie of cookies?.cookies ?? [])
        await cdp
          .send(
            "Network.deleteCookies",
            { name: cookie.name, domain: cookie.domain, path: cookie.path, ...(cookie.secure ? {} : { url }) },
            sessionID,
          )
          .catch(() => undefined)
      const origin = new URL(url).origin

      await cdp
        .send(
          "Storage.clearDataForOrigin",
          {
            origin,
            storageTypes: "local_storage,indexeddb,service_workers,cache_storage,file_systems",
          },
          sessionID,
        )
        .catch(() => undefined)
      await cdp.send("Page.reload", {}, sessionID)
      await waitFor(() => !tab.loading, new AbortController().signal, 30_000).catch(() => undefined)
    },
    detail() {
      return { zoom: zoomFactor }
    },
    async execute(command, signal) {
      await ready
      abortError(signal)

      if (input.closed())
        throw new Error(
          "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID; do not reuse the closed tab's refs.",
        )

      if (dialog && command.action.type !== "dialog")
        throw new Error(
          'A JavaScript dialog is open. Inspect it with browser.dialog({tabID,action:"get"}), then explicitly accept or dismiss it before continuing.',
        )

      if (command.inspect) return { value: await inspect(command.action), files: [] }

      if (command.target && JSON.stringify(await inspect(command.action)) !== JSON.stringify(command.target))
        throw new Error(
          "Browser target changed while permission was pending. Take a fresh snapshot or listing and request the action again; it was not executed.",
        )

      const modal = Promise.withResolvers<never>()
      const reject = () => {
        modal.reject(
          new Error(
            'A JavaScript dialog opened while the action was running. Inspect it with browser.dialog({tabID,action:"get"}) and accept or dismiss it. Do not repeat the original action just to close the dialog.',
          ),
        )
      }

      if (command.action.type !== "dialog") dialogListeners.add(reject)

      try {
        return await Promise.race([run(command.action, command.files, signal), modal.promise])
      } finally {
        dialogListeners.delete(reject)
      }
    },
    async dispose() {
      listeners.forEach((off) => off())
      stopTracking()
      diagnostics.dispose()

      if (targetID) await cdp.send("Target.closeTarget", { targetId: targetID }, undefined).catch(() => undefined)
      await files.dispose()
    },
  }
}
