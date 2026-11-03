import { lexMarkdown } from "@opencode/ui/context/marked-base"

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

/** Longest a burst of typing may keep the draft as source before it renders anyway. */
const MAX_WAIT = 400

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
  let pendingSince: number | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  let decorating = false
  let disposed = false
  let composing = false

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
    paint(
      text,
      collect(text).filter((segment) => segment.group !== "marker"),
    )
  }

  // The text of the last rendered draft. Mutation records arrive after `decorating` is clear, so this is
  // what stops a render from scheduling the next one forever.
  let decoratedText: string | undefined

  const undecorate = (restoreCaret = true) => {
    const decorated = Array.from(
      editor.querySelectorAll("[data-md-marker], [data-md-marker-block], [data-md-code-block], [data-md-code]"),
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
      editor.querySelector("[data-md-marker], [data-md-marker-block], [data-md-code-block], [data-md-code]")
    )
      return

    const caret = capture(editor)
    undecorate(false)
    decorating = true

    try {
      for (const segment of blocks.sort(firstToLast)) wrap(segment)

      for (const segment of codes.sort(firstToLast)) chip(segment)

      for (const segment of markers.sort(firstToLast))
        hide(
          segment,
          blocks.some((block) => segment.start === block.end || segment.end === block.start),
        )

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
      if (!segment.content || segment.content.end <= segment.content.start) return

      const entry = locate(textNodes(editor), segment.content.start, segment.content.end)
      if (!entry) return

      const range = document.createRange()
      range.setStart(entry.from.node, entry.from.offset)
      range.setEnd(entry.to.node, entry.to.offset)

      const span = document.createElement("span")
      span.dataset.mdCode = ""

      try {
        range.surroundContents(span)
      } catch {
        // Inline code that crosses mention chips stays as plain text.
      }
    }

    // A fenced block's own fence line takes no room at all. An inline marker keeps a zero-size line box
    // instead: the caret can still sit inside it, which is what makes typing after a closing tick land
    // outside the chip instead of inside it.
    function hide(segment: Segment, block: boolean) {
      const entry = locate(textNodes(editor), segment.start, segment.end)
      if (!entry) return

      const range = document.createRange()
      range.setStart(entry.from.node, entry.from.offset)
      range.setEnd(entry.to.node, entry.to.offset)

      const span = document.createElement("span")
      if (block) span.dataset.mdMarkerBlock = ""
      else span.dataset.mdMarker = ""

      try {
        range.surroundContents(span)
      } catch {
        // A marker spanning mention chips stays as plain text.
      }
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
    const since = (pendingSince ??= performance.now())
    // Steady typing keeps resetting the pause, so the pause alone would leave the draft as source for as long as
    // the user types. Cap the wait so it still renders during a long burst.
    const wait = performance.now() - since >= MAX_WAIT ? 0 : IDLE
    idle = setTimeout(() => {
      idle = undefined
      pendingSince = undefined
      if (disposed || decorating) return
      decorate()
    }, wait)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return
    // A line break inside a zero-size marker would split the hidden span. Move the caret past the marker
    // first, so the new line lands in the draft itself.
    if (event.key === "Enter") leaveMarker()
  }

  // A paste or a text drop rewrites the draft through the browser, which must see the source as well.
  const onPaste = () => undecorate()
  const onDrop = () => undecorate()

  // Draft restore, history recall and mention parsing all rewrite the editor without an input event.
  const observer = new MutationObserver(() => {
    if (decorating) return
    schedule()
  })
  observer.observe(editor, { childList: true, characterData: true, subtree: true })

  const onCompositionStart = () => {
    composing = true
    undecorate()
  }
  const onCompositionEnd = () => {
    composing = false
    schedule()
  }
  // A press inside the draft hits real text, so the browser can place the caret exactly.
  const onPointerDown = () => undecorate(false)
  const onFocus = () => {
    undecorate()
    schedule()
  }
  const onBlur = () => decorate()

  editor.addEventListener("keydown", onKeyDown)
  editor.addEventListener("compositionstart", onCompositionStart)
  editor.addEventListener("compositionend", onCompositionEnd)
  editor.addEventListener("pointerdown", onPointerDown)
  editor.addEventListener("focus", onFocus)
  editor.addEventListener("blur", onBlur)
  editor.addEventListener("paste", onPaste)
  editor.addEventListener("drop", onDrop)
  schedule()

  return {
    schedule,
    dispose() {
      disposed = true
      observer.disconnect()
      editor.removeEventListener("keydown", onKeyDown)
      editor.removeEventListener("compositionstart", onCompositionStart)
      editor.removeEventListener("compositionend", onCompositionEnd)
      editor.removeEventListener("pointerdown", onPointerDown)
      editor.removeEventListener("focus", onFocus)
      editor.removeEventListener("blur", onBlur)
      editor.removeEventListener("paste", onPaste)
      editor.removeEventListener("drop", onDrop)
      if (frame !== undefined) cancelAnimationFrame(frame)
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

  const anchor = offsetOf(editor, selection.anchorNode, selection.anchorOffset)
  const focus = offsetOf(editor, selection.focusNode, selection.focusOffset)
  if (anchor === undefined || focus === undefined) return

  const forward = anchor < focus || (anchor === focus && selection.anchorOffset <= selection.focusOffset)

  return forward
    ? { start: anchor, end: focus, direction: "forward" }
    : { start: focus, end: anchor, direction: "backward" }
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
    // A collapsed caret prefers the end of the preceding text node: that keeps it after a hidden marker
    // rather than in an empty node the browser may not treat as a real insertion point.
    const at = endPoint(nodes, caret.start) ?? point(nodes, caret.start)
    if (!at) return
    selection.setBaseAndExtent(at.node, at.offset, at.node, at.offset)

    return
  }

  const entry = locate(nodes, caret.start, caret.end)
  if (!entry) return

  if (caret.direction === "forward")
    selection.setBaseAndExtent(entry.from.node, entry.from.offset, entry.to.node, entry.to.offset)
  else selection.setBaseAndExtent(entry.to.node, entry.to.offset, entry.from.node, entry.from.offset)
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
    if (entry.end === position) return { node: entry.node, offset: entry.end - entry.start }
    if (position > entry.start && position < entry.end) return { node: entry.node, offset: position - entry.start }
  }
}

function point(nodes: ReturnType<typeof textNodes>, position: number) {
  // Prefer a node boundary that starts at the position, so an empty range lands after a line
  // break instead of at the previous node's end.
  for (const entry of nodes) {
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

function collect(text: string): Segment[] {
  const segments: Segment[] = []

  walk(lexMarkdown(text) as Token[], 0)
  unclosedCode()

  return segments

  // An opening backtick turns the rest of its line into inline code right away, before it is closed. The
  // user expects the text to read as code from the first tick; typing the closing tick ends the chip.
  function unclosedCode() {
    let lineStart = 0

    while (lineStart <= text.length) {
      const breakAt = text.indexOf("\n", lineStart)
      const lineEnd = breakAt === -1 ? text.length : breakAt
      const line = text.slice(lineStart, lineEnd)
      const ticks: number[] = []

      if (!/^[ \t]*(?:`{3,}|~{3,})/.test(line)) {
        for (let index = 0; index < line.length; index++) {
          if (line[index] !== "`") continue
          const position = lineStart + index
          if (segments.some((segment) => position >= segment.start && position < segment.end)) continue
          if (line[index + 1] === "`" || line[index - 1] === "`") continue
          ticks.push(position)
        }

        const start = ticks.at(-1)
        if (ticks.length % 2 === 1 && start !== undefined && lineEnd > start + 1) {
          add(start, lineEnd, "code", { start: start + 1, end: lineEnd })
          add(start, start + 1, "marker")
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
          add(start, end, "heading")
          const prefix = linePrefix(raw, /^[ \t]*#{1,6}[ \t]+/)
          if (prefix) add(start, start + prefix, "marker")
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
            const prefix = linePrefix(itemRaw, /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/)
            if (prefix) add(itemStart, itemStart + prefix, "marker")
            walk(item.tokens ?? [], itemStart + prefix)
          }
          break
        }

        case "code": {
          const lines = raw.split("\n")
          const fenced = /^[ \t]*(?:`{3,}|~{3,})/.test(lines[0])
          const trimmed = raw.replace(/\s+$/, "")
          const lastBreak = trimmed.lastIndexOf("\n")
          const closed = lastBreak > 0 && /^[ \t]*(?:`{3,}|~{3,})[ \t]*$/.test(trimmed.slice(lastBreak + 1))

          if (fenced) {
            // The fence line's own line break belongs to the marker too, so hiding the marker removes
            // the whole line box instead of leaving an empty 20px line above the block.
            const bodyStart = start + lines[0].length + (raw.length > lines[0].length ? 1 : 0)
            add(start, bodyStart, "marker")
            add(bodyStart, closed ? start + lastBreak : start + trimmed.length, "codeblock")
            // Hide the closing fence with the line break in front of it, which would otherwise draw a
            // blank line between the block and whatever follows it.
            if (closed) add(start + lastBreak, start + trimmed.length, "marker")
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
          add(start, end, "em")
          const marker = raw.startsWith("_") ? "_" : "*"
          markers(start, end, marker)
          inline(token.tokens, start + marker.length)
          break
        }

        case "del": {
          add(start, end, "strike")
          markers(start, end, "~~")
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
