import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import type { ComposerSelectControl } from "./interaction"
import "./variant-slider.css"

/**
 * A volume-style slider: a thin rail, a filled span and a round handle that follows the pointer.
 * The effort levels are discrete, so the handle snaps to the nearest level while dragging and
 * lands on it when released.
 */
export function ComposerVariantSlider(props: {
  control: ComposerSelectControl
  title?: string
  label?: string
  keybind?: string[]
}) {
  const [state, setState] = createStore<{ dragging: boolean; pointer: number | null }>({
    dragging: false,
    pointer: null,
  })
  let track: HTMLDivElement | undefined
  let rail: HTMLDivElement | undefined

  const options = () => props.control.options()
  const last = () => Math.max(0, options().length - 1)
  const index = () =>
    Math.max(
      0,
      options().findIndex((option) => option.id === props.control.current()),
    )
  const position = () => (last() === 0 ? 0 : (index() / last()) * 100)
  const activePosition = () => state.pointer ?? position()

  const ratioAt = (clientX: number) => {
    if (!rail) return 0
    const rect = rail.getBoundingClientRect()
    if (rect.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const commit = (ratio: number) => {
    const option = options()[Math.round(ratio * last())]
    if (option && option.id !== props.control.current()) props.control.onSelect(option.id)
  }

  const move = (step: number) => {
    const next = Math.min(last(), Math.max(0, index() + step))
    const option = options()[next]
    if (next !== index() && option) props.control.onSelect(option.id)
  }

  const slider = () => (
    <div
      ref={track}
      data-slot="composer-variant-slider"
      role="slider"
      tabIndex={0}
      aria-label={props.label ?? props.title}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={last()}
      aria-valuenow={index()}
      aria-valuetext={options()[index()]?.label}
      class="relative flex h-6 w-full touch-none select-none items-center rounded-full px-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
      onPointerDown={(event: PointerEvent) => {
        if (event.button !== 0) return
        setState({ dragging: true, pointer: ratioAt(event.clientX) * 100 })
        track?.setPointerCapture(event.pointerId)
        track?.focus()
        commit(ratioAt(event.clientX))
      }}
      onPointerMove={(event: PointerEvent) => {
        if (!state.dragging) return
        const ratio = ratioAt(event.clientX)
        setState("pointer", ratio * 100)
        commit(ratio)
      }}
      onPointerUp={(event: PointerEvent) => {
        setState({ dragging: false, pointer: null })
        if (track?.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => setState({ dragging: false, pointer: null })}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") move(1)
        else if (event.key === "ArrowLeft" || event.key === "ArrowDown") move(-1)
        else if (event.key === "Home" && index() !== 0) props.control.onSelect(options()[0].id)
        else if (event.key === "End" && index() !== last()) props.control.onSelect(options()[last()].id)
        else return
        event.preventDefault()
      }}
    >
      <div ref={rail} data-slot="composer-variant-rail" class="relative h-1.5 w-full rounded-full">
        <span
          aria-hidden="true"
          data-slot="composer-variant-fill"
          class="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${activePosition()}%` }}
        />
        <span
          aria-hidden="true"
          data-slot="composer-variant-thumb"
          class="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          classList={{ "transition-[left] duration-200 ease-out": !state.dragging }}
          style={{ left: `${activePosition()}%` }}
        />
      </div>
    </div>
  )

  return (
    <Show when={props.title} fallback={slider()}>
      <Tooltip
        placement="top"
        value={
          <>
            {props.title}
            <Keybind keys={props.keybind ?? []} variant="neutral" />
          </>
        }
      >
        {slider()}
      </Tooltip>
    </Show>
  )
}
