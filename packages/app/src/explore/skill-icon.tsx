import { createUniqueId, Show } from "solid-js"

/**
 * The skills mark: two stacked rounded cards, the front one a purple gradient carrying a single
 * instruction bar, with an orange-to-yellow sparkle tucked into its lower corner. Fixed colors keep
 * it legible on both the light and dark layer-02 surface that hosts the card and hero icons.
 * Sized by its container, or by `size`/`class` when a caller needs an explicit measurement.
 *
 * `monochrome` paints the same shape in `currentColor` for navigation rows that must not carry
 * color: the layers fade instead of changing hue and the instruction bar is cut out of the card.
 */
export function SkillIcon(props: { size?: number | string; class?: string; monochrome?: boolean }) {
  const back = createUniqueId()
  const front = createUniqueId()
  const sparkle = createUniqueId()
  const cutout = createUniqueId()

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
        <linearGradient id={back} x1="7" y1="3.75" x2="19.5" y2="17.75" gradientUnits="userSpaceOnUse">
          <stop stop-color="#D8B4FE" />
          <stop offset="1" stop-color="#B98AF6" />
        </linearGradient>
        <linearGradient id={front} x1="4.5" y1="6.25" x2="17" y2="20.25" gradientUnits="userSpaceOnUse">
          <stop stop-color="#A855F7" />
          <stop offset="1" stop-color="#7C3AED" />
        </linearGradient>
        <linearGradient id={sparkle} x1="11.3" y1="19" x2="16.3" y2="14" gradientUnits="userSpaceOnUse">
          <stop stop-color="#F97316" />
          <stop offset="1" stop-color="#FACC15" />
        </linearGradient>
        <mask id={cutout} maskUnits="userSpaceOnUse" x="4.5" y="6.25" width="12.5" height="14">
          <rect x="4.5" y="6.25" width="12.5" height="14" rx="3" fill="#fff" />
          <rect x="7.4" y="9.4" width="6.9" height="2.4" rx="1.2" fill="#000" />
        </mask>
      </defs>
      <rect
        x="7"
        y="3.75"
        width="12.5"
        height="14"
        rx="3"
        fill={props.monochrome ? "currentColor" : `url(#${back})`}
        opacity={props.monochrome ? ".35" : undefined}
      />
      <rect
        x="4.5"
        y="6.25"
        width="12.5"
        height="14"
        rx="3"
        fill={props.monochrome ? "currentColor" : `url(#${front})`}
        mask={props.monochrome ? `url(#${cutout})` : undefined}
      />
      <Show when={!props.monochrome}>
        <rect x="7.4" y="9.4" width="6.9" height="2.4" rx="1.2" fill="#F6EDFF" opacity=".9" />
      </Show>
      <path
        d="M13.8 13.9c.28 1.68.92 2.32 2.6 2.6-1.68.28-2.32.92-2.6 2.6-.28-1.68-.92-2.32-2.6-2.6 1.68-.28 2.32-.92 2.6-2.6Z"
        fill={props.monochrome ? "currentColor" : `url(#${sparkle})`}
        opacity={props.monochrome ? ".6" : undefined}
      />
    </svg>
  )
}
