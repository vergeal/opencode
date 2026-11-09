import { lexMarkdown } from "@opencode/ui/context/marked-base"
import { nextFence, type Fence } from "./fence"

/** Highlight group names registered through the CSS Custom Highlight API. */
const groups = {
  strong: "composer-md-strong",
  em: "composer-md-em",
  code: "composer-md-code",
  marker: "composer-md-marker",
  heading: "composer-md-heading",
  quote: "composer-md-quote",
  list: "composer-md-list",
  link: "composer-md-link",
  strike: "composer-md-strike",
} as const

type Group = keyof typeof groups | "codeblock"

/** A segment of the draft, plus the range inside it that renders as content instead of syntax. */
type Segment = { start: number; end: number; group: Group; content?: { start: number; end: number } }

type Token = { type: string; raw?: string; text?: string; tokens?: Token[]; items?: Token[] }

/** A typing pause renders the draft. Short enough to read as immediate, long enough not to churn the
 * editable DOM on every keystroke. */
const IDLE = 150

/**
 * Styles markdown in the composer.
 *
 * Syntax paint uses the CSS Custom Highlight API, so typing never rewrites the text model. Once typing
 * pauses, syntax markers collapse into hidden spans, inline code becomes a chip and a fenced block becomes
 * its own layer, so the draft reads as rendered markdown while focused. Any key that edits the draft
 * restores the source first, so the browser edits plain text the editor and its mention parser expect, and
 * a fragment at the caret deletes whole rather than leaving its symbols behind.
 */
export function createMarkdownHighlight(editor: HTMLElement) {
  let frame: number | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let immediate: number | undefined
  let decorating = false
  let disposed = false
  let composing = false
  // Set by select-all and cleared by anything that moves the caret; a delete right after it clears the draft
  // including hidden fences.
  let selectedAll = false

  const clearPaint = () => {
    if (typeof CSS === "undefined" || !CSS.highlights) return

    for (const name of Object.values(groups)) CSS.highlights.delete(name)
  }

  const paint = (text: string, segments: Segment[]) => {
    clearPaint()
    if (!text.trim()) return
    if (typeof CSS === "undefined" || !CSS.highlights) return
    if (segments.length === 0) return

    const nodes = textNodes(editor)
    if (nodes.length === 0) return

    const byGroup = new Map<keyof typeof groups, Range[]>()

    for (const segment of segments) {
      if (segment.group === "codeblock") continue

      const { start, end } = segment.content ?? segment
      const range = toRange(nodes, start, end)
      if (!range) continue

      const list = byGroup.get(segment.group)
      if (list) list.push(range)
      else byGroup.set(segment.group, [range])
    }

    for (const [group, ranges] of byGroup) {
      CSS.highlights.set(groups[group], new Highlight(...ranges))
    }
  }

  const refreshPaint = () => {
    if (disposed) return

    const text = editor.textContent ?? ""
    paint(text, collect(text))
  }

  // The text of the last rendered draft. Mutation records arrive after `decorating` is clear, so this is
  // what stops a render from scheduling the next one forever.
  let decoratedText: string | undefined

  const undecorate = (restoreCaret = true) => {
    const decorated = Array.from(
      editor.querySelectorAll(
        "[data-md-marker], [data-md-marker-block], [data-md-code-block], [data-md-code], [data-md-em]",
      ),
    )
    if (decorated.length === 0) return

    decoratedText = undefined
    const caret = restoreCaret ? capture(editor) : undefined
    decorating = true

    // Unwrap instead of replacing with a fresh text node: the text nodes keep their identity, which keeps
    // native selection and undo anchored to the same characters.
    for (const element of decorated) element.replaceWith(...Array.from(element.childNodes))
    editor.normalize()

    decorating = false
    if (caret) restore(editor, caret)
    refreshPaint()
  }

  // Render from the end of the draft, so wrapping one fragment cannot move the offsets of the next one.
  const firstToLast = (a: Segment, b: Segment) => b.start - a.start

  const decorate = () => {
    if (disposed || composing) return

    const text = editor.textContent ?? ""
    const segments = collect(text)
    const markers = segments.filter((segment) => segment.group === "marker")
    const blocks = segments.filter((segment) => segment.group === "codeblock")
    const codes = segments.filter((segment) => segment.group === "code" && segment.content)

    if (!text.trim() || (markers.length === 0 && blocks.length === 0)) {
      undecorate()
      refreshPaint()

      return
    }

    // The rendered form already matches this text; only a real edit should rebuild it.
    if (
      decoratedText === text &&
      editor.querySelector(
        "[data-md-marker], [data-md-marker-block], [data-md-code-block], [data-md-code], [data-md-em]",
      )
    )
      return

    const caret = capture(editor)
    undecorate(false)
    decorating = true

    try {
      for (const segment of blocks.sort(firstToLast)) wrap(segment)

      // Markers must collapse before the code chip is resolved: hiding a tick rewrites the text nodes,
      // and a chip range read after that can swallow the following character.
      // Only the ticks of an inline code chip are locked: they are syntax with no content, so a caret
      // inside them would type into hidden text. A fence line stays editable, or a block could never be
      // deleted once its markers collapsed.
      for (const segment of markers.sort(firstToLast))
        hide(
          segment,
          blocks.some((block) => segment.start === block.end || segment.end === block.start),
          codes.some((code) => segment.start === code.start || segment.end === code.end),
        )

      for (const segment of codes.sort(firstToLast)) chip(segment)
      for (const segment of segments.filter((segment) => segment.group === "em" && segment.content).sort(firstToLast))
        emphasis(segment)

      if (caret) restore(editor, caret)
      keepCaretVisible()
    } finally {
      decorating = false
    }

    decoratedText = text
    refreshPaint()

    function wrap(segment: Segment) {
      const entry = locate(textNodes(editor), segment.start, segment.end)
      if (!entry) return

      const span = document.createElement("span")
      span.dataset.mdCodeBlock = ""

      // An empty block has no content to surround, so the span is inserted as a zero-width
      // placeholder that still paints the layer and keeps the caret on the body line.
      if (segment.start === segment.end) {
        const range = document.createRange()
        range.setStart(entry.from.node, entry.from.offset)
        range.collapse(true)
        range.insertNode(span)

        return
      }

      const range = document.createRange()
      range.setStart(entry.from.node, entry.from.offset)
      range.setEnd(entry.to.node, entry.to.offset)

      try {
        range.surroundContents(span)
      } catch {
        // A block that crosses mention chips or other markup stays as plain text.
      }
    }

    function chip(segment: Segment) {
      if (!segment.content) return

      const entry = locate(textNodes(editor), segment.content.start, segment.content.end)
      if (!entry) return

      if (segment.content.end <= segment.content.start) return

      const span = document.createElement("span")
      span.dataset.mdCode = ""
      wrapRange(entry, span, text.slice(segment.content.start, segment.content.end))
    }

    // A fenced block's own fence line takes no room at all. An inline marker keeps a zero-size line box
    // instead: the caret can still sit inside it, which is what makes typing after a closing tick land
    // outside the chip instead of inside it.
    // The highlight API paints colour and decoration but cannot slant text, so emphasis needs its own span.
    function emphasis(segment: Segment) {
      if (!segment.content || segment.content.end <= segment.content.start) return

      const entry = locate(textNodes(editor), segment.content.start, segment.content.end)
      if (!entry) return

      const span = document.createElement("span")
      span.dataset.mdEm = ""
      wrapRange(entry, span, text.slice(segment.content.start, segment.content.end))
    }

    function hide(segment: Segment, block: boolean, lock: boolean) {
      const entry = locate(textNodes(editor), segment.start, segment.end)
      if (!entry) return
      if (typeof window !== "undefined")
        ((window as unknown as { __hide?: unknown[] }).__hide ??= []).push({
          start: segment.start,
          end: segment.end,
          same: entry.from.node === entry.to.node,
          node: entry.from.node.textContent,
          fromOffset: entry.from.offset,
          toNode: entry.to.node.textContent,
          toOffset: entry.to.offset,
        })

      const span = document.createElement("span")
      if (block) {
        span.dataset.mdMarkerBlock = ""
      } else {
        span.dataset.mdMarker = ""
        if (lock) span.contentEditable = "false"
      }
      wrapRange(entry, span, text.slice(segment.start, segment.end))
    }
  }

  // Moving past the first or last line of a fenced block leaves the block. When there is nothing outside it
  // in that direction, a new line is added so the caret lands somewhere visible instead of on the fence.
  const leaveBlockVertically = (direction: "up" | "down") => {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !selection.isCollapsed) return false

    const node = selection.anchorNode
    if (!node || !editor.contains(node)) return false

    const caret = textOffset(editor, node, selection.anchorOffset)
    if (caret === undefined) return false
    if (typeof window !== "undefined")
      ((window as unknown as { __vert?: unknown[] }).__vert ??= []).push({
        direction,
        caret,
        blocks: [...editor.querySelectorAll("[data-md-code-block]")].map((b) => [
          elementStart(editor, b),
          elementEnd(editor, b),
        ]),
      })

    // Find the block by text range instead of the anchor's ancestors: an empty block has no text node, so
    // its caret sits on the editor itself and `closest` would miss it.
    const blocks = [...editor.querySelectorAll("[data-md-code-block]")] as HTMLElement[]
    const found = blocks
      .map((candidate) => ({ candidate, start: elementStart(editor, candidate), end: elementEnd(editor, candidate) }))
      .find(({ start, end }) => start !== undefined && end !== undefined && caret >= start && caret <= end)
    if (!found || found.start === undefined) {
      // Outside a block: up on the line right below one returns to its last line, down on the line right
      // above one returns to its first line. Leave the browser to everything else.
      const source = editor.textContent ?? ""
      const candidate = blocks
        .map((candidate) => ({
          block: candidate,
          // Include the fences: they are part of the block in source order, so the gap check must start
          // outside them.
          start: elementStart(editor, candidate.previousElementSibling ?? candidate),
          end: elementEnd(editor, candidate.nextElementSibling ?? candidate),
        }))
        .filter(({ start, end }) => {
          // The caret only returns to the block from its immediate neighbouring line: the gap may hold one
          // newline and that line's text, never a blank line in between.
          if (direction === "up")
            return end !== undefined && end <= caret && source.slice(end, caret).split("\n").length <= 2
          return start !== undefined && start >= caret && source.slice(caret, start).split("\n").length <= 2
        })
        .sort((a, b) => (direction === "up" ? (b.end ?? 0) - (a.end ?? 0) : (a.start ?? 0) - (b.start ?? 0)))[0]
      if (!candidate) return false

      // Land inside the block's own text node. An offset on its boundary resolves to the fence node, where
      // the caret has no line box.
      const textNode = direction === "up" ? candidate.block.lastChild : candidate.block.firstChild
      if (textNode?.nodeType === Node.TEXT_NODE) {
        const at = document.createRange()
        at.setStart(textNode, direction === "up" ? (textNode as Text).data.length : 0)
        at.collapse(true)
        selection.removeAllRanges()
        selection.addRange(at)

        return true
      }

      const target = direction === "up" ? elementEnd(editor, candidate.block) : elementStart(editor, candidate.block)
      if (target === undefined) return false

      const at = locate(textNodes(editor), target, target)
      if (!at) return false

      selection.setBaseAndExtent(at.from.node, at.from.offset, at.from.node, at.from.offset)

      return true
    }

    const block = found.candidate
    const start = found.start
    const body = block.textContent ?? ""
    const relative = caret - start
    if (relative < 0 || relative > body.length) return false

    if (direction === "up") {
      if (relative > 0 && body.slice(0, relative).includes("\n")) return false
    } else if (relative < body.length && body.slice(relative).includes("\n")) return false

    const fence = direction === "up" ? block.previousElementSibling : block.nextElementSibling
    if (!fence) return false

    const source = editor.textContent ?? ""
    const fenceStart = elementStart(editor, fence)
    const fenceEnd = elementEnd(editor, fence)
    if (fenceStart === undefined || fenceEnd === undefined) return false

    const outside = direction === "up" ? source.slice(0, fenceStart) : source.slice(fenceEnd)
    // Chromium folds a lone trailing newline into the line above, so a block at the end of the draft needs
    // two to keep a caret line of its own.
    // A zero-width space gives the empty line a caret box; a plain newline has none and folds into the fence.
    const line = document.createTextNode(direction === "up" ? "\n" : "\n\u200B")

    // An existing line above or below, even an empty one, is somewhere to land. Only a block already at the
    // very start or end of the draft needs a new line.
    if (outside.length === 0) {
      fence.parentElement?.insertBefore(line, direction === "up" ? fence : fence.nextSibling)
      const at = document.createRange()
      // Down lands on the first new line itself, so the draft shows one blank line rather than two.
      // Down lands on the first blank line: the second newline only keeps Chromium from folding the first
      // into the fence line.
      at.setStart(line, direction === "up" ? 0 : 1)
      at.collapse(true)
      selection.removeAllRanges()
      selection.addRange(at)
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak" }))

      return true
    }

    // Land inside the neighbouring line's own text node. A bare offset on a line boundary is resolved by the
    // browser to the fence side, which is how typing ended up back inside the block.
    const neighbour = direction === "up" ? previousText(fence) : nextText(fence)
    if (!neighbour) return false

    const at = document.createRange()
    at.setStart(neighbour, direction === "up" ? neighbour.data.length : neighbour.data.startsWith("\n") ? 1 : 0)
    at.collapse(true)
    selection.removeAllRanges()
    selection.addRange(at)

    return true
  }

  // Nearest non-empty text node before an element, so a caret can sit inside the line above a fence.
  const previousText = (element: Element) => {
    for (let node = element.previousSibling; node; node = node.previousSibling) {
      if (node.nodeType !== Node.TEXT_NODE) continue
      const text = node as Text
      if (text.data.trim() === "") continue
      return text
    }
  }

  // Nearest non-empty text node after an element, skipping the newline that starts the next line.
  const nextText = (element: Element) => {
    for (let node = element.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType !== Node.TEXT_NODE) continue
      const text = node as Text
      if (text.data.trim() === "") continue
      return text
    }
  }

  const leaveMarker = () => {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !selection.isCollapsed) return

    const node = selection.anchorNode
    if (!node || !editor.contains(node)) return

    const marker = (node instanceof Element ? node : node.parentElement)?.closest("[data-md-marker]")
    if (!marker) return

    const range = document.createRange()
    range.setStartAfter(marker)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  // A hidden marker takes no layout, so a caret that lands inside one would show somewhere the user did
  // not put it. Move it to the nearest visible edge of the marker instead.
  const keepCaretVisible = () => {
    const selection = window.getSelection()
    if (!selection?.rangeCount || !selection.isCollapsed) return

    const node = selection.anchorNode
    if (!node || !editor.contains(node)) return

    const element = node instanceof Element ? node : node.parentElement
    const marker = element?.closest("[data-md-marker-block]")
    if (!marker) return

    const range = document.createRange()
    if (selection.anchorOffset >= (node.textContent?.length ?? 0)) range.setStartAfter(marker)
    else range.setStartBefore(marker)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const schedule = () => {
    if (disposed) return

    if (frame === undefined) {
      frame = requestAnimationFrame(() => {
        frame = undefined
        if (disposed || decorating) return
        refreshPaint()
      })
    }

    if (idle !== undefined) clearTimeout(idle)
    // Only a real pause renders. A steady typist keeps the current rendered form instead of watching the whole
    // draft rebuilt every few hundred milliseconds.
    idle = setTimeout(() => {
      idle = undefined
      if (disposed || decorating) return
      decorate()
    }, IDLE)
  }

  // Chrome remembers the style at the caret and re-wraps newly typed text in it. After a marker with
  // `font-size: 0` has been deleted, that leaves the draft transparent. Unwrap those copies so typed text
  // always inherits the editor's own style.
  const stripFormats = () => {
    // A mention carries an inline style of its own (bidi isolation), so it must survive this sweep.
    const wrappers = Array.from(editor.querySelectorAll("font, span[style]")).filter(
      (wrapper) => !(wrapper instanceof HTMLElement && wrapper.dataset.mention),
    )
    if (wrappers.length === 0) return

    const caret = capture(editor)
    decorating = true
    for (const wrapper of wrappers) wrapper.replaceWith(...Array.from(wrapper.childNodes))
    editor.normalize()
    decorating = false
    if (caret) restore(editor, caret)
  }

  // A typed backtick renders at once instead of waiting for the typing pause: the draft reads as code
  // from the first tick, which is what makes the transition feel immediate.
  const onInput = () => {
    selectedAll = false
    stripFormats()

    if (!(editor.textContent ?? "").endsWith("`")) return
    if (idle !== undefined) clearTimeout(idle)
    idle = undefined

    // Render on the next frame instead of inside the input event: rebuilding the draft synchronously here
    // forces a layout in the same task as the browser's own edit, which reads as a flash.
    if (immediate !== undefined) return
    immediate = requestAnimationFrame(() => {
      immediate = undefined
      if (disposed || decorating) return
      decorate()
    })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return

    // An empty fenced block has no text of its own, so backspace would step through its ticks one at a
    // time. Delete the whole block in one go instead, restoring the source first so the range is plain
    // text and the caret lands where the block started.
    if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const selection = window.getSelection()

      if (selection?.rangeCount && selection.isCollapsed) {
        const source = editor.textContent ?? ""

        if (source.includes("```") || source.includes("~~~")) {
          const removed = emptyFenceRange(collect(source))

          if (removed) {
            const caretRange = document.createRange()
            caretRange.selectNodeContents(editor)
            caretRange.setEnd(selection.anchorNode!, selection.anchorOffset)
            const caret = caretRange.toString().length

            if (caret >= removed.start && caret <= removed.end) {
              event.preventDefault()
              undecorate(false)
              const nodes = textNodes(editor)
              const start = point(nodes, removed.start)
              const end = endPoint(nodes, removed.end)

              if (start && end) {
                const range = document.createRange()
                range.setStart(start.node, start.offset)
                range.setEnd(end.node, end.offset)
                range.deleteContents()

                const at = point(textNodes(editor), removed.start)
                if (at) selection.setBaseAndExtent(at.node, at.offset, at.node, at.offset)
              }

              editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))
            }
          }
        }
      }
    }

    // A fenced block is its own box, so the browser's select-all stops inside it. Select the whole draft.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault()
      selectedAll = true
      if (typeof window !== "undefined")
        (window as unknown as { __cmdA?: number }).__cmdA = ((window as unknown as { __cmdA?: number }).__cmdA ?? 0) + 1
      const range = document.createRange()
      range.selectNodeContents(editor)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const again = document.createRange()
          again.selectNodeContents(editor)
          window.getSelection()?.removeAllRanges()
          window.getSelection()?.addRange(again)
        }),
      )

      return
    }
    // A selection that includes a hidden fence deletes through the source, otherwise the browser removes the
    // wrong visible characters and leaves the fence behind.
    if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const selection = window.getSelection()
      if (selection?.rangeCount && !selection.isCollapsed) {
        const range = selection.getRangeAt(0)
        const source = editor.textContent ?? ""
        const start = offsetOf(editor, range.startContainer, range.startOffset)
        const removed = range.cloneContents().textContent ?? ""
        const hidden = removed !== selection.toString()

        if (hidden && start !== undefined) {
          event.preventDefault()
          const next = source.slice(0, start) + source.slice(start + removed.length)
          editor.textContent = next
          editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))

          return
        }
      }
    }

    // Deleting a whole selection through the browser would leave a fenced block's hidden fences behind.
    if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (selectedAll) {
        event.preventDefault()
        selectedAll = false
        editor.textContent = ""
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))

        return
      }
    }

    // A line break inside a zero-size marker would split the hidden span. Move the caret past the marker
    // first, so the new line lands in the draft itself.
    if (event.key === "Enter") leaveMarker()
    // Up on the block's first line and down on its last line leave the block, the way the caret leaves any
    // other nested box.
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      leaveBlockVertically(event.key === "ArrowUp" ? "up" : "down")
    )
      event.preventDefault()

    // Typing on a fence line would turn the closing fence into body text. Leave the block first.
    if (event.key.length === 1) leaveMarker()
    // Tab belongs to the draft here: two spaces read as code indentation, and focus stays in the editor.
    if (event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      document.execCommand("insertText", false, "  ")
    }
  }

  // A paste or a text drop rewrites the draft through the browser, which must see the source as well.
  const onPaste = () => undecorate()
  const onDrop = () => undecorate()

  // A fenced block's own lines are hidden with `display: none`, so the browser's selection text omits them.
  // Copy the selected DOM instead, which still holds the fences, so pasting elsewhere restores the source.
  const onCopy = (event: ClipboardEvent) => {
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.commonAncestorContainer)) return

    const selected = range.cloneContents().textContent ?? ""
    if (selected === selection.toString()) return

    event.clipboardData?.setData("text/plain", selected)
    event.preventDefault()
  }

  // Draft restore, history recall and mention parsing all rewrite the editor without an input event.
  const observer = new MutationObserver(() => {
    if (decorating) return

    const text = editor.textContent ?? ""

    // Typing plain words changes the text under an already rendered form without changing its structure, so
    // the decoration stays as it is. Rebuilding there is what made every keystroke look like a re-render.
    if (
      decoratedText !== undefined &&
      text !== decoratedText &&
      !touchesSyntax(decoratedText, text) &&
      !hasOpenFragment(decoratedText) &&
      !hasOpenFragment(text)
    ) {
      decoratedText = text
      refreshPaint()
      return
    }

    schedule()
  })
  observer.observe(editor, { childList: true, characterData: true, subtree: true })

  const onCompositionStart = () => {
    composing = true
  }
  const onCompositionEnd = () => {
    composing = false
    schedule()
  }
  const onFocus = () => schedule()
  const onPointerDown = () => {
    selectedAll = false
  }
  const onBlur = () => decorate()

  editor.addEventListener("input", onInput)
  // Capture phase: select-all has to run before the editor's own handler and the browser's block-scoped
  // behaviour.
  editor.addEventListener("keydown", onKeyDown, true)
  editor.addEventListener("compositionstart", onCompositionStart)
  editor.addEventListener("compositionend", onCompositionEnd)
  editor.addEventListener("focus", onFocus)
  editor.addEventListener("pointerdown", onPointerDown)
  editor.addEventListener("blur", onBlur)
  editor.addEventListener("paste", onPaste)
  editor.addEventListener("drop", onDrop)
  editor.addEventListener("copy", onCopy)
  schedule()

  return {
    schedule,
    dispose() {
      disposed = true
      observer.disconnect()
      editor.removeEventListener("input", onInput)
      editor.removeEventListener("keydown", onKeyDown, true)
      editor.removeEventListener("compositionstart", onCompositionStart)
      editor.removeEventListener("compositionend", onCompositionEnd)
      editor.removeEventListener("focus", onFocus)
      editor.removeEventListener("pointerdown", onPointerDown)
      editor.removeEventListener("blur", onBlur)
      editor.removeEventListener("paste", onPaste)
      editor.removeEventListener("drop", onDrop)
      editor.removeEventListener("copy", onCopy)
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (immediate !== undefined) cancelAnimationFrame(immediate)
      if (idle !== undefined) clearTimeout(idle)
      clearPaint()
    },
  }
}

type Caret = { start: number; end: number; direction: "forward" | "backward" }

function capture(editor: HTMLElement): Caret | undefined {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  if (!selection.anchorNode || !selection.focusNode) return
  if (!editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return

  const anchor = textOffset(editor, selection.anchorNode, selection.anchorOffset)
  const focus = textOffset(editor, selection.focusNode, selection.focusOffset)
  if (anchor === undefined || focus === undefined) return

  const forward = anchor < focus || (anchor === focus && selection.anchorOffset <= selection.focusOffset)

  return forward
    ? { start: anchor, end: focus, direction: "forward" }
    : { start: focus, end: anchor, direction: "backward" }
}

/** Offset of a DOM position in the editor's text order, counting hidden markers. */
function textOffset(editor: HTMLElement, node: Node, offset: number) {
  if (!editor.contains(node)) return

  const entry = textNodes(editor).find((item) => item.node === node)
  if (entry) return entry.start + offset

  // An element position (an empty block's placeholder, or a boundary between rendered segments) has no
  // text node of its own; measure it the way a selection would.
  return offsetOf(editor, node, offset)
}

function offsetOf(editor: HTMLElement, node: Node, offset: number) {
  if (!editor.contains(node)) return

  const range = document.createRange()
  range.setStart(editor, 0)
  range.setEnd(node, offset)

  return range.toString().length
}

function restore(editor: HTMLElement, caret: Caret) {
  const selection = window.getSelection()
  if (!selection) return

  const nodes = textNodes(editor)

  if (caret.start === caret.end) {
    const at = caretPoint(nodes, caret.start)
    if (!at) return
    selection.setBaseAndExtent(at.node, at.offset, at.node, at.offset)
    keepCaretOutsideMention(editor)

    return
  }

  const entry = locate(nodes, caret.start, caret.end)
  if (!entry) return

  if (caret.direction === "forward")
    selection.setBaseAndExtent(entry.from.node, entry.from.offset, entry.to.node, entry.to.offset)
  else selection.setBaseAndExtent(entry.to.node, entry.to.offset, entry.from.node, entry.from.offset)
  keepCaretOutsideMention(editor)
}

/**
 * Where a collapsed caret lands in the rendered draft. It prefers the end of the preceding text node,
 * which keeps it after a hidden marker instead of in an empty node, but never inside a hidden marker:
 * text typed there joins the marker's range and paints transparent, so the draft looks empty.
 */
function caretPoint(nodes: ReturnType<typeof textNodes>, position: number) {
  const at = endPoint(nodes, position) ?? point(nodes, position)
  if (!at || !hiddenMarker(at.node)) return at

  const visible = point(nodes, position)
  if (visible && !hiddenMarker(visible.node)) return visible

  // An empty fenced block has no text of its own, so the caret goes inside the block element itself.
  const block = hiddenMarker(at.node)?.nextElementSibling
  if (block instanceof HTMLElement && block.dataset.mdCodeBlock !== undefined) return { node: block, offset: 0 }

  return at
}

function hiddenMarker(node: Node) {
  return (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
    "[data-md-marker], [data-md-marker-block]",
  )
}

/**
 * A mention is one atomic chip, but text offsets count its label, so a caret restored to that range
 * lands inside the chip. Typing or backspacing there edits the label and drops the chip's colour, so
 * the caret moves just past the whole mention instead.
 */
function keepCaretOutsideMention(editor: HTMLElement) {
  const selection = window.getSelection()
  const node = selection?.anchorNode
  if (!node || !selection?.isCollapsed) return
  const mention = (node instanceof Element ? node : node.parentElement)?.closest("[data-mention]")
  if (!mention || !editor.contains(mention)) return

  const range = document.createRange()
  range.setStartAfter(mention)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Offset of the first character inside an element, in the editor's text order. */
function elementStart(editor: HTMLElement, element: Element) {
  const nodes = textNodes(editor)
  const inside = nodes.filter((entry) => element.contains(entry.node))
  if (inside.length > 0) return inside[0]!.start

  // An empty element (an empty fenced block) has no text of its own: its position is where the text before
  // it ends.
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  let offset = 0

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (element.contains(node)) return offset
    if (element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) return offset
    offset += (node as Text).data.length
  }

  return offset
}

/** Offset just past the last character inside an element, in the editor's text order. */
function elementEnd(editor: HTMLElement, element: Element) {
  const nodes = textNodes(editor)
  const inside = nodes.filter((entry) => element.contains(entry.node))
  if (inside.length > 0) return inside.at(-1)!.end

  return elementStart(editor, element)
}

function textNodes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; start: number; end: number }[] = []
  let offset = 0

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    nodes.push({ node: text, start: offset, end: offset + text.data.length })
    offset += text.data.length
  }

  return nodes
}

function locate(nodes: ReturnType<typeof textNodes>, start: number, end: number) {
  const from = point(nodes, start)
  if (!from) return
  // Wrapping a marker or a code chip succeeds when the range stays inside one text node; an end that
  // resolves to the next node's first character makes `surroundContents` split two nodes and throw.
  const to = start === end ? from : endPoint(nodes, end)
  if (!to) return
  return { from, to }
}

function endPoint(nodes: ReturnType<typeof textNodes>, position: number) {
  for (const entry of nodes) {
    // Skip empty text nodes: a caret placed in one has no line box.
    if (entry.start === entry.end) continue
    if (entry.end === position) return { node: entry.node, offset: entry.end - entry.start }
    if (position > entry.start && position < entry.end) return { node: entry.node, offset: position - entry.start }
  }
}

function point(nodes: ReturnType<typeof textNodes>, position: number) {
  // Prefer a node boundary that starts at the position, so an empty range lands after a line
  // break instead of at the previous node's end.
  for (const entry of nodes) {
    if (entry.start === entry.end) continue
    if (entry.start === position) return { node: entry.node, offset: 0 }
    if (position > entry.start && position < entry.end) return { node: entry.node, offset: position - entry.start }
  }

  for (const entry of nodes) {
    if (position === entry.end) return { node: entry.node, offset: entry.end - entry.start }
  }
}

function toRange(nodes: ReturnType<typeof textNodes>, start: number, end: number) {
  const entry = locate(nodes, start, end)
  if (!entry) return

  const range = document.createRange()
  range.setStart(entry.from.node, entry.from.offset)
  range.setEnd(entry.to.node, entry.to.offset)

  return range
}

/** Wraps exactly the located range. Partial text nodes are split by hand: `surroundContents` can pull the
 * rest of the node into the wrapper when the range starts or ends inside one. */
function wrapRange(entry: ReturnType<typeof locate>, span: HTMLElement, expected: string) {
  if (!entry) return

  const range = document.createRange()
  range.setStart(entry.from.node, entry.from.offset)
  range.setEnd(entry.to.node, entry.to.offset)

  // Never let a misplaced range pull neighbouring text into the wrapper: skip instead, leaving it as source.
  if (range.toString() !== expected) return

  const fragment = range.extractContents()
  span.appendChild(fragment)
  range.insertNode(span)
}

/** Whether the draft has an unclosed inline fragment, whose boundary must follow ordinary typing. */
function hasOpenFragment(text: string) {
  let open: Fence | undefined

  for (const line of text.split("\n")) {
    const fence = nextFence(open, line)
    open = fence.open

    // A fenced block's rows are code, not inline markdown: its fence lines and any ticks inside it are
    // not an open fragment, and treating them as one rebuilt every decoration on every keystroke.
    if (fence.marker || open) continue

    for (const mark of ["`", "~~", "**", "*", "_"]) {
      if (mark === "*" && line.includes("**")) continue
      if ((line.split(mark).length - 1) % 2 === 1) return true
    }
  }

  return false
}

/** Whether an edit added or removed Markdown syntax, which is the only thing a render must react to. */
function touchesSyntax(previous: string, next: string) {
  let start = 0
  const shortest = Math.min(previous.length, next.length)
  while (start < shortest && previous[start] === next[start]) start++

  let end = 0
  while (end < shortest - start && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++

  const changed = previous.slice(start, previous.length - end) + next.slice(start, next.length - end)

  return /[`*_~\n]/.test(changed)
}

/** The source range of an empty fenced block: both fence lines and the blank body between them. */
function emptyFenceRange(segments: Segment[]) {
  const block = segments.find((segment) => segment.group === "codeblock" && segment.start === segment.end)
  if (!block) return

  const open = segments.find((segment) => segment.group === "marker" && segment.end === block.start)
  const close = segments.find((segment) => segment.group === "marker" && segment.start === block.end)
  if (!open || !close) return

  return { start: open.start, end: close.end }
}

function collect(text: string): Segment[] {
  const segments: Segment[] = []

  walk(lexMarkdown(text) as Token[], 0)
  unclosedEmphasis()

  return segments

  // Emphasis typed but not closed yet renders too, so `**bold` reads as bold instead of showing its stars.
  // Only the last unpaired marker on a line opens a fragment, and it stops where the next parsed fragment
  // begins, so a closed range further along the line keeps its own rendering.
  function unclosedEmphasis() {
    const marks: { token: string; group: Group }[] = [
      { token: "**", group: "strong" },
      { token: "__", group: "strong" },
    ]

    let lineStart = 0

    while (lineStart <= text.length) {
      const breakAt = text.indexOf("\n", lineStart)
      const lineEnd = breakAt === -1 ? text.length : breakAt
      const line = text.slice(lineStart, lineEnd)
      const taken = new Set<number>()
      let best: { start: number; token: string; group: Group } | undefined

      for (const mark of marks) {
        const positions: number[] = []

        for (let index = 0; index + mark.token.length <= line.length; index++) {
          if (!line.startsWith(mark.token, index)) continue
          // A shorter marker must not count the characters of a longer one (`*` inside `**`).
          if (mark.token.length === 1 && taken.has(index)) continue
          const position = lineStart + index
          if (segments.some((segment) => position >= segment.start && position < segment.end)) continue

          positions.push(position)
          if (mark.token.length > 1) {
            taken.add(index)
            taken.add(index + 1)
          }
        }

        // Two occurrences close each other; an odd count leaves the last one open. A longer marker wins
        // over its own characters, so `**bold*` stays one bold fragment instead of flipping to emphasis.
        if (positions.length % 2 === 0) continue
        best = { start: positions.at(-1)!, token: mark.token, group: mark.group }
        break
      }

      if (best && lineEnd > best.start + best.token.length) {
        const next = segments
          .filter((segment) => segment.start > best.start)
          .reduce((min, segment) => Math.min(min, segment.start), lineEnd)
        const end = Math.min(lineEnd, next)

        if (end > best.start + best.token.length) {
          add(best.start, end, best.group, { start: best.start + best.token.length, end })
          add(best.start, best.start + best.token.length, "marker")
        }
      }

      if (breakAt === -1) break
      lineStart = breakAt + 1
    }
  }

  function walk(tokens: Token[], from: number) {
    let offset = from

    for (const token of tokens) {
      const raw = token.raw ?? ""
      const at = raw ? text.indexOf(raw, offset) : -1
      const start = at === -1 ? offset : at
      const end = start + raw.length
      offset = end

      switch (token.type) {
        case "heading": {
          // Headings are not rendered in the composer: the hashes stay visible as typed text.
          const prefix = linePrefix(raw, /^[ \t]*#{1,6}[ \t]+/)
          inline(token.tokens, start + prefix)
          break
        }

        case "paragraph":
        case "text": {
          inline(token.tokens, start)
          break
        }

        case "blockquote": {
          add(start, end, "quote")
          for (const prefix of linePrefixes(raw, start, /^[ \t]*>[ \t]?/)) add(prefix.start, prefix.end, "marker")
          walk(token.tokens ?? [], start)
          break
        }

        case "list": {
          for (const item of token.items ?? []) {
            const itemRaw = item.raw ?? ""
            const itemAt = itemRaw ? text.indexOf(itemRaw, start) : -1
            const itemStart = itemAt === -1 ? start : itemAt
            add(itemStart, itemStart + itemRaw.length, "list")
            const prefix = linePrefix(itemRaw, /^[ \t]*[-*+][ \t]+/)
            if (prefix) add(itemStart, itemStart + prefix, "marker")
            walk(item.tokens ?? [], itemStart + prefix)
          }
          break
        }

        case "code": {
          const lines = raw.split("\n")
          // A fence line only closes the block when it matches the opening run: the same character, at
          // least as long, and nothing after it. A shorter run or another marker inside a longer fence
          // is body text, so hiding it would swallow the line the user is typing on.
          const fence = nextFence(undefined, lines[0]).open
          const trimmed = raw.replace(/\s+$/, "")
          const lastBreak = trimmed.lastIndexOf("\n")
          const closed =
            !!fence && lastBreak > 0 && nextFence(fence, trimmed.slice(lastBreak + 1)).open === undefined

          // Until the line is committed with a line break, the fence run is still the line the user is
          // typing on. Collapsing it there hid the characters as they were typed, so a lone run stays
          // as plain text and only becomes a block once there is a body line below it.
          if (fence && lines.length > 1) {
            // The fence line's own line break belongs to the marker too, so hiding the marker removes
            // the whole line box instead of leaving an empty 20px line above the block.
            const bodyStart = start + lines[0].length + (raw.length > lines[0].length ? 1 : 0)
            // An open fence with no body yet still owns an empty block, so the caret has a visible place
            // to land instead of being restored into the hidden fence line.
            const bodyEnd = Math.max(bodyStart, start + trimmed.length)
            add(start, bodyStart, "marker")
            add(bodyStart, closed ? start + lastBreak : bodyEnd, "codeblock")
            // Hide the closing fence with the line break in front of it. The line break after it joins the
            // marker too, otherwise it draws an empty line between the block and the next line.
            if (closed) {
              const after = start + trimmed.length
              add(start + lastBreak, text[after] === "\n" ? after + 1 : after, "marker")
            }
          }
          break
        }
      }
    }
  }

  function inline(tokens: Token[] | undefined, from: number) {
    if (!tokens) return
    let offset = from

    for (const token of tokens) {
      const raw = token.raw ?? ""
      const at = raw ? text.indexOf(raw, offset) : -1
      const start = at === -1 ? offset : at
      const end = start + raw.length
      offset = end

      switch (token.type) {
        case "strong": {
          add(start, end, "strong")
          markers(start, end, raw.startsWith("__") ? "__" : "**")
          inline(token.tokens, start + 2)
          break
        }

        case "em": {
          // Italics stay literal in the composer, so the markers keep their own box and colour.
          const marker = raw.startsWith("_") ? "_" : "*"
          inline(token.tokens, start + marker.length)
          break
        }

        case "del": {
          // Strikethrough stays literal in the composer.
          inline(token.tokens, start + 2)
          break
        }

        case "codespan": {
          const marker = /^`+/.exec(raw)?.[0] ?? "`"
          // The chip covers the code itself; the fence ticks are markers that render as nothing.
          add(start, end, "code", { start: start + marker.length, end: end - marker.length })
          markers(start, end, marker)
          break
        }

        case "link": {
          add(start, end, "link")
          const label = token.text ?? ""
          const open = text.indexOf("[", start)
          const close = open === -1 ? -1 : open + 1 + label.length
          if (close !== -1) {
            add(open, open + 1, "marker")
            add(close, end, "marker")
          }
          break
        }
      }
    }
  }

  function markers(start: number, end: number, marker: string) {
    if (end - start < marker.length * 2) return
    add(start, start + marker.length, "marker")
    add(end - marker.length, end, "marker")
  }

  function add(start: number, end: number, group: Group, content?: { start: number; end: number }) {
    // An empty code block still needs a segment so its layer paints before the first character.
    if (group === "codeblock" ? end < start : end <= start) return
    segments.push(content ? { start, end, group, content } : { start, end, group })
  }
}

function linePrefix(raw: string, pattern: RegExp) {
  const match = raw.match(pattern)
  return match ? match[0].length : 0
}

function linePrefixes(raw: string, base: number, pattern: RegExp) {
  const prefixes: { start: number; end: number }[] = []
  let offset = 0

  for (const line of raw.split("\n")) {
    const match = line.match(pattern)
    if (match) prefixes.push({ start: base + offset, end: base + offset + match[0].length })
    offset += line.length + 1
  }

  return prefixes
}
