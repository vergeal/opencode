import { splitProps, type ComponentProps, type JSX } from "solid-js"
import { syncSpinPhase } from "../hooks/spin-phase"

// Every AI activity spinner (busy session tabs, the activity chip, subagents, tool cards) shows this thin ring.
// Non-AI loading uses Loader.

/**
 * A 16-unit viewBox keeps the ring crisp at every size. The track sits under a quarter arc that the compositor
 * rotates, so a spinner only transforms and never restyles or repaints.
 * `width` and `height` size it like an SVG's attributes, below any CSS size.
 */
export function Spinner(
  props: Omit<ComponentProps<"span">, "style"> & {
    "data-component"?: string
    width?: number
    height?: number
    style?: JSX.CSSProperties
  },
) {
  const [local, rest] = splitProps(props, ["class", "classList", "data-component", "width", "height", "style"])

  return (
    <span
      {...rest}
      ref={syncSpinPhase}
      data-component={local["data-component"] ?? "spinner"}
      data-slot="spinner-dots"
      classList={{ ...local.classList, [local.class ?? ""]: !!local.class }}
      style={{
        ...local.style,
        "--spinner-width": local.width === undefined ? undefined : `${local.width}px`,
        "--spinner-height": local.height === undefined ? undefined : `${local.height}px`,
      }}
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" opacity="0.18" />
        <circle
          cx="8"
          cy="8"
          r="6"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-dasharray="10 27.7"
        />
      </svg>
    </span>
  )
}
