import { prefersReducedMotion } from "@opencode/ui/motion"

const WIDTH = 38
const HEIGHT = 28

const SVG_NS = "http://www.w3.org/2000/svg"

const FLIGHT_MS = 1500
// Fraction of the clock the letter rests on the sender before it leaves, and the fraction at which it lands.
const HOLD = 0.24
const ARRIVE = 0.9
const STEPS = 28

/**
 * `deliver` records the sending session in the message metadata. The recipient is the session the inbox event
 * belongs to, so only the sender comes from here.
 */
export function deliveryFrom(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return

  const delivery = (metadata as Record<string, unknown>).delivery

  if (!delivery || typeof delivery !== "object") return

  const envelope = delivery as Record<string, unknown>

  if (envelope.kind !== "session.delivery") return undefined

  const from = envelope.from

  if (!from || typeof from !== "object") return undefined

  const sessionID = (from as Record<string, unknown>).sessionID

  return typeof sessionID === "string" ? sessionID : undefined
}

/**
 * Draws a letter along a curved route from the sender's row to the recipient's. A faint accent trail grows behind
 * it so the direction reads at a glance, then the recipient lights up. A row that is not on screen has nowhere to
 * launch from or land on, so the flight is skipped rather than guessed.
 */
export function playDeliveryFlight(server: string, from: string, to: string) {
  if (typeof document === "undefined" || prefersReducedMotion() || from === to) return

  const source = row(server, from)
  const target = row(server, to)

  if (!source || !target) return

  const fromRect = source.getBoundingClientRect()
  const toRect = target.getBoundingClientRect()

  if (fromRect.width === 0 || toRect.width === 0) return

  const startX = fromRect.left + fromRect.width / 2
  const startY = fromRect.top + fromRect.height / 2
  const endX = toRect.left + toRect.width / 2
  const endY = toRect.top + toRect.height / 2
  // Bow the route sideways so the letter arcs out of the list instead of sliding along the rows.
  const bend = Math.min(110, Math.max(40, Math.hypot(endX - startX, endY - startY) * 0.28))
  const controlX = (startX + endX) / 2 - bend
  const controlY = (startY + endY) / 2
  const route = curve(startX, startY, controlX, controlY, endX, endY)

  const { letter, body } = createLetter()
  const { svg, path } = createTrail(`M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`)

  document.body.appendChild(svg)
  document.body.appendChild(letter)

  highlight(source, 900)

  const translate = (x: number, y: number) => `translate(${x - WIDTH / 2}px, ${y - HEIGHT / 2}px)`
  const at = (u: number) => {
    const point = route(u)

    return { transform: translate(point.x, point.y), offset: HOLD + u * (ARRIVE - HOLD) }
  }

  const flight = letter.animate(
    [
      { transform: translate(startX, startY), offset: 0 },
      { transform: translate(startX, startY), offset: HOLD },
      ...Array.from({ length: STEPS }, (_, index) => at((index + 1) / STEPS)),
      { transform: translate(endX, endY), offset: 1 },
    ],
    { duration: FLIGHT_MS, easing: "linear" },
  )

  body.animate(
    [
      { transform: "scale(.3)", opacity: 0 },
      { transform: "scale(1)", opacity: 1, offset: 0.12 },
      { transform: "scale(1.12)", opacity: 1, offset: HOLD },
      { transform: "scale(1)", opacity: 1, offset: ARRIVE },
      { transform: "scale(.55)", opacity: 0, offset: 1 },
    ],
    { duration: FLIGHT_MS, easing: "cubic-bezier(.22, 1, .36, 1)" },
  )

  const length = path.getTotalLength()
  path.style.strokeDasharray = `${length}`
  path.animate(
    [
      { strokeDashoffset: `${length}`, opacity: 0.5, offset: 0 },
      { strokeDashoffset: `${length}`, opacity: 0.5, offset: HOLD },
      ...Array.from({ length: STEPS }, (_, index) => {
        const u = (index + 1) / STEPS

        return {
          strokeDashoffset: `${length * (1 - easeInOut(u))}`,
          opacity: 0.5,
          offset: HOLD + u * (ARRIVE - HOLD),
        }
      }),
      { strokeDashoffset: "0", opacity: 0, offset: 1 },
    ],
    { duration: FLIGHT_MS, easing: "linear" },
  )

  const finish = () => {
    letter.remove()
    svg.remove()
    highlight(target, 900)

    if (prefersReducedMotion() || !target.animate) return

    target.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.035)", offset: 0.35 },
        { transform: "scale(1)" },
      ],
      { duration: 520, easing: "cubic-bezier(.34, 1.36, .64, 1)" },
    )
  }

  void flight.finished.then(finish, () => {
    letter.remove()
    svg.remove()
  })
}

function easeInOut(u: number) {
  return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2
}

function curve(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) {
  return (u: number) => {
    const t = easeInOut(u)
    const inv = 1 - t

    return {
      x: inv * inv * x0 + 2 * inv * t * cx + t * t * x1,
      y: inv * inv * y0 + 2 * inv * t * cy + t * t * y1,
    }
  }
}

function highlight(row: HTMLElement, duration: number) {
  if (prefersReducedMotion() || !row.animate) return

  row.animate(
    [
      { boxShadow: "inset 0 0 0 0px var(--v2-text-text-accent)" },
      { boxShadow: "inset 0 0 0 2px var(--v2-text-text-accent)", offset: 0.3 },
      { boxShadow: "inset 0 0 0 0px var(--v2-text-text-accent)" },
    ],
    { duration, easing: "ease-out" },
  )
}

function row(server: string, sessionID: string) {
  return document.querySelector<HTMLElement>(
    `[data-slot="replica-row"][data-session-server="${CSS.escape(server)}"][data-session-id="${CSS.escape(sessionID)}"]`,
  )
}

function createLetter() {
  const letter = document.createElement("div")
  letter.dataset.sessionDeliveryLetter = ""
  letter.setAttribute("aria-hidden", "true")
  Object.assign(letter.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${WIDTH}px`,
    height: `${HEIGHT}px`,
    pointerEvents: "none",
    zIndex: "9999",
    willChange: "transform",
  })

  const body = document.createElement("div")
  Object.assign(body.style, {
    width: "100%",
    height: "100%",
    willChange: "transform, opacity",
    filter:
      "drop-shadow(0 8px 18px color-mix(in oklch, var(--v2-text-text-accent) 45%, transparent)) drop-shadow(0 2px 6px rgb(0 0 0 / 0.22))",
  })
  body.innerHTML = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 38 28" fill="none"><rect x="1" y="1" width="36" height="26" rx="5" fill="var(--v2-background-bg-layer-02)" stroke="var(--v2-text-text-accent)" stroke-width="1.8"/><path d="M4 5.5 19 17 34 5.5" stroke="var(--v2-text-text-accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  letter.appendChild(body)

  return { letter, body }
}

function createTrail(d: string) {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("width", String(window.innerWidth))
  svg.setAttribute("height", String(window.innerHeight))
  Object.assign(svg.style, {
    position: "fixed",
    left: "0",
    top: "0",
    pointerEvents: "none",
    zIndex: "9998",
    overflow: "visible",
  })

  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("d", d)
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", "var(--v2-text-text-accent)")
  path.setAttribute("stroke-width", "1.5")
  path.setAttribute("stroke-linecap", "round")
  path.style.opacity = "0.5"

  svg.appendChild(path)

  return { svg, path }
}
