import { For, Show, createEffect, createMemo, createResource, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { isMonospace, loadFontOptions, quoteFamily, type FontOption } from "@/runtime/platform/fonts"
import "./font-picker.css"

let pickers = 0

/**
 * Both Chromium and WebKit resolve `system-ui` to the platform's own UI face (SF Pro on macOS), which is
 * what "system font" means here. It is a keyword, not a family the system enumeration lists, so the picker
 * adds it as a fixed row instead of looking it up.
 */
const SYSTEM_FAMILY = "system-ui"

type PickerOption = FontOption & { label?: string }

/** A searchable list of font families: the trigger shows the current face and the panel previews each option. */
export const FontPicker: Component<{
  action: string
  label: string
  value: string
  family: string
  placeholder: string
  /** Code rows list monospace faces before the rest while still offering every family. */
  monospaceFirst?: boolean
  onSelect: (family: string) => void
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({
    open: false,
    /** Counts opens so closing the panel keeps the last list instead of fetching an empty one. */
    opens: 0,
    query: "",
    active: 0,
    top: undefined as number | undefined,
    bottom: undefined as number | undefined,
    left: 0,
    width: 0,
    maxHeight: 320,
  })
  // Loading starts when the panel opens, which is also a user gesture: Chromium rejects the local font
  // list until then. The startup preload usually has the answer cached already.
  const [fonts] = createResource(
    () => state.opens,
    (opens) => (opens ? loadFontOptions(platform) : []),
  )
  const listID = `font-picker-${++pickers}`
  let trigger: HTMLButtonElement | undefined
  let panel: HTMLDivElement | undefined
  let list: HTMLDivElement | undefined
  let search: HTMLInputElement | undefined

  const currentFamily = () => props.value.trim() || props.placeholder
  const currentLabel = () =>
    currentFamily() === SYSTEM_FAMILY ? language.t("settings.appearance.font.system") : currentFamily()

  // Reading a resource suspends until it resolves, so the picker keeps rendering the current value meanwhile.
  const loaded = () => (fonts.state === "ready" || fonts.state === "refreshing" ? (fonts() ?? []) : [])

  const available = createMemo<PickerOption[]>(() => {
    const known = loaded()
    const family = currentFamily()
    const stored: PickerOption[] = known.some((option) => option.family === family)
      ? [...known]
      : [{ family, monospace: isMonospace(family) }, ...known]
    const system: PickerOption = {
      family: SYSTEM_FAMILY,
      monospace: false,
      label: language.t("settings.appearance.font.system"),
    }
    const options: PickerOption[] = [system, ...stored.filter((option) => option.family !== SYSTEM_FAMILY)]

    if (!props.monospaceFirst) return options

    return [system, ...options.slice(1).filter((option) => option.monospace), ...options.slice(1).filter((option) => !option.monospace)]
  })

  const options = createMemo(() => {
    const term = state.query.trim().toLowerCase()

    if (!term) return available()

    return available().filter((option) =>
      `${option.label ?? ""} ${option.family}`.toLowerCase().includes(term),
    )
  })

  const place = () => {
    if (!trigger) return

    const box = trigger.getBoundingClientRect()
    const margin = 8
    const width = Math.min(box.width, window.innerWidth - margin * 2)
    const left = Math.max(margin, Math.min(box.left, window.innerWidth - width - margin))
    const below = window.innerHeight - box.bottom - margin
    const above = box.top - margin

    if (below < 180 && above > below) {
      setState({
        top: undefined,
        bottom: window.innerHeight - box.top + 6,
        left,
        width,
        maxHeight: Math.min(320, above),
      })
      return
    }

    setState({
      top: box.bottom + 6,
      bottom: undefined,
      left,
      width,
      maxHeight: Math.min(320, below),
    })
  }

  const openPanel = () => {
    const family = currentFamily()
    const index = available().findIndex((option) => option.family === family)
    setState({
      opens: state.opens + 1,
      query: "",
      active: index === -1 ? 0 : index,
      open: true,
    })
  }

  const close = (focus = true) => {
    setState({ open: false, query: "" })
    if (focus) trigger?.focus()
  }

  const choose = (option: FontOption) => {
    props.onSelect(option.family)
    close()
  }

  // The startup preload usually resolves before the panel opens. When it does not, the list fills in
  // afterwards and the keyboard cursor should still begin on the current family.
  createEffect(() => {
    if (!state.open || state.query) return

    const index = available().findIndex((option) => option.family === currentFamily())

    if (index !== -1) setState("active", index)
  })

  createEffect(() => {
    if (!state.open) return

    const index = state.active
    // A system can list hundreds of families, so arrow keys must keep the cursor inside the viewport.
    queueMicrotask(() => {
      if (state.active !== index) return

      const option = list?.querySelector<HTMLElement>('[data-slot="font-picker-option"][data-active]')
      if (!option || !list) return

      const row = option.getBoundingClientRect()
      const viewport = list.getBoundingClientRect()

      if (row.top < viewport.top) list.scrollTop -= viewport.top - row.top
      else if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom
    })
  })

  createEffect(() => {
    if (!state.open) return

    place()
    const reposition = () => place()
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    queueMicrotask(() => search?.focus())
    const dismiss = (event: PointerEvent) => {
      const target = event.target

      if (!(target instanceof Node) || trigger?.contains(target) || panel?.contains(target)) return
      close(false)
    }
    document.addEventListener("pointerdown", dismiss, true)

    return () => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
      document.removeEventListener("pointerdown", dismiss, true)
    }
  })

  const keydown = (event: KeyboardEvent) => {
    const items = options()

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setState("active", (index) => (items.length ? (index + 1) % items.length : 0))
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setState("active", (index) => (items.length ? (index - 1 + items.length) % items.length : 0))
      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      setState("active", 0)
      return
    }

    if (event.key === "End") {
      event.preventDefault()
      setState("active", Math.max(0, items.length - 1))
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      const option = items[state.active]
      if (option) choose(option)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      close()
      return
    }

    if (event.key === "Tab") close(false)
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        data-component="font-picker"
        data-action={props.action}
        data-expanded={state.open ? "" : undefined}
        aria-haspopup="listbox"
        aria-expanded={state.open}
        aria-label={props.label}
        onClick={() => (state.open ? close() : openPanel())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          openPanel()
        }}
      >
        <span data-slot="font-picker-value" style={{ "font-family": props.family }}>
          {currentLabel()}
        </span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M11 9.5L8 6.5L5 9.5"
            stroke="currentColor"
            stroke-width="1"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <Show when={state.open}>
        <Portal>
          <div
            ref={panel}
            data-slot="font-picker-panel"
            style={{
              top: state.top === undefined ? undefined : `${state.top}px`,
              bottom: state.bottom === undefined ? undefined : `${state.bottom}px`,
              left: `${state.left}px`,
              width: `${state.width}px`,
              "max-height": `${state.maxHeight}px`,
            }}
          >
            <input
              ref={search}
              data-slot="font-picker-search"
              role="combobox"
              aria-label={props.label}
              aria-expanded="true"
              aria-controls={listID}
              aria-activedescendant={options()[state.active] ? `${listID}-${state.active}` : undefined}
              aria-autocomplete="list"
              value={state.query}
              placeholder={language.t("common.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              onInput={(event) => setState({ query: event.currentTarget.value, active: 0 })}
              onKeyDown={keydown}
            />

            <div ref={list} data-slot="font-picker-list" id={listID} role="listbox" aria-label={props.label}>
              <For each={options()}>
                {(option, index) => (
                  <div
                    id={`${listID}-${index()}`}
                    role="option"
                    aria-selected={option.family === currentFamily()}
                    data-slot="font-picker-option"
                    data-active={state.active === index() ? "" : undefined}
                    data-current={option.family === currentFamily() ? "" : undefined}
                    data-monospace={option.monospace ? "" : undefined}
                    style={{ "font-family": quoteFamily(option.family) }}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      choose(option)
                    }}
                    onPointerEnter={() => setState("active", index())}
                  >
                    <span data-slot="font-picker-option-name">{option.label ?? option.family}</span>
                    <Show when={option.monospace}>
                      <span data-slot="font-picker-badge">{language.t("settings.appearance.font.monospace")}</span>
                    </Show>
                    <Show when={option.family === currentFamily()}>
                      <svg
                        data-slot="font-picker-check"
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M3.53564 8.17857L6.39279 11.75L12.4642 4.25"
                          stroke="currentColor"
                          stroke-width="1"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={options().length === 0}>
                <div data-slot="font-picker-empty">{language.t("palette.empty")}</div>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  )
}
