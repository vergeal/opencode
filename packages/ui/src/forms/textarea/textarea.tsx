import { type ComponentProps, createEffect, onCleanup, onMount, splitProps } from "solid-js"
import "./textarea.css"

/** Leaves room for roughly a dozen lines before the field starts scrolling instead of growing. */
const DEFAULT_AUTO_RESIZE_MAX = 320

export interface TextareaProps extends ComponentProps<"textarea"> {
  /** Error styling for the field and value text. */
  invalid?: boolean
  surface?: "base" | "layer-1"
  /** Grow the field to fit its content up to `autoResizeMax` pixels, then scroll. */
  autoResize?: boolean
  /** Pixel ceiling for `autoResize`. Defaults to 320. */
  autoResizeMax?: number
}

export function Textarea(props: TextareaProps) {
  const [local, textareaProps] = splitProps(props, [
    "class",
    "classList",
    "invalid",
    "disabled",
    "rows",
    "surface",
    "autoResize",
    "autoResizeMax",
  ])

  let element: HTMLTextAreaElement | undefined
  let frame: number | undefined
  let measuredWidth = 0

  // A hidden textarea reports zero height, so only measure while it has layout.
  const resize = () => {
    if (!local.autoResize || !element) return

    const max = local.autoResizeMax ?? DEFAULT_AUTO_RESIZE_MAX

    element.style.height = "auto"

    if (element.scrollHeight === 0) return

    element.style.height = `${Math.min(element.scrollHeight, max)}px`
    element.style.overflowY = element.scrollHeight > max ? "auto" : "hidden"
  }

  // A ref runs before its element is in the document, and a fresh field can also report no height until it has layout
  // or until its font loads, so measure again on the next frame instead of keeping the `rows` height.
  const schedule = () => {
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined
      resize()
    })
  }

  // Follow controlled value changes as well as typing, so a saved prompt keeps the right height.
  createEffect(() => {
    void textareaProps.value
    resize()
  })

  onMount(() => {
    schedule()

    if (typeof document !== "undefined" && document.fonts) void document.fonts.ready.then(schedule)

    if (!("ResizeObserver" in globalThis) || !element) return

    // Only a width change reflows the text. Our own height writes fire this observer too, and measuring on those would
    // feed the height back into itself.
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0

      if (width === measuredWidth) return

      measuredWidth = width
      resize()
    })

    observer.observe(element)
    onCleanup(() => observer.disconnect())
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  return (
    <div
      data-component="textarea-v2"
      data-surface={local.surface ?? "base"}
      data-disabled={local.disabled ? "" : undefined}
      data-invalid={local.invalid ? "" : undefined}
      data-auto-resize={local.autoResize ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onInput={resize}
    >
      <textarea
        {...textareaProps}
        ref={(node) => {
          element = node
          resize()
          schedule()
        }}
        rows={local.rows ?? 3}
        disabled={local.disabled}
        aria-invalid={local.invalid ? true : undefined}
        data-slot="textarea-v2-textarea"
      />
    </div>
  )
}
