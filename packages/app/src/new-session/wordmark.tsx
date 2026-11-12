import "./wordmark-logo.css"

export type LodgerBall = {
  radius: () => number
  at: () => { x: number; y: number }
  place: (
    x: number,
    y: number,
    pose: { look: number; lookAngle: number; stretch: number; angle: number; squint: number; curl: number },
  ) => void
  blink: () => void
  /** Uncurls and hops back to its perch beside the pin board. */
  done: () => void
}

/**
 * Reserves the wordmark's space and shows the product logo. The pointer and sound handlers stay in the
 * signature so callers keep working while the logo itself is inert.
 */
export function NewSessionWordmark(props: {
  ref: (element: HTMLDivElement) => void
  pins?: boolean
  sound?: () => boolean
  onOpen?: () => void
  onClose?: () => void
  onFlat?: () => void
  onPlay?: (ball: LodgerBall) => void
}) {
  return (
    <div data-component="new-session-wordmark" aria-hidden="true" class="pointer-events-none mx-auto w-full max-w-[660px]">
      <div ref={(element) => props.ref(element)} data-slot="wordmark-box" class="relative mx-auto w-4/5">
        <img
          src="/assets/changhong.svg"
          alt=""
          draggable={false}
          data-slot="wordmark-logo"
          class="h-auto w-full select-none"
        />
      </div>
    </div>
  )
}
