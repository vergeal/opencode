/**
 * Renders code in the composer draft: a single pair of backticks becomes an inline chip and a fenced
 * triple-backtick block becomes its own layer. Every other markdown character stays literal, so the draft
 * shows the source the user typed with only code drawn as code.
 *
 * Decoration is presentation only. The draft text is never rewritten, so the caret, selection, IME, undo,
 * paste and the mention parser keep working on plain text.
 */
type Segment = {
  kind: "fence" | "tick" | "block" | "code"
  start: number
  end: number
  content?: { start: number; end: number }
}

type Caret = { start: number; end: number; direction: "forward" | "backward" }

/** One source-level undo step: the draft and caret as they were before an edit. */
type Snapshot = { text: string; caret: Caret | undefined }

/** The CSS Custom Highlight name for inline code. It still paints code the chip cannot wrap, for example a
 *  range that crosses a mention chip. */
const CODE_HIGHLIGHT = "composer-md-code"

/** A typing pause renders the draft. Short enough to read as immediate, long enough not to churn the
 * editable DOM on every keystroke. */
const IDLE = 150

export function createCodeDecoration(editor: HTMLElement) {
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

    CSS.highlights.delete(CODE_HIGHLIGHT)
  }

  const paint = (text: string, segments: Segment[]) => {
    clearPaint()
    if (!text.trim()) return
    if (typeof CSS === "undefined" || !CSS.highlights) return

    const nodes = textNodes(editor)
    const ranges: Range[] = []

    for (const segment of segments) {
      if (segment.kind !== "code" || !segment.content) continue
      const range = toRange(nodes, segment.content.start, segment.content.end)
      if (range) ranges.push(range)
    }

    if (ranges.length === 0) return
    CSS.highlights.set(CODE_HIGHLIGHT, new Highlight(...ranges))
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

  // Rendering rewrites the editor's child nodes, which drops the browser's undo entry for the edit that came
  // before it, so Cmd/Ctrl+Z stopped working once the draft was decorated. Keep a source-level history
  // instead: each undo restores plain text, which the next render decorates again.
  let lastEditAt = 0
  const past: Snapshot[] = []
  let future: Snapshot[] = []

  // Continuous typing is one undo step, the way the browser merges it; a caret move or another kind of edit
  // starts a new one.
  const record = (mergeable: boolean) => {
    const now = performance.now()
    const continues = mergeable && past.length > 0 && now - lastEditAt < 700
    lastEditAt = now
    if (continues) return

    past.push({ text: editor.textContent ?? "", caret: capture(editor) })
    if (past.length > 40) past.shift()
    future = []
  }

  const applySnapshot = (snapshot: Snapshot) => {
    undecorate(false)
    editor.textContent = snapshot.text
    lastEditAt = 0

    if (snapshot.caret) restore(editor, snapshot.caret)
    else {
      const at = caretPoint(textNodes(editor), 0)
      if (at) window.getSelection()?.setBaseAndExtent(at.node, at.offset, at.node, at.offset)
      else window.getSelection()?.collapse(editor, 0)
    }

    // The draft lives outside this element, so the controller only learns about the restore from an input event.
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }))
  }

  const undoStep = () => {
    const snapshot = past.pop()
    if (!snapshot) return

    future.push({ text: editor.textContent ?? "", caret: capture(editor) })
    applySnapshot(snapshot)
  }

  const redoStep = () => {
    const snapshot = future.pop()
    if (!snapshot) return

    past.push({ text: editor.textContent ?? "", caret: capture(editor) })
    applySnapshot(snapshot)
  }

  // Render from the end of the draft, so wrapping one fragment cannot move the offsets of the next one.
  const firstToLast = (a: Segment, b: Segment) => b.start - a.start

  const decorate = () => {
    if (disposed || composing) return

    const text = editor.textContent ?? ""
    const segments = collect(text)
    const fences = segments.filter((segment) => segment.kind === "fence")
    const ticks = segments.filter((segment) => segment.kind === "tick")
    const blocks = segments.filter((segment) => segment.kind === "block")
    const codes = segments.filter((segment) => segment.kind === "code" && segment.content)

    if (!text.trim() || (fences.length === 0 && ticks.length === 0)) {
      undecorate()
      refreshPaint()

      return
    }

    // The rendered form already matches this text; only a real edit should rebuild it.
    if (
      decoratedText === text &&
      editor.querySelector(
        "[data-md-marker], [data-md-marker-block], [data-md-code-block], [data-md-code]",
      )
    )
      return

    const caret = capture(editor)
    undecorate(false)
    decorating = true

    try {
      for (const segment of blocks.sort(firstToLast)) wrapBlock(segment)

      // Markers must collapse before the code chip is resolved: hiding a tick rewrites the text nodes,
      // and a chip range read after that can swallow the following character.
      for (const segment of fences.sort(firstToLast)) hideFence(segment)
      // Only the ticks of an inline chip are locked: they are syntax with no content, so a caret inside
      // them would type into hidden text. A fence line stays editable, or a block could never be deleted.
      for (const segment of ticks.sort(firstToLast)) hideTick(segment)

      for (const segment of codes.sort(firstToLast)) chip(segment)

      if (caret) restore(editor, caret)
      keepCaretVisible()
    } finally {
      decorating = false
    }

    decoratedText = text
    refreshPaint()

    function wrapBlock(segment: Segment) {
      const entry = locate(textNodes(editor), segment.start, segment.end)
      if (!entry) return

      const span = document.createElement("span")
      span.dataset.mdCodeBlock = ""

      // An empty block has no content to surround, so the span is inserted as a zero-width placeholder
      // that still paints the layer and keeps the caret on the body line.
      if (segment.start === segment.end) {
        const range = document.createRange()
        range.setStart(entry.from.node, entry.from.offset)
        range.collapse(true)
        range.insertNode(span)

        return
      }

      wrapRange(entry, span, text.slice(segment.start, segment.end))
    }

    function hideFence(segment: Segment) {
      const entry = locate(textNodes(editor), segment.start, segment.end)
      if (!entry) return

      const span = document.createElement("span")
      span.dataset.mdMarkerBlock = ""
      wrapRange(entry, span, text.slice(segment.start, segment.end))
    }

    function hideTick(segment: Segment) {
      const entry = locate(textNodes(editor), segment.start, segment.end)
      if (!entry) return

      const span = document.createElement("span")
      span.dataset.mdMarker = ""
      span.contentEditable = "false"
      wrapRange(entry, span, text.slice(segment.start, segment.end))
    }

    function chip(segment: Segment) {
      if (!segment.content) return

      const entry = locate(textNodes(editor), segment.content.start, segment.content.end)
      if (!entry) return

      const span = document.createElement("span")
      span.dataset.mdCode = ""
      wrapRange(entry, span, text.slice(segment.content.start, segment.content.end))
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
      // Down lands on the first blank line: the second newline only keeps Chromium from folding the first
      // into the fence line.
      at.setStart(line, direction === "up" ? 0 : 1)
      at.collapse(true)
      selection.removeAllRanges()
      selection.addRange(at)
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak" }))

      return true
    }

    // Land inside the neighbouring line's own text node. A bare offset on a line boundary is resolved by
    // the browser to the fence side, which is how typing ended up back inside the block.
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

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z") {
      const redo = event.shiftKey

      // Nothing recorded yet: leave the key to the browser, which still owns earlier history.
      if (redo ? future.length === 0 : past.length === 0) return

      event.preventDefault()
      event.stopPropagation()
      if (redo) redoStep()
      else undoStep()

      return
    }

    // Windows and Linux redo.
    if (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "y") {
      if (future.length === 0) return

      event.preventDefault()
      event.stopPropagation()
      redoStep()

      return
    }

    // Moving the caret ends the run that continuous typing shares one undo step with.
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Home" ||
      event.key === "End" ||
      event.key === "PageUp" ||
      event.key === "PageDown"
    )
      lastEditAt = 0

    // An empty fenced block has no text of its own, so backspace would step through its ticks one at a
    // time. Delete the whole block in one go instead, restoring the source first so the range is plain
    // text and the caret lands where the block started.
    if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const selection = window.getSelection()

      if (selection?.rangeCount && selection.isCollapsed) {
        const source = editor.textContent ?? ""

        if (source.includes("```")) {
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
          record(false)
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
        record(false)
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

  // A fenced block's own lines are hidden with absolute positioning, so the browser's selection text omits
  // them. Copy the selected DOM instead, which still holds the fences, so pasting elsewhere restores the
  // source.
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
    // the decoration stays as it is. Only code syntax and line breaks need a rebuild; rebuilding on every
    // keystroke is what made a long draft stutter.
    if (decoratedText !== undefined && text !== decoratedText && !touchesSyntax(decoratedText, text)) {
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
    // A click moves the caret, so the next edit starts its own undo step.
    lastEditAt = 0
  }
  const onBlur = () => decorate()

  // The browser announces the edit before it lands, which is where the undo step's starting point is saved.
  // Paste, drops and line breaks keep their own step; continuous typing merges into the previous one.
  const onBeforeInput = (event: InputEvent) => {
    if (event.isComposing) return
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") return

    record(
      event.inputType === "insertText" ||
        event.inputType === "insertCompositionText" ||
        event.inputType === "deleteContentBackward" ||
        event.inputType === "deleteContentForward",
    )
  }

  editor.addEventListener("input", onInput)
  editor.addEventListener("beforeinput", onBeforeInput)
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
    dispose() {
      disposed = true
      observer.disconnect()
      editor.removeEventListener("input", onInput)
      editor.removeEventListener("beforeinput", onBeforeInput)
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

/**
 * Code ranges in the draft: hidden fence lines, fenced block bodies, hidden inline ticks and inline code.
 * Only a single-backtick span and a triple-backtick fence count. Every other markdown character stays text.
 */
function collect(text: string): Segment[] {
  const segments: Segment[] = []
  const lines = text.split("\n")
  let offset = 0
  let fence: number | undefined
  let bodyStart: number | undefined

  for (const [index, line] of lines.entries()) {
    const start = offset
    const end = start + line.length
    const after = end + (index < lines.length - 1 ? 1 : 0)
    offset = after

    if (fence === undefined) {
      const open = /^[ \t]*(`{3,})/.exec(line)
      // A run with no line break after it is still the line the user is typing on: keep it as plain text
      // until the line is committed, so a language tag or a longer nested run reaches the draft intact.
      if (open && index < lines.length - 1) {
        fence = open[1]!.length
        bodyStart = after
        // The fence line's own line break belongs to the marker too, so hiding it removes the whole line box
        // instead of leaving an empty line above the block.
        segments.push({ kind: "fence", start, end: after })
        continue
      }

      collectInline(line, start, segments)
      continue
    }

    const close = /^[ \t]*(`{3,})[ \t]*$/.exec(line)
    if (close && close[1]!.length >= fence) {
      // The line break in front of the closing fence belongs to the marker, so the body stops before it.
      const boundary = Math.max(bodyStart!, start - 1)
      segments.push({ kind: "block", start: bodyStart!, end: boundary })
      segments.push({ kind: "fence", start: boundary, end: after })
      fence = undefined
      bodyStart = undefined
    }
  }

  if (fence !== undefined && bodyStart !== undefined) {
    // An open fence runs to the end of the draft; trailing whitespace adds no body line of its own.
    const end = Math.max(bodyStart, text.replace(/\s+$/, "").length)
    segments.push({ kind: "block", start: bodyStart, end })
  }

  return segments
}

/** Single-backtick pairs on one line. A run of two or more backticks stays literal. */
function collectInline(line: string, lineStart: number, segments: Segment[]) {
  let open: number | undefined

  for (let index = 0; index < line.length; index++) {
    if (line[index] !== "`") continue

    let run = 1
    while (line[index + run] === "`") run++

    if (run === 1) {
      if (open === undefined) open = index
      else {
        segments.push({ kind: "tick", start: lineStart + open, end: lineStart + open + 1 })
        segments.push({
          kind: "code",
          start: lineStart + open,
          end: lineStart + index + 1,
          content: { start: lineStart + open + 1, end: lineStart + index },
        })
        segments.push({ kind: "tick", start: lineStart + index, end: lineStart + index + 1 })
        open = undefined
      }
    }

    index += run - 1
  }
}

/** Whether an edit added or removed code syntax or a line break, which is the only thing a render must
 *  react to. */
function touchesSyntax(previous: string, next: string) {
  let start = 0
  const shortest = Math.min(previous.length, next.length)
  while (start < shortest && previous[start] === next[start]) start++

  let end = 0
  while (end < shortest - start && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++

  const changed = previous.slice(start, previous.length - end) + next.slice(start, next.length - end)

  return /[`\n]/.test(changed)
}

/** The source range of an empty fenced block: both fence lines and the blank body between them. */
function emptyFenceRange(segments: Segment[]) {
  const block = segments.find((segment) => segment.kind === "block" && segment.start === segment.end)
  if (!block) return

  const open = segments.find((segment) => segment.kind === "fence" && segment.end === block.start)
  const close = segments.find((segment) => segment.kind === "fence" && segment.start === block.end)
  if (!open || !close) return

  return { start: open.start, end: close.end }
}

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

    // A caret that sat just outside a hidden tick can resolve back into the chip. Keep the source
    // position instead of silently moving the caret one character left, so typing after closing code
    // lands outside the code as the user left it.
    const resolved = textOffset(editor, at.node, at.offset)
    if (resolved !== caret.start) {
      const marker = Array.from(editor.querySelectorAll<HTMLElement>("[data-md-marker]")).find(
        (candidate) => elementEnd(editor, candidate) === caret.start || elementStart(editor, candidate) === caret.start,
      )
      if (marker) {
        const range = document.createRange()
        if (elementEnd(editor, marker) === caret.start) range.setStartAfter(marker)
        else range.setStartBefore(marker)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
        keepCaretOutsideMention(editor)

        return
      }
    }

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
  const marker = at ? hiddenMarker(at.node) : undefined
  if (!at || !marker) return at

  const visible = point(nodes, position)
  if (visible && !hiddenMarker(visible.node)) return visible

  // A hidden marker has no text box, so a caret placed inside it has zero height and looks gone. Land on
  // the next visible text instead, or the end of the previous rendered segment when nothing follows.
  for (let node: Node | null = marker.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node as Text).data.length > 0) return { node, offset: 0 }
      continue
    }
    if (node instanceof HTMLElement && !hiddenMarker(node)) {
      const first = textNodes(node)[0]
      if (first) return { node: first.node, offset: 0 }
      if (node.dataset.mdCodeBlock !== undefined) return { node: node, offset: 0 }
    }
  }

  for (let node: Node | null = marker.previousSibling; node; node = node.previousSibling) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text
      if (text.data.length > 0) return { node: text, offset: text.data.length }
      continue
    }
    if (node instanceof HTMLElement && !hiddenMarker(node)) {
      const last = textNodes(node).at(-1)
      if (last) return { node: last.node, offset: last.end - last.start }
      if (node.dataset.mdCodeBlock !== undefined) return { node: node, offset: 0 }
    }
  }

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
function elementStart(editor: HTMLElement, element: Element): number | undefined {
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
function elementEnd(editor: HTMLElement, element: Element): number | undefined {
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
