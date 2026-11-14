import { Option, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import { prefersReducedMotion } from "@opencode/ui/motion"
import { followRow, mountOverlay, replicaRow } from "./overlay"

const SVG_NS = "http://www.w3.org/2000/svg"

const DOT_SIZE = 4

const LINE_MS = 340

const HOLD_MS = 280

const OPEN_MS = 220

const FADE_MS = 420


// A long line would cut across the rows between the two ends, so cap the reach; every creation in a batch still
// draws its own line.
const MAX_DISTANCE = 520

const decodeCreatedBy = Schema.decodeUnknownOption(Schema.Struct({ sessionID: Session.ID }))

/** `session.create` records the creating session in metadata, so only sessions it made carry an origin. */
export function createdFrom(metadata: Session.Metadata | undefined) {
  return Option.getOrUndefined(Option.map(decodeCreatedBy(metadata?.createdBy), (createdBy) => createdBy.sessionID))
}

/** A creator missing from the local list still gets a short name instead of a full identifier. */
export function creatorName(title: string | undefined, id: string) {
  return title ?? id.slice(-8)
}

/**
 * A created session grows out of the row that made it: a dot marks the origin, a hairline reaches the place the new
 * row will occupy, and the row opens downward from where the line lands. There is no envelope, because nothing was
 * delivered; the line is the whole cause.
 *
 * Returns whether a line was drawn. The caller shows the source label either way; when this returns false the row is
 * left untouched, so the label can appear at once instead of waiting for an opening that will not happen.
 */
export function playBranchGrowth(server: string, fromID: string, toID: string) {
  if (typeof document === "undefined" || prefersReducedMotion()) return false

  const source = replicaRow(server, fromID)
  const target = replicaRow(server, toID)

  if (!source || !target) return false

  const fromRect = source.getBoundingClientRect()
  const toRect = target.getBoundingClientRect()

  if (fromRect.width === 0 || toRect.width === 0) return false

  // Sit a few pixels inside the row's trailing edge so a scrollbar or border cannot hide the line.
  const start = { x: fromRect.right - 10, y: fromRect.top + fromRect.height / 2 }
  // A collapsed row keeps its top edge, so aim there and let the row open downward from the line's end.
  const end = { x: toRect.right - 10, y: toRect.top + 1 }

  // Rows are much wider than they are tall, so the gap that matters is the vertical one: a horizontal
  // span is just the row's own width, and measuring it would always exceed the limit between any two rows.
  if (Math.abs(end.y - start.y) > MAX_DISTANCE) return false

  const height = target.offsetHeight

  if (height === 0) return false

  const dot = createDot(start)
  const { svg, path } = createLine(start, end)

  target.style.height = "0px"
  target.style.overflow = "clip"

  mountOverlay(dot, 9999)
  mountOverlay(svg, 9998)

  // Either endpoint can shift while the line grows — a row inserted above one of them. Re-aim the path every frame
  // so the line keeps joining the two rows instead of hanging where it was first measured.
  const aim = () => {
    const fromRect = source.getBoundingClientRect()
    const toRect = target.getBoundingClientRect()
    const from = { x: fromRect.right - 10, y: fromRect.top + fromRect.height / 2 }
    const to = { x: toRect.right - 10, y: toRect.top + 1 }
    const bend = Math.min(26, Math.max(10, Math.hypot(to.x - from.x, to.y - from.y) * 0.16))
    const controlX = (from.x + to.x) / 2 - bend
    const controlY = (from.y + to.y) / 2

    path.setAttribute("d", `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`)
    dot.style.left = `${from.x - DOT_SIZE / 2}px`
    dot.style.top = `${from.y - DOT_SIZE / 2}px`

    return path.getTotalLength()
  }

  const startedAt = performance.now()
  let length = aim()

  path.style.strokeDasharray = `${length}`
  path.style.strokeDashoffset = `${length}`

  const stop = followRow(() => {
    length = aim()

    const progress = Math.min(1, (performance.now() - startedAt) / LINE_MS)

    path.style.strokeDasharray = `${length}`
    path.style.strokeDashoffset = `${length * (1 - easeOut(progress))}`
  })

  const settle = () => {
    stop()
    dot.remove()
    svg.remove()
  }

  setTimeout(() => {
    openRow(target, height)

    // The line lands, then waits long enough to be read before it drains away with the dot.
    setTimeout(() => {
      const fading = [dot, svg].map((element) =>
        element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: "forwards" }),
      )

      void Promise.all(fading.map((animation) => animation.finished)).then(settle, settle)
    }, HOLD_MS)
  }, LINE_MS)

  return true
}

function openRow(element: HTMLElement, height: number) {
  // The timeline's own rows open with a 0.24s spring at zero bounce; this curve matches its settle without pulling
  // the sidebar into that frame loop.
  const opening = element.animate(
    [
      { height: "0px", opacity: 0 },
      { height: `${height}px`, opacity: 1 },
    ],
    { duration: OPEN_MS, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "forwards" },
  )

  const settle = () => {
    opening.cancel()
    element.style.height = ""
    element.style.overflow = ""
  }

  void opening.finished.then(settle, settle)
}

function createDot(point: { readonly x: number; readonly y: number }) {
  const dot = document.createElement("div")

  dot.dataset.sessionBranchDot = ""
  dot.setAttribute("aria-hidden", "true")
  Object.assign(dot.style, {
    left: `${point.x - DOT_SIZE / 2}px`,
    top: `${point.y - DOT_SIZE / 2}px`,
    width: `${DOT_SIZE}px`,
    height: `${DOT_SIZE}px`,
    borderRadius: "9999px",
    background: "var(--v2-text-text-accent)",
  })

  return dot
}

function createLine(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
) {
  const bend = Math.min(26, Math.max(10, Math.hypot(end.x - start.x, end.y - start.y) * 0.16))
  const controlX = (start.x + end.x) / 2 - bend
  const controlY = (start.y + end.y) / 2
  const svg = document.createElementNS(SVG_NS, "svg")

  svg.setAttribute("width", String(window.innerWidth))
  svg.setAttribute("height", String(window.innerHeight))
  Object.assign(svg.style, { left: "0", top: "0", overflow: "visible" })

  const path = document.createElementNS(SVG_NS, "path")

  path.setAttribute("d", `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`)
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", "var(--v2-text-text-accent)")
  path.setAttribute("stroke-width", "2")
  path.setAttribute("stroke-linecap", "round")
  svg.appendChild(path)

  return { svg, path }
}

function easeOut(u: number) {
  return 1 - (1 - u) ** 3
}
