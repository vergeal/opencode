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

type Segment = { start: number; end: number; group: Group }

type Token = { type: string; raw?: string; text?: string; tokens?: Token[]; items?: Token[] }

const IDLE = 700

/**
 * Styles markdown in the composer.
 *
 * Syntax paint uses the CSS Custom Highlight API, so the editor's own text model, caret and mentions stay
 * untouched. When typing pauses, syntax markers collapse into zero-width hidden spans so the draft reads as
 * rendered markdown. Any key press, press or blur restores the source first, so editing always happens on the
 * plain text the editor and its mention parser expect.
 */
export function createMarkdownHighlight(editor: HTMLElement) {
  let frame: number | undefined
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

      const range = toRange(nodes, segment.start, segment.end)
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
    paint(text, collect(text).filter((segment) => segment.group !== "marker"))
  }

  const decorate = () => {
    if (disposed || composing) return
    if (editor.querySelector("[data-md-marker], [data-md-code-block]")) return

    const text = editor.textContent ?? ""
    if (!text.trim()) return

    const segments = collect(text)
    const blocks = segments.filter((segment) => segment.group === "codeblock")
    const markers = segments.filter((segment) => segment.group === "marker")
    if (blocks.length === 0 && markers.length === 0) return

    const caret = capture(editor)
    decorating = true

    try {
      for (const block of blocks.sort((a, b) => b.start - a.start)) wrap(block)
      for (const segment of markers.sort((a, b) => b.start - a.start)) hide(segment)
      if (caret) restore(editor, caret)
    } finally {
      decorating = false
    }

    function wrap(segment: Segment) {
      const entry = locate(textNodes(editor), segment.start, segment.end)
      if (!entry) return

      const range = document.createRange()
      range.setStart(entry.from.node, entry.from.offset)
      range.setEnd(entry.to.node, entry.to.offset)

      const span = document.createElement("span")
      span.dataset.mdCodeBlock = ""

      try {
        range.surroundContents(span)
      } catch {
        // A block that crosses mention chips or other markup stays as plain text.
      }
    }

    function hide(segment: Segment) {
      const entry = locate(textNodes(editor), segment.start, segment.end)
      if (!entry) return

      const range = document.createRange()
      range.setStart(entry.from.node, entry.from.offset)
      range.setEnd(entry.to.node, entry.to.offset)

      const span = document.createElement("span")
      span.dataset.mdMarker = ""

      try {
        range.surroundContents(span)
      } catch {
        // A marker spanning mention chips stays as plain text.
      }
    }
  }

  const undecorate = (restoreCaret = true) => {
    const decorated = Array.from(editor.querySelectorAll("[data-md-marker], [data-md-code-block]"))
    if (decorated.length === 0) return

    const caret = restoreCaret ? capture(editor) : undefined
    decorating = true

    for (const element of decorated) element.replaceWith(document.createTextNode(element.textContent ?? ""))
    editor.normalize()

    decorating = false
    if (caret) restore(editor, caret)
    refreshPaint()
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
    idle = setTimeout(() => {
      idle = undefined
      if (disposed || decorating) return
      decorate()
    }, IDLE)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key.length > 1 && event.key !== "Backspace" && event.key !== "Delete") return
    undecorate()
  }

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
  const onFocus = () => undecorate()
  const onBlur = () => decorate()

  editor.addEventListener("keydown", onKeyDown)
  editor.addEventListener("compositionstart", onCompositionStart)
  editor.addEventListener("compositionend", onCompositionEnd)
  editor.addEventListener("pointerdown", onPointerDown)
  editor.addEventListener("focus", onFocus)
  editor.addEventListener("blur", onBlur)
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

  return forward ? { start: anchor, end: focus, direction: "forward" } : { start: focus, end: anchor, direction: "backward" }
}

function offsetOf(editor: HTMLElement, node: Node, offset: number) {
  if (!editor.contains(node)) return

  const range = document.createRange()
  range.setStart(editor, 0)
  range.setEnd(node, offset)

  return range.toString().length
}

function restore(editor: HTMLElement, caret: Caret) {
  const nodes = textNodes(editor)
  const from = locate(nodes, caret.start, caret.end)
  const to = locate(nodes, caret.start, caret.end)
  if (!from || !to) return

  const selection = window.getSelection()
  if (!selection) return

  if (caret.direction === "forward") selection.setBaseAndExtent(from.from.node, from.from.offset, to.to.node, to.to.offset)
  else selection.setBaseAndExtent(to.to.node, to.to.offset, from.from.node, from.from.offset)
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
  const to = point(nodes, end)
  if (!from || !to) return
  return { from, to }
}

function point(nodes: ReturnType<typeof textNodes>, position: number) {
  for (const entry of nodes) {
    if (position < entry.start || position > entry.end) continue

    return { node: entry.node, offset: position - entry.start }
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

  return segments

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
            add(start, start + lines[0].length, "marker")
            add(start + lines[0].length + 1, closed ? start + lastBreak : start + trimmed.length, "codeblock")
          }
          if (closed) add(start + lastBreak + 1, start + trimmed.length, "marker")
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
          add(start, end, "code")
          const marker = raw.startsWith("``") ? "``" : "`"
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

  function add(start: number, end: number, group: Group) {
    if (end <= start) return
    segments.push({ start, end, group })
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
