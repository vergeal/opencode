import { prefersReducedMotion } from "@opencode/ui/motion"
import { followRow, mountOverlay, replicaRow } from "./overlay"

const WIDTH = 38
const HEIGHT = 28

const SVG_NS = "http://www.w3.org/2000/svg"

const FLIGHT_MS = 1500
// Fraction of the clock the letter rests on the sender before it leaves, and the fraction at which it lands.
const HOLD = 0.24
const ARRIVE = 0.9
const STEPS = 28

// A withdrawal drops the envelope into a bin at the lower-left corner: the bin pops up, the lid swings open, the
// letter flies in, the bin eats it and the lid closes. The route and the erasing stroke are grey; the bin keeps the
// warning colour so its opening lid reads as the thing doing the destroying.
const TRASH_IN_MS = 280

const TRASH_LID_MS = 260

const TRASH_DROP_MS = 760

const TRASH_DESTROY_MS = 460

const TRASH_OUT_MS = 320

const TRASH_IDLE_MS = 420

const TRASH_SETTLE_MS = 200

const LID_OPEN = -42

const SOLID = "var(--v2-text-text-base)"

const DANGER = "var(--v2-state-fg-danger)"

const SHADOW =
  "drop-shadow(0 8px 18px color-mix(in oklch, var(--v2-text-text-accent) 45%, transparent)) drop-shadow(0 2px 6px rgb(0 0 0 / 0.22))"

/**
 * `deliver` and `redirect` both record the sending session in the message metadata. The recipient is the session
 * the inbox event belongs to, so only the sender comes from here. Both ride the same envelope so the flight is
 * identical; the difference between them lives in the target's queue, not in the animation.
 */
export function deliveryFrom(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return

  const delivery = (metadata as Record<string, unknown>).delivery

  if (!delivery || typeof delivery !== "object") return

  const envelope = delivery as Record<string, unknown>

  if (envelope.kind !== "session.delivery" && envelope.kind !== "session.redirect") return undefined

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

  const source = replicaRow(server, from)
  const target = replicaRow(server, to)

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

  mountOverlay(svg, 9998)
  mountOverlay(letter, 9999)

  // Both endpoints can shift while the letter is in the air — a row inserted between them, the list settling. Shift
  // the whole route by how far the pair's midpoint moved, so the letter keeps flying between the rows themselves.
  const midpoint = () => {
    const a = source.getBoundingClientRect()
    const b = target.getBoundingClientRect()

    return {
      x: (a.left + a.width / 2 + b.left + b.width / 2) / 2,
      y: (a.top + a.height / 2 + b.top + b.height / 2) / 2,
    }
  }
  const origin = midpoint()
  const stop = followRow(() => {
    const now = midpoint()
    const dx = now.x - origin.x
    const dy = now.y - origin.y

    svg.style.transform = `translate(${dx}px, ${dy}px)`
    letter.style.left = `${dx}px`
    letter.style.top = `${dy}px`
  })

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
    stop()
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
    stop()
    letter.remove()
    svg.remove()
  })
}

/**
 * A withdrawal drops the envelope into a bin at the lower-left corner. The bin pops up once and stays while more
 * withdrawals are in flight, so several sessions undoing at the same time share one bin instead of stacking bins in
 * the corner. The bin opens its lid, each letter flies from its own row into the mouth, the bin grinds it away and a
 * red stroke erases it. The bin keeps the warning colour so its opening lid reads as the thing doing the destroying.
 *
 * `count` is the number of cancellations already aggregated for one sender and target; only the first of a burst
 * drops a letter, so a batch does not launch a fan of identical letters.
 */
export function playUndoDrop(server: string, target: string, fromID: string, count: number) {
  if (typeof document === "undefined" || prefersReducedMotion()) return

  const row = replicaRow(server, target)

  if (!row) return

  const rect = row.getBoundingClientRect()

  if (rect.width === 0) return

  if (count > 1) return

  void dropIntoTrash(rect)
}

type Trash = {
  readonly element: HTMLElement
  readonly lid: HTMLElement
  count: number
  readonly ready: Promise<void>
  idle?: ReturnType<typeof setTimeout>
  closing?: { readonly lid: Animation; fade?: Animation }
}

let trash: Trash | undefined

function acquireTrash(anchorY: number): Trash {
  if (trash) {
    if (trash.idle) {
      clearTimeout(trash.idle)
      trash.idle = undefined
    }

    // A withdrawal that lands while the bin is closing revives it: cancelling the close restores the lid's open
    // fill, so there is never a second bin beside the one still fading out.
    if (trash.closing) {
      trash.closing.lid.cancel()
      trash.closing.fade?.cancel()
      trash.closing = undefined
    }

    trash.count++
    return trash
  }

  const bin = createTrashBin(anchorY)

  mountOverlay(bin.element, 9999)

  const pop = bin.element.animate(
    [
      { transform: "translateY(18px) scale(.7)", opacity: 0 },
      { transform: "translateY(0) scale(1)", opacity: 1 },
    ],
    { duration: TRASH_IN_MS, easing: "cubic-bezier(.2,.9,.2,1)", fill: "both" },
  )

  // The lid opens as soon as the bin lands, so a letter never reaches a closed mouth.
  const open = bin.lid.animate([{ transform: "rotate(0deg)" }, { transform: `rotate(${LID_OPEN}deg)` }], {
    duration: TRASH_LID_MS,
    delay: TRASH_IN_MS,
    easing: "cubic-bezier(.3,1.4,.6,1)",
    fill: "both",
  })

  trash = {
    element: bin.element,
    lid: bin.lid,
    count: 1,
    ready: Promise.all([pop.finished, open.finished]).then(
      () => {},
      () => {},
    ),
  }

  return trash
}

function releaseTrash() {
  if (!trash) return

  trash.count--

  if (trash.count > 0) return

  const current = trash

  if (current.idle) clearTimeout(current.idle)

  // Withdrawals arrive in bursts. Hold the bin for a beat after it settles so the next one reuses it, instead of a
  // new bin popping up beside the one that is only just closing.
  current.idle = setTimeout(() => {
    current.idle = undefined

    if (trash !== current || current.count > 0) return

    closeTrash(current)
  }, TRASH_IDLE_MS)
}

/** The lid closes before the bin leaves, so a finished withdrawal looks shut rather than abandoned. */
function closeTrash(current: Trash) {
  const lidClose = current.lid.animate(
    [{ transform: `rotate(${LID_OPEN}deg)` }, { transform: "rotate(0deg)" }],
    { duration: TRASH_LID_MS, easing: "cubic-bezier(.3,1.2,.5,1)", fill: "both" },
  )

  current.closing = { lid: lidClose }

  void lidClose.finished.then(
    () => {
      if (!current.closing) return

      const fade = current.element.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: TRASH_OUT_MS,
        fill: "both",
      })

      current.closing = { lid: lidClose, fade }

      return fade.finished.then(() => {
        if (!current.closing) return

        if (trash === current) trash = undefined

        current.element.remove()
      })
    },
    () => {},
  )
}

async function dropIntoTrash(rect: DOMRect) {
  const bin = acquireTrash(rect.top + rect.height / 2)

  // The letter holds until the bin is up and open, so the sequence reads as bin, lid, letter rather than all at once.
  await bin.ready

  const binRect = bin.element.getBoundingClientRect()
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  const end = { x: binRect.left + binRect.width / 2, y: binRect.top + 6 }

  // Bow the route up and to the right so the letter leaves the list and falls into the bin from above. The hop
  // rises well above both ends so the flight still reads when the row sits near the bottom of the window.
  const dist = Math.hypot(end.x - start.x, end.y - start.y)
  const bend = Math.min(200, Math.max(90, dist * 0.3))
  const controlX = (start.x + end.x) / 2 + bend
  const controlY = Math.min(start.y, end.y) - Math.min(150, Math.max(80, dist * 0.5))
  const route = curve(start.x, start.y, controlX, controlY, end.x, end.y)

  const { letter, body } = createLetter()
  const { svg, path } = createTrail(
    `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`,
    DANGER,
  )

  mountOverlay(svg, 9998)
  mountOverlay(letter, 9999)

  const translate = (x: number, y: number) => `translate(${x - WIDTH / 2}px, ${y - HEIGHT / 2}px)`
  const steps = 18

  // The letter lands intact instead of shrinking into nothing: the destroy step has to be visible on its own.
  const flight = letter.animate(
    [
      { transform: translate(start.x, start.y), offset: 0 },
      { transform: translate(start.x, start.y), offset: 0.08 },
      ...Array.from({ length: steps }, (_, index) => {
        const point = route((index + 1) / steps)

        return { transform: translate(point.x, point.y), offset: 0.08 + ((index + 1) / steps) * 0.92 }
      }),
    ],
    { duration: TRASH_DROP_MS, easing: "linear", fill: "both" },
  )

  body.animate(
    [
      { transform: "scale(.4)", opacity: 0 },
      { transform: "scale(1)", opacity: 1, offset: 0.15 },
    ],
    { duration: TRASH_DROP_MS, easing: "ease-out", fill: "both" },
  )

  const length = path.getTotalLength()

  path.style.strokeDasharray = `${length}`
  path.animate(
    [
      { strokeDashoffset: `${length}`, opacity: 0.2, offset: 0 },
      { strokeDashoffset: `${length}`, opacity: 0.55, offset: 0.08 },
      ...Array.from({ length: steps }, (_, index) => ({
        strokeDashoffset: `${length * (1 - easeInOut((index + 1) / steps))}`,
        opacity: 0.55,
        offset: 0.08 + ((index + 1) / steps) * 0.92,
      })),
    ],
    { duration: TRASH_DROP_MS, easing: "linear", fill: "both" },
  )

  // Hold the trail a beat after the letter lands so the route stays legible, then fade it.
  const dissolve = () => {
    void svg
      .animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], {
        duration: TRASH_DESTROY_MS,
        fill: "both",
      })
      .finished.finally(() => svg.remove())
  }

  void flight.finished.then(
    () => {
      dissolve()
      swallow(bin.element)
      void destroy(letter, end).then(() => releaseTrash())
    },
    () => {
      letter.remove()
      svg.remove()
      releaseTrash()
    },
  )
}

/** The letter is ground away at the mouth: it shrinks, tips over and thins out as the bin takes it. */
function destroy(letter: HTMLElement, at: { x: number; y: number }) {
  const place = (dy: number) => `translate(${at.x - WIDTH / 2}px, ${at.y - HEIGHT / 2 + dy}px)`

  return letter
    .animate(
      [
        { transform: `${place(0)} scale(1) rotate(0deg)`, opacity: 1 },
        { transform: `${place(2)} scale(.86) rotate(-8deg)`, opacity: 0.9, offset: 0.45 },
        { transform: `${place(6)} scale(.28) rotate(-26deg)`, opacity: 0, offset: 1 },
      ],
      { duration: TRASH_DESTROY_MS, easing: "cubic-bezier(.4,0,.7,.2)", fill: "both" },
    )
    .finished.then(
      () => letter.remove(),
      () => letter.remove(),
    )
}

/** A small sink-and-rebound as the bin takes the letter, so the drop reads as weight landing in it. */
function swallow(element: HTMLElement) {
  void element.animate(
    [
      { transform: "translateY(0)" },
      { transform: "translateY(3px)", offset: 0.4 },
      { transform: "translateY(0)" },
    ],
    { duration: TRASH_SETTLE_MS, easing: "ease-out" },
  ).finished
}

/**
 * A solid bin at the list's left edge. It tracks the row it serves instead of sitting in the window corner: on a
 * session near the bottom of the list a corner bin would land right on top of the row and the flight would be
 * invisible. `anchorY` is the row's vertical centre.
 */
function createTrashBin(anchorY: number) {
  const bin = document.createElement("div")

  bin.dataset.sessionUndoTrash = ""
  bin.setAttribute("aria-hidden", "true")

  const centre = Math.min(Math.max(anchorY, 96), window.innerHeight - 96)

  Object.assign(bin.style, {
    left: "16px",
    bottom: `${Math.round(window.innerHeight - centre - 19)}px`,
    width: "34px",
    height: "38px",
    filter: "drop-shadow(0 4px 10px rgb(0 0 0 / .28))",
    willChange: "transform, opacity",
  })

  // The body keeps the mouth line off: the lid owns it, so the mouth opens as one piece.
  const shell = document.createElement("div")
  Object.assign(shell.style, { position: "absolute", inset: "0" })
  shell.innerHTML = `<svg width="34" height="38" viewBox="0 0 34 38" fill="none"><path d="M5.5 14h23l-1.7 18.7a3 3 0 0 1-3 2.8H10.2a3 3 0 0 1-3-2.8L5.5 14Z" fill="${SOLID}"/><path d="M5.5 14h23l-.3 3.4H5.8L5.5 14Z" fill="rgb(0 0 0 / .22)"/></svg>`

  const lid = document.createElement("div")

  lid.dataset.sessionUndoTrashLid = ""
  Object.assign(lid.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "34px",
    height: "38px",
    transformOrigin: "2.5px 11px",
    willChange: "transform",
  })
  lid.innerHTML = `<svg width="34" height="38" viewBox="0 0 34 38" fill="none"><rect x="2.5" y="8.5" width="29" height="5" rx="2" fill="${SOLID}"/><rect x="12" y="4.5" width="10" height="4" rx="2" fill="${SOLID}"/></svg>`

  bin.append(shell, lid)

  return { element: bin, lid }
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

function createLetter() {
  const letter = document.createElement("div")
  letter.dataset.sessionDeliveryLetter = ""
  letter.setAttribute("aria-hidden", "true")
  Object.assign(letter.style, {
    left: "0",
    top: "0",
    width: `${WIDTH}px`,
    height: `${HEIGHT}px`,
    willChange: "transform",
  })

  const body = document.createElement("div")
  Object.assign(body.style, {
    width: "100%",
    height: "100%",
    willChange: "transform, opacity",
    filter: SHADOW,
  })
  body.innerHTML = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 38 28" fill="none"><rect x="1" y="1" width="36" height="26" rx="5" fill="var(--v2-background-bg-layer-02)" stroke="var(--v2-text-text-accent)" stroke-width="1.8"/><path d="M4 5.5 19 17 34 5.5" stroke="var(--v2-text-text-accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  letter.appendChild(body)

  return { letter, body }
}

function createTrail(d: string, color = "var(--v2-text-text-accent)") {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("width", String(window.innerWidth))
  svg.setAttribute("height", String(window.innerHeight))
  Object.assign(svg.style, {
    left: "0",
    top: "0",
    overflow: "visible",
  })

  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("d", d)
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", color)
  path.setAttribute("stroke-width", "1.5")
  path.setAttribute("stroke-linecap", "round")
  path.style.opacity = "0.5"

  svg.appendChild(path)

  return { svg, path }
}
