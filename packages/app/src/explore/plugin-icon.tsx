import { createUniqueId } from "solid-js"

/**
 * The plugins mark: two rounded modules, one cyan-teal and one blue-indigo, snapped together by a
 * bright connector. The cool gradients keep it legible on both the light and dark layer-02 surface
 * that hosts the card and hero icons, and set it apart from the warm skills mark. Sized by its
 * container, or by `size`/`class` when a caller needs an explicit measurement.
 *
 * `monochrome` paints the same shape in `currentColor` for navigation rows that must not carry
 * color: the modules fade instead of changing hue and the connector stays the brightest part.
 */
export function PluginIcon(props: { size?: number | string; class?: string; monochrome?: boolean }) {
  const left = createUniqueId()
  const right = createUniqueId()
  const joint = createUniqueId()

  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size ?? "100%"}
      height={props.size ?? "100%"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={props.class}
    >
      <defs>
        <linearGradient id={left} x1="2.75" y1="4.5" x2="11" y2="17.5" gradientUnits="userSpaceOnUse">
          <stop stop-color="#22D3EE" />
          <stop offset="1" stop-color="#0891B2" />
        </linearGradient>
        <linearGradient id={right} x1="13" y1="6.5" x2="21.25" y2="19.5" gradientUnits="userSpaceOnUse">
          <stop stop-color="#60A5FA" />
          <stop offset="1" stop-color="#4F46E5" />
        </linearGradient>
        <linearGradient id={joint} x1="10" y1="10" x2="14" y2="14" gradientUnits="userSpaceOnUse">
          <stop stop-color="#A5F3FC" />
          <stop offset="1" stop-color="#38BDF8" />
        </linearGradient>
      </defs>
      <rect
        x="2.75"
        y="4.5"
        width="8.25"
        height="13"
        rx="2.75"
        fill={props.monochrome ? "currentColor" : `url(#${left})`}
        opacity={props.monochrome ? ".45" : undefined}
      />
      <rect
        x="13"
        y="6.5"
        width="8.25"
        height="13"
        rx="2.75"
        fill={props.monochrome ? "currentColor" : `url(#${right})`}
      />
      <rect
        x="10"
        y="10"
        width="4"
        height="4"
        rx="1.5"
        fill={props.monochrome ? "currentColor" : `url(#${joint})`}
        opacity={props.monochrome ? ".7" : undefined}
      />
    </svg>
  )
}
