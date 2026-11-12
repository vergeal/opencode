// OpenCode Chrome Agent content script. Loaded on demand into the isolated world
// of a tab, then driven by background.js over chrome.tabs.sendMessage.
(() => {
  if (window.__opencodeContentAgent) {
    window.__opencodeContentAgent.touch()
    return
  }

  const MAX_SNAPSHOT_CHARS = 100_000
  const MAX_NAME_CHARS = 120
  const REF_ATTRIBUTE = "data-opencode-ref"

  let refSequence = 0
  let refs = new WeakMap()
  let elements = new Map()
  let overlay

  const api = {
    touch() {
      api.alive = Date.now()
    },
    alive: Date.now(),
  }

  function resetRefs() {
    refs = new WeakMap()
    elements = new Map()
    refSequence = 0
    document.querySelectorAll(`[${REF_ATTRIBUTE}]`).forEach((element) => element.removeAttribute(REF_ATTRIBUTE))
  }

  function refFor(element) {
    const existing = refs.get(element)
    if (existing) return existing
    const ref = `e${++refSequence}`
    refs.set(element, ref)
    elements.set(ref, element)
    element.setAttribute(REF_ATTRIBUTE, ref)
    return ref
  }

  function resolve(ref) {
    const element = elements.get(String(ref).replace(/^@/, ""))
    if (!element || !element.isConnected) {
      throw new Error(`Element ref ${ref} is stale. Take a fresh snapshot and use a ref from it.`)
    }
    return element
  }

  function isVisible(element) {
    if (element === overlay?.host) return false
    if (element.hasAttribute("aria-hidden") && element.getAttribute("aria-hidden") === "true") return false
    const style = getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 || rect.height > 0
  }

  function isSkipped(element) {
    return ["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT", "HEAD", "TITLE"].includes(element.tagName)
  }

  function childrenOf(element) {
    const children = Array.from(element.children)
    if (element.shadowRoot) children.push(...Array.from(element.shadowRoot.children))
    return children.filter((child) => !isSkipped(child))
  }

  function directText(element) {
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
  }

  function roleOf(element) {
    const explicit = element.getAttribute("role")
    if (explicit) return explicit.split(" ")[0]
    const tag = element.tagName.toLowerCase()
    if (tag === "a") return element.hasAttribute("href") ? "link" : "generic"
    if (tag === "button" || tag === "summary") return "button"
    if (tag === "textarea") return "textbox"
    if (tag === "select") return element.multiple ? "listbox" : "combobox"
    if (tag === "img") return "img"
    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") return "heading"
    if (tag === "ul" || tag === "ol") return "list"
    if (tag === "li") return "listitem"
    if (tag === "table") return "table"
    if (tag === "tr") return "row"
    if (tag === "td" || tag === "th") return "cell"
    if (tag === "dialog") return "dialog"
    if (tag === "nav") return "navigation"
    if (tag === "main") return "main"
    if (tag === "header") return "banner"
    if (tag === "footer") return "contentinfo"
    if (tag === "aside") return "complementary"
    if (tag === "form") return "form"
    if (tag === "progress") return "progressbar"
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase()
      if (type === "checkbox") return "checkbox"
      if (type === "radio") return "radio"
      if (type === "range") return "slider"
      if (type === "number") return "spinbutton"
      if (type === "search") return "searchbox"
      if (["submit", "button", "reset", "image"].includes(type)) return "button"
      if (type === "file") return "button"
      return "textbox"
    }
    return "generic"
  }

  function nameOf(element, role) {
    const labelledby = element.getAttribute("aria-labelledby")
    const fromLabel =
      labelledby
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText ?? "")
        .join(" ")
        .trim() || ""
    const labels = element.labels?.[0]?.innerText?.trim() || ""
    const candidates = [
      element.getAttribute("aria-label"),
      fromLabel,
      labels,
      element.getAttribute("alt"),
      element.getAttribute("placeholder"),
      element.getAttribute("title"),
      role === "textbox" || role === "combobox" || role === "searchbox" ? "" : directText(element),
      element.tagName === "IMG" ? "" : element.innerText?.trim(),
    ]
    const value = candidates.find((text) => text && text.length > 0) ?? ""
    return value.replace(/\s+/g, " ").slice(0, MAX_NAME_CHARS)
  }

  function extrasOf(element, role) {
    const parts = []
    if (role === "checkbox" || role === "radio" || role === "switch") parts.push(element.checked ? "checked" : "unchecked")
    if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "spinbutton") {
      if (element.value) parts.push(`value=${JSON.stringify(String(element.value).slice(0, MAX_NAME_CHARS))}`)
      if (element.disabled) parts.push("disabled")
      if (element.readOnly) parts.push("readonly")
    }
    if (element.tagName === "A" && element.href) parts.push(`href=${JSON.stringify(element.getAttribute("href").slice(0, 200))}`)
    if (element.tagName === "IMG" && element.src) parts.push(`src=${JSON.stringify(element.src.slice(0, 200))}`)
    if (role === "heading") parts.push(`level=${element.tagName.slice(1)}`)
    return parts.join(" ")
  }

  function isInteractive(element, role) {
    if (["button", "link", "textbox", "searchbox", "combobox", "listbox", "checkbox", "radio", "switch", "slider", "spinbutton", "option", "tab", "menuitem"].includes(role)) return true
    if (element.hasAttribute("contenteditable") && element.getAttribute("contenteditable") !== "false") return true
    if (element.hasAttribute("onclick")) return true
    if (element.tabIndex >= 0 && element.tagName !== "BODY") return true
    return false
  }

  function snapshot(input = {}) {
    resetRefs()
    const depthLimit = input.depth ?? 20
    const nodeLimit = input.maxNodes ?? 3000
    const includeHidden = input.includeHidden ?? false
    const lines = []
    let nodes = 0
    let truncated = false

    const visit = (element, depth) => {
      if (truncated || depth > depthLimit || nodes >= nodeLimit) {
        truncated = true
        return
      }
      if (!includeHidden && !isVisible(element)) return
      nodes++
      const role = roleOf(element)
      const name = nameOf(element, role)
      const interactive = isInteractive(element, role)
      const text = directText(element)
      const interesting = interactive || role !== "generic" || (text.length > 0 && childrenOf(element).length === 0)

      if (interesting) {
        const indent = "  ".repeat(depth)
        if (interactive) {
          const ref = refFor(element)
          const extras = extrasOf(element, role)
          lines.push(`${indent}- ${role}${name ? ` ${JSON.stringify(name)}` : ""} [ref=${ref}]${extras ? ` ${extras}` : ""}`)
        } else if (role !== "generic") {
          lines.push(`${indent}- ${role}${name ? ` ${JSON.stringify(name)}` : ""}`)
        } else if (text) {
          lines.push(`${indent}- text ${JSON.stringify(text.slice(0, MAX_NAME_CHARS))}`)
        }
      }

      for (const child of childrenOf(element)) visit(child, interactive ? depth + 1 : depth)
    }

    if (document.body) visit(document.body, 0)
    const content = lines.join("\n")
    return {
      content: content.length > MAX_SNAPSHOT_CHARS ? content.slice(0, MAX_SNAPSHOT_CHARS) : content,
      truncated: truncated || content.length > MAX_SNAPSHOT_CHARS,
      refs: refSequence,
      url: location.href,
      title: document.title,
    }
  }

  function find(input) {
    const result = snapshot({ includeHidden: input.includeHidden })
    const needle = String(input.text ?? "").toLowerCase()
    const content = result.content
      .split("\n")
      .filter((line) => line.toLowerCase().includes(needle))
      .join("\n")
    return { ...result, content, truncated: result.truncated }
  }

  function centerOf(element) {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect }
  }

  function mouse(element, type, point, options = {}) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: point.x,
        clientY: point.y,
        button: options.button === "right" ? 2 : options.button === "middle" ? 1 : 0,
        buttons: options.buttons ?? (type === "mousedown" || type === "pointerdown" ? 1 : 0),
        detail: options.count ?? 1,
        ctrlKey: options.modifiers?.includes("Control") ?? false,
        shiftKey: options.modifiers?.includes("Shift") ?? false,
        altKey: options.modifiers?.includes("Alt") ?? false,
        metaKey: options.modifiers?.includes("Meta") ?? false,
      }),
    )
  }

  function flash(element, label, color = "#6ea8ff") {
    ensureOverlay()
    const rect = element.getBoundingClientRect()
    const box = document.createElement("div")
    const shadow = box.attachShadow({ mode: "closed" })
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .box { position: fixed; border: 2px solid ${color}; border-radius: 6px; background: ${color}22;
               box-shadow: 0 0 0 3px ${color}33, 0 4px 18px #0003; transition: opacity .35s ease; }
        .label { position: fixed; font: 600 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                 color: #fff; background: ${color}; padding: 3px 7px; border-radius: 5px; max-width: 280px;
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dot { position: fixed; width: 12px; height: 12px; border-radius: 999px; background: #fff;
               border: 2px solid ${color}; box-shadow: 0 0 12px ${color}; transition: opacity .35s ease; }
        .fade { opacity: 0; }
      </style>
      <div class="box"></div>
      <div class="label"></div>
      <div class="dot"></div>`
    const boxEl = shadow.querySelector(".box")
    const labelEl = shadow.querySelector(".label")
    const dotEl = shadow.querySelector(".dot")
    const position = (node, left, top, width, height) => {
      node.style.left = `${left}px`
      node.style.top = `${top}px`
      node.style.width = `${width}px`
      node.style.height = `${height}px`
    }
    position(boxEl, rect.left - 2, rect.top - 2, rect.width + 4, rect.height + 4)
    position(dotEl, rect.left + rect.width / 2 - 6, rect.top + rect.height / 2 - 6, 12, 12)
    labelEl.textContent = label
    labelEl.style.left = `${Math.max(4, rect.left)}px`
    labelEl.style.top = `${Math.max(4, rect.top - 22)}px`
    overlay.host.appendChild(box)
    setTimeout(() => {
      boxEl.classList.add("fade")
      labelEl.classList.add("fade")
      dotEl.classList.add("fade")
      setTimeout(() => box.remove(), 400)
    }, 900)
  }

  function ensureOverlay() {
    if (overlay?.host.isConnected) return
    const host = document.createElement("div")
    host.id = "opencode-agent-overlay"
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;"
    const shadow = host.attachShadow({ mode: "closed" })
    shadow.innerHTML = `<style>:host{all:initial}*{box-sizing:border-box}</style>`
    document.documentElement.appendChild(host)
    overlay = { host, shadow }
  }

  function click(input) {
    const element = resolve(input.ref)
    const point = centerOf(element)
    flash(element, `OpenCode · click`, "#6ea8ff")
    for (let index = 0; index < (input.count ?? 1); index++) {
      mouse(element, "pointerdown", point, input)
      mouse(element, "mousedown", point, input)
      mouse(element, "pointerup", point, input)
      mouse(element, "mouseup", point, input)
      mouse(element, "click", point, input)
    }
    const target = element.closest("a[href],button,label,[role=button]") ?? element
    if (input.button === "right" || input.button === "middle" || (input.modifiers?.length ?? 0) > 0) return { ok: true }
    if (target !== element && target.tagName === "A" && target.href && !element.tagName.match(/^(INPUT|TEXTAREA|SELECT)$/)) return { ok: true }
    return { ok: true }
  }

  function hover(input) {
    const element = resolve(input.ref)
    const point = centerOf(element)
    flash(element, "OpenCode · hover", "#8b7cf6")
    mouse(element, "pointerover", point)
    mouse(element, "mouseover", point)
    mouse(element, "mousemove", point)
    return { ok: true }
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    if (setter) setter.call(element, value)
    else element.value = value
  }

  function fill(input) {
    const element = resolve(input.ref)
    element.focus()
    if (element.isContentEditable) {
      element.textContent = String(input.text)
    } else {
      setNativeValue(element, String(input.text))
    }
    flash(element, "OpenCode · fill", "#34d399")
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
    return { ok: true, value: element.value ?? element.textContent }
  }

  function select(input) {
    const element = resolve(input.ref)
    if (!(element instanceof HTMLSelectElement)) throw new Error(`Ref ${input.ref} is not a select element.`)
    const wanted = new Set(input.values.map(String))
    let matched = 0
    for (const option of element.options) {
      if (wanted.has(option.value) || wanted.has(option.text.trim())) {
        option.selected = true
        matched++
      } else if (!element.multiple) {
        option.selected = false
      }
    }
    if (matched === 0) throw new Error(`No option matched ${JSON.stringify(input.values)}.`)
    flash(element, `OpenCode · select ${input.values.join(", ")}`, "#34d399")
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
    return { ok: true, values: Array.from(element.selectedOptions).map((option) => option.value) }
  }

  function check(input) {
    const element = resolve(input.ref)
    if (element.checked === input.checked) return { ok: true, checked: element.checked }
    flash(element, `OpenCode · ${input.checked ? "check" : "uncheck"}`, "#fbbf24")
    element.click()
    if (element.checked !== input.checked) {
      element.checked = input.checked
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
      element.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
    }
    return { ok: true, checked: element.checked }
  }

  const keyAliases = {
    Enter: { key: "Enter", code: "Enter", keyCode: 13 },
    Tab: { key: "Tab", code: "Tab", keyCode: 9 },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    Delete: { key: "Delete", code: "Delete", keyCode: 46 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    Home: { key: "Home", code: "Home", keyCode: 36 },
    End: { key: "End", code: "End", keyCode: 35 },
    PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
    PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  }

  function press(input) {
    const parts = String(input.key).split("+")
    const name = parts.pop()
    const modifiers = new Set(parts)
    const key = keyAliases[name] ?? { key: name, code: name, keyCode: name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0 }
    const target = document.activeElement ?? document.body
    const init = {
      key: key.key,
      code: key.code,
      keyCode: key.keyCode,
      which: key.keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: modifiers.has("Control"),
      shiftKey: modifiers.has("Shift"),
      altKey: modifiers.has("Alt"),
      metaKey: modifiers.has("Meta"),
    }
    target.dispatchEvent(new KeyboardEvent("keydown", init))
    if (key.key.length === 1) target.dispatchEvent(new KeyboardEvent("keypress", init))
    target.dispatchEvent(new KeyboardEvent("keyup", init))
    flash(target, `OpenCode · press ${input.key}`, "#8b7cf6")
    return { ok: true }
  }

  function scroll(input) {
    const element = input.ref ? resolve(input.ref) : undefined
    const target = element ?? window
    target.scrollBy({ left: input.deltaX ?? 0, top: input.deltaY ?? 0, behavior: "instant" })
    return { ok: true, scrollX: window.scrollX, scrollY: window.scrollY }
  }

  function wait(input) {
    const timeout = Math.min(input.timeoutMs ?? 10_000, 30_000)
    const started = Date.now()
    return new Promise((resolvePromise, reject) => {
      const checkCondition = () => {
        const text = document.body?.innerText ?? ""
        const found = input.text ? text.toLowerCase().includes(String(input.text).toLowerCase()) : false
        const done =
          input.condition === "load"
            ? document.readyState === "complete"
            : input.condition === "text"
              ? found
              : input.condition === "textGone"
                ? !found
                : false
        if (done) return resolvePromise({ ok: true, waitedMs: Date.now() - started })
        if (Date.now() - started >= timeout)
          return reject(new Error(`Timed out after ${timeout}ms waiting for ${input.condition}${input.text ? ` ${JSON.stringify(input.text)}` : ""}.`))
        setTimeout(checkCondition, 100)
      }
      checkCondition()
    })
  }

  function evaluate(input) {
    const serialized = (value) => {
      if (value === undefined) return null
      try {
        return JSON.parse(JSON.stringify(value))
      } catch {
        return String(value)
      }
    }
    if (input.ref) {
      const element = resolve(input.ref)
      const result = new Function("element", `return (${input.script})(element)`)(element)
      return serialized(result)
    }
    const result = new Function(`return (${input.script})`)()
    return serialized(result)
  }

  function upload(input) {
    const element = resolve(input.ref)
    if (!(element instanceof HTMLInputElement) || element.type !== "file") throw new Error(`Ref ${input.ref} is not a file input.`)
    const transfer = new DataTransfer()
    for (const file of input.files) {
      const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
      transfer.items.add(new File([bytes], file.name, { type: file.mime || "application/octet-stream" }))
    }
    element.files = transfer.files
    flash(element, `OpenCode · upload ${input.files.map((file) => file.name).join(", ")}`, "#f472b6")
    element.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
    element.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
    return { ok: true, count: transfer.files.length }
  }

  function rect(input) {
    const element = resolve(input.ref)
    const box = element.getBoundingClientRect()
    return {
      x: box.left,
      y: box.top,
      width: box.width,
      height: box.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    }
  }

  function highlight(input) {
    const element = resolve(input.ref)
    flash(element, input.text ? `OpenCode · ${input.text}` : "OpenCode", input.color ?? "#6ea8ff")
    return { ok: true }
  }

  const handlers = {
    ping: () => ({ ok: true, url: location.href }),
    snapshot,
    find,
    click,
    hover,
    fill,
    select,
    check,
    press,
    scroll,
    wait,
    evaluate,
    upload,
    rect,
    highlight,
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.__opencodeContent !== true) return undefined
    const handler = handlers[message.op]
    if (!handler) {
      sendResponse({ ok: false, error: `Unknown content operation ${message.op}.` })
      return undefined
    }
    Promise.resolve()
      .then(() => handler(message.input ?? {}))
      .then(
        (value) => sendResponse({ ok: true, value }),
        (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }),
      )
    return true
  })

  Object.defineProperty(window, "__opencodeContentAgent", { value: api, configurable: true })
})()
