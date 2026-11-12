import type { Protocol } from "devtools-protocol"
import { Schema } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import { abortError, type Cdp } from "./cdp"
import type { BrowserFiles } from "./files"
import type { Diagnostics } from "./diagnostics"
import type { Shared } from "./page-shared"

/** One element a snapshot or a user pick named. */
export type Element = { backendID: number; frameID: string; sessionID?: string }

/** Virtual key codes of the named keys `press` accepts. */
interface KeyCodes {
  readonly [key: string]: number
}

/** The subset of `Browser.Action` a `browser.find` narrows, sampled the way a snapshot is. */
type Findable = Extract<Browser.Action, { type: "snapshot" | "find" }>

/**
 * The Page, Runtime, DOM and Input logic a browser page shares, whatever transport runs it.
 *
 * An embedded page attaches to its `WebContents.debugger`; an external page attaches to a Chrome target over a
 * WebSocket. Both call these functions, so the protocol sequences exist once.
 *
 * @param input - The transport, the files and diagnostics stores, the ref allocator, and the page's root session.
 * @returns The shared page operations and the maps they keep.
 */
export function createPageCdp(input: {
  readonly cdp: Cdp
  readonly files: BrowserFiles
  readonly diagnostics: Diagnostics
  readonly shared: Shared
  /**
   * The tab target's CDP session when the transport is a browser-level connection; undefined when the transport is
   * already that target, as an Electron page's debugger is. A function because an external target is attached after
   * the page object exists.
   */
  readonly session?: () => string | undefined
  /** Nudges the compositor after a scroll, so a later screenshot includes it. */
  readonly nudge?: () => Promise<void>
}) {
  const { cdp, files, diagnostics, shared } = input
  /** The session every tab-level command runs in: the attached target, or the transport's own. */
  const root = (sessionID?: string) => sessionID ?? input.session?.()
  const refs = new Map<string, Element>()
  const picked = new Map<string, Element>()
  const sessions = new Map<string, string>()
  const parents = new Map<string, string>()
  const contexts = new Map<string, { id: number; sessionID?: string }>()

  /**
   * Wires the bookkeeping every page needs: execution contexts, and the iframe targets the page auto-attaches.
   *
   * @param attached - Called after a new iframe session is recorded, for the page's own domain setup.
   * @returns A function that removes the listeners.
   */
  function track(
    attached: (sessionId: string, targetInfo: Protocol.Target.TargetInfo, parentSessionID?: string) => void,
  ) {
    const offs = [
      cdp.on("Runtime.executionContextCreated", ({ context }, sessionID) => {
        // SAFETY: CDP documents a page execution context's auxData as `{ frameId, isDefault, type }`.
        const aux = context.auxData as { frameId?: string; isDefault?: boolean } | undefined

        if (aux?.frameId && aux.isDefault) contexts.set(aux.frameId, { id: context.id, sessionID })
      }),
      cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }, sessionID) => {
        contexts.forEach((context, key) => {
          if (context.id === executionContextId && context.sessionID === sessionID) contexts.delete(key)
        })
      }),
      cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }, parentSessionID) => {
        if (targetInfo.type !== "iframe") return
        const parentID = targetInfo.parentFrameId ?? Array.from(sessions).find(([, id]) => id === parentSessionID)?.[0]

        if (parentID) parents.set(targetInfo.targetId, parentID)
        sessions.set(targetInfo.targetId, sessionId)
        attached(sessionId, targetInfo, parentSessionID)
      }),
      cdp.on("Target.detachedFromTarget", ({ sessionId }) => {
        sessions.forEach((id, frameID) => {
          if (id !== sessionId) return
          sessions.delete(frameID)
          parents.delete(frameID)
        })
      }),
    ]

    return () => offs.forEach((off) => off())
  }

  function target(ref: Browser.Ref): Element {
    const key = ref.replace(/^@/, "")
    const value = refs.get(key) ?? picked.get(key)

    if (!value)
      throw new Error(
        "Element ref is stale or belongs to another tab. Call browser.snapshot({tabID}) and use a ref from that tab's newest snapshot. Do not reuse refs after navigation or a newer snapshot.",
      )

    return value
  }

  async function frames() {
    const tree = await cdp.send("Page.getFrameTree", {}, root())
    const result: { id: string; parentID?: string; url: string; name: string }[] = []

    const walk = (node: Protocol.Page.FrameTree, parentID?: string) => {
      if (!result.some((frame) => frame.id === node.frame.id))
        result.push(
          node.frame.parentId || parentID
            ? {
                id: node.frame.id,
                parentID: node.frame.parentId ?? parentID,
                url: node.frame.url,
                name: node.frame.name ?? "",
              }
            : { id: node.frame.id, url: node.frame.url, name: node.frame.name ?? "" },
        )
      node.childFrames?.forEach((child) => walk(child, node.frame.id))
    }

    walk(tree.frameTree)

    const children = await Promise.all(
      Array.from(sessions, async ([id, sessionID]) => ({
        id,
        tree: await cdp.send("Page.getFrameTree", {}, sessionID).catch(() => undefined),
      })),
    )

    children.forEach(({ id, tree }) => {
      if (tree) walk(tree.frameTree, parents.get(id) ?? tree.frameTree.frame.id)
    })

    return result
  }

  async function call(element: Element, functionDeclaration: string, args: unknown[] = []) {
    const objectId = await resolve(element)

    try {
      const result = await cdp.send(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration,
          arguments: args.map((value) => ({ value })),
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        },
        root(element.sessionID),
      )

      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)

      // SAFETY: widens CDP's `any` value to unknown; every caller decodes or compares it.
      return result.result.value as unknown
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId }, root(element.sessionID)).catch(() => undefined)
    }
  }

  async function resolve(element: Element) {
    const object = await cdp.send("DOM.resolveNode", { backendNodeId: element.backendID }, root(element.sessionID))

    if (!object.object.objectId)
      throw new Error(
        "Element is no longer available. Call browser.snapshot({tabID}) and use a fresh ref; the page may have replaced the element.",
      )

    return object.object.objectId
  }

  async function rect(element: Element, scroll = false) {
    if (scroll) {
      await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendID }, root(element.sessionID))
      // Force a compositor update after scrolling. requestAnimationFrame can stall in a hidden view.
      await input.nudge?.()
    }

    const bounds = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })

    const value = {
      ...Schema.decodeUnknownSync(bounds)(
        await call(
          element,
          "function() { const r = this.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }",
        ),
      ),
    }

    const tree = await frames()
    let frame = tree.find((item) => item.id === element.frameID)

    while (frame?.parentID) {
      const parent = { frameID: frame.parentID, sessionID: sessionFor(frame.parentID, tree) }
      const owner = await cdp.send("DOM.getFrameOwner", { frameId: frame.id }, root(parent.sessionID))

      // A CSS transform on the iframe scales its content box; the child's own coordinates are unscaled.
      const box = Schema.decodeUnknownSync(
        Schema.Struct({ ...bounds.fields, scaleX: Schema.Finite, scaleY: Schema.Finite }),
      )(
        await call(
          { backendID: owner.backendNodeId, ...parent },
          "function() { const r = this.getBoundingClientRect(); const sx = this.offsetWidth ? r.width / this.offsetWidth : 1; const sy = this.offsetHeight ? r.height / this.offsetHeight : 1; return {x:r.x+this.clientLeft*sx,y:r.y+this.clientTop*sy,width:r.width,height:r.height,scaleX:sx,scaleY:sy}; }",
        ),
      )

      value.x = box.x + value.x * box.scaleX
      value.y = box.y + value.y * box.scaleY
      value.width *= box.scaleX
      value.height *= box.scaleY
      frame = tree.find((item) => item.id === frame?.parentID)
    }

    return value
  }

  // Same-process child frames have no CDP target of their own; the nearest ancestor with one owns them.
  function sessionFor(frameID: string, tree: { id: string; parentID?: string }[]) {
    let id: string | undefined = frameID

    while (id && !sessions.has(id)) id = tree.find((frame) => frame.id === id)?.parentID

    return id ? sessions.get(id) : undefined
  }

  async function point(element: Element) {
    const box = await rect(element, true)

    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  async function click(element: Element, button = "left", count = 1, modifiers: readonly string[] = []) {
    const position = await point(element)
    const flags = modifiers.reduce((mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0), 0)
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...position, modifiers: flags }, root())

    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", ...position, button, clickCount, modifiers: flags },
        root(),
      )
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", ...position, button, clickCount, modifiers: flags },
        root(),
      )
    }
  }

  async function fill(element: Element, value: string, signal: AbortSignal) {
    const kind = await call(
      element,
      "function() { if (this.disabled || this.readOnly) return; if (this instanceof HTMLTextAreaElement || this.isContentEditable) return 'text'; if (!(this instanceof HTMLInputElement)) return; if (['date','time','datetime-local','month','week'].includes(this.type)) return 'structured'; if (!['file','checkbox','radio','button','submit','reset','image','hidden','range','color'].includes(this.type)) return 'text'; }",
    )

    if (!kind)
      throw new Error(
        "Target is not an enabled editable text field. Take a fresh snapshot and choose a textbox; use browser.select for dropdowns, browser.check for checkboxes/radios, or browser.files.upload for file inputs.",
      )

    // Keyboard input cannot compose a date or time control's value; Chromium clears a malformed one.
    if (kind === "structured") {
      await call(
        element,
        "function(value) { const previous = this.value; this.focus(); this.value = value; if (this.value !== value) { this.value = previous; throw new Error('The ' + this.type + ' input rejected this value and keeps its previous one. Use its required format, for example 2026-09-07 for date, 14:45 for time, 2026-09-07T14:45 for datetime-local, 2026-09 for month, or 2026-W37 for week.'); } this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }",
        [value],
      )

      return
    }

    await cdp.send("DOM.focus", { backendNodeId: element.backendID }, root(element.sessionID))
    // Focusing this field blurs the previous one; a validation dialog from that blur must stop here.
    abortError(signal)
    await key(process.platform === "darwin" ? "Meta+A" : "Control+A")
    await key("Backspace")
    abortError(signal)
    await cdp.send("Input.insertText", { text: value }, root())
  }

  async function select(element: Element, values: readonly string[]) {
    await call(
      element,
      `function(values) { if (!(this instanceof HTMLSelectElement) || this.disabled) throw new Error('Target is not an enabled HTML select. Take a fresh snapshot and choose an enabled dropdown ref.'); if (!this.multiple && values.length !== 1) throw new Error('This dropdown accepts exactly one value; pass a one-item values array.'); for (const value of values) if (!Array.from(this.options).some(option => option.value === value && !option.disabled)) throw new Error('Option value was not found or is disabled. Inspect option values with browser.evaluate before retrying browser.select; values are not visible labels.'); for (const option of this.options) option.selected = values.includes(option.value); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
      [values],
    )
  }

  async function check(element: Element, checked: boolean) {
    const current = await call(
      element,
      "function(checked) { if (!(this instanceof HTMLInputElement) || !['checkbox','radio'].includes(this.type) || this.disabled) throw new Error('Target is not an enabled checkbox or radio. Take a fresh snapshot and choose the correct ref.'); if (this.type === 'radio' && this.checked && !checked) throw new Error('A selected radio cannot be cleared by clicking it. Select a different radio in its group instead.'); return this.checked; }",
      [checked],
    )

    if (current !== checked) await click(element)

    if ((await call(element, "function() { return this.checked; }")) !== checked)
      throw new Error(
        "The page did not keep the requested checked state. Inspect the current snapshot and page validation before retrying; do not blindly toggle the control again.",
      )
  }

  async function key(chord: string) {
    if (!chord)
      throw new Error(
        "A key is required. Use a named key such as Enter or ArrowDown, a single character, or a chord such as Control+A.",
      )
    const parts = (chord.endsWith("+") ? chord.slice(0, -1) : chord).split("+")
    const name = parts.pop() || "+"

    const modifiers = parts.reduce((mask, part) => {
      const bit = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }[part]

      if (!bit)
        throw new Error(
          `Unknown key modifier ${JSON.stringify(part)}. Supported modifiers are Alt, Control, Meta, and Shift; for example Control+A. Use Meta for macOS command shortcuts.`,
        )

      return mask | bit
    }, 0)

    const codes: KeyCodes = {
      Enter: 13,
      Tab: 9,
      Escape: 27,
      Backspace: 8,
      Delete: 46,
      ArrowUp: 38,
      ArrowDown: 40,
      ArrowLeft: 37,
      ArrowRight: 39,
      PageUp: 33,
      PageDown: 34,
      Home: 36,
      End: 35,
      Space: 32,
    }

    const code =
      codes[name] ??
      (name.length === 1
        ? name.toUpperCase().charCodeAt(0)
        : /^F([1-9]|1[0-2])$/.test(name)
          ? 111 + Number(name.slice(1))
          : undefined)

    if (code === undefined)
      throw new Error(
        `Unknown key ${JSON.stringify(name)}. Use Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/Down, Home, End, Space, F1–F12, or one character. Use browser.fill for text.`,
      )
    // Named keys need their character data too: Enter submits forms and inserts newlines only with "\r".
    const text = name === "Enter" ? "\r" : name === "Space" ? " " : name.length === 1 ? name : undefined

    const event = { key: name === "Space" ? " " : name, windowsVirtualKeyCode: code, modifiers }
    const params = text !== undefined && !(modifiers & 6) ? { ...event, text } : event

    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...params }, root())
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params }, root())
  }

  async function snapshot(action: Findable) {
    const tree = await frames()
    const selected = action.type === "snapshot" && action.ref ? target(action.ref) : undefined
    const frameID = selected?.frameID ?? action.frameID ?? tree[0]?.id

    if (!frameID || !tree.some((frame) => frame.id === frameID))
      throw new Error(
        "Frame is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab; omit frameID for the main frame.",
      )
    const sessionID = sessionFor(frameID, tree) ?? input.session?.()
    const depth = action.type === "snapshot" ? (action.depth ?? 8) : 8
    const ax = await cdp.send("Accessibility.getFullAXTree", { frameId: frameID, depth }, root(sessionID))
    const nodes = new Map(ax.nodes.map((node) => [node.nodeId, node]))
    const rootNode = selected ? ax.nodes.find((node) => node.backendDOMNodeId === selected.backendID) : ax.nodes[0]

    if (!rootNode)
      throw new Error(
        "Element is absent from this frame's accessibility snapshot. Retry browser.snapshot with the same tabID and no ref to refresh the frame, then choose a returned ref.",
      )
    refs.clear()
    const pinned = new Map(Array.from(picked, ([ref, element]) => [`${element.frameID}:${element.backendID}`, ref]))
    const lines: string[] = []
    let truncated = false

    const walk = async (node: Protocol.Accessibility.AXNode, level: number): Promise<void> => {
      if (level > depth || lines.length >= 500) {
        truncated = true

        return
      }

      const role = String(node.role?.value ?? "node")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 40)

      const properties = new Map(node.properties?.map((property) => [property.name, property.value.value]) ?? [])

      if (!node.ignored) {
        const actionable =
          role !== "RootWebArea" &&
          (properties.get("focusable") || /^(button|link|textbox|combobox|checkbox|radio|option)$/.test(role))

        // A picked element keeps the ref its comment names, even when it is not otherwise actionable.
        const known = node.backendDOMNodeId ? pinned.get(`${frameID}:${node.backendDOMNodeId}`) : undefined
        const ref = known ?? (actionable && node.backendDOMNodeId ? shared.ref() : "")
        const element = node.backendDOMNodeId ? { backendID: node.backendDOMNodeId, frameID, sessionID } : undefined

        if (ref && element && !known) refs.set(ref, element)

        const flags = (["checked", "disabled", "expanded", "selected"] as const).flatMap((name) =>
          properties.has(name) ? [`${name}=${properties.get(name)}`] : [],
        )

        const box =
          action.type === "snapshot" && action.boxes && ref && element
            ? await rect(element).catch(() => undefined)
            : undefined

        lines.push(
          `${"  ".repeat(level)}${ref ? `@${ref} ` : ""}[${role}] ${JSON.stringify(
            String(node.name?.value ?? "")
              .replace(/\s+/g, " ")
              .slice(0, 300),
          )} ${flags.join(" ")}${box ? ` box=${JSON.stringify(box)}` : ""}`,
        )
      }

      if (["textbox", "searchbox"].includes(role) || properties.get("editable")) return

      for (const childID of node.childIds ?? []) {
        const child = nodes.get(childID)

        if (child) await walk(child, level + 1)
      }
    }

    await walk(rootNode, 0)

    const content = (
      action.type === "find" ? lines.filter((line) => line.toLowerCase().includes(action.text.toLowerCase())) : lines
    ).join("\n")

    return { content: content.slice(0, Browser.MAX_TEXT), truncated: truncated || content.length > Browser.MAX_TEXT }
  }

  async function describe(element: Element) {
    return Schema.decodeUnknownSync(
      Schema.Struct({ label: Schema.String, selector: Schema.String, text: Schema.optionalKey(Schema.String) }),
    )(
      await call(
        element,
        `function() {
          const clip = (value, max) => (value.length > max ? value.slice(0, max - 1) + "\u2026" : value)
          const label = this.localName + (this.id ? "#" + this.id : "") + Array.from(this.classList, (name) => "." + name).join("")
          // One segment per document or shadow root, outermost first; " >>> " steps into a host's shadow root.
          const segments = []
          for (let start = this; start; ) {
            const root = start.getRootNode()
            const path = []
            for (let node = start; node; node = node.parentElement) {
              if (node.id && root.querySelectorAll("#" + CSS.escape(node.id)).length === 1) {
                path.unshift("#" + CSS.escape(node.id))
                break
              }
              if (node === node.ownerDocument.body) {
                path.unshift("body")
                break
              }
              const same = Array.from(node.parentNode?.children ?? []).filter((child) => child.localName === node.localName)
              path.unshift(CSS.escape(node.localName) + (same.length > 1 ? ":nth-of-type(" + (same.indexOf(node) + 1) + ")" : ""))
            }
            segments.unshift(path.join(" > "))
            start = root instanceof ShadowRoot ? root.host : undefined
          }
          const selector = segments.join(" >>> ")
          const text = clip((this.innerText ?? this.textContent ?? "").replace(/\\s+/g, " ").trim(), 160)
          // A cut selector is invalid syntax; leave it out rather than pass it off as usable.
          return { label: clip(label, 200), selector: selector.length > 2000 ? "" : selector, ...(text ? { text } : {}) }
        }`,
      ),
    )
  }

  async function accessibility(element: Element) {
    const tree = await cdp
      .send(
        "Accessibility.getPartialAXTree",
        { backendNodeId: element.backendID, fetchRelatives: false },
        root(element.sessionID),
      )
      .catch(() => undefined)

    const node = tree?.nodes.find((item) => item.backendDOMNodeId === element.backendID && !item.ignored)
    const role = String(node?.role?.value ?? "")

    const name = String(node?.name?.value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160)

    const labeled = role && !["generic", "none", "presentation"].includes(role) ? { role: role.slice(0, 128) } : {}

    return name ? { ...labeled, name } : labeled
  }

  return {
    refs,
    picked,
    sessions,
    parents,
    contexts,
    root,
    track,
    target,
    frames,
    call,
    resolve,
    rect,
    point,
    click,
    fill,
    select,
    check,
    key,
    snapshot,
    describe,
    accessibility,
    sessionFor,
    files,
    diagnostics,
  }
}

export type PageCdp = ReturnType<typeof createPageCdp>
