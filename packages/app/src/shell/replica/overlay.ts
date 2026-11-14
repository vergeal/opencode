/**
 * Plumbing shared by the sidebar's row-to-row visual cues. Every cue paints into a fixed layer over the sidebar, so
 * they share the row selector and the stacking rules instead of carrying a copy each.
 */

export const OVERLAY_LABEL_HEIGHT = 20

/** Fixed, non-interactive layer over the sidebar. Callers own the position, size and content. */
export function mountOverlay(element: HTMLElement | SVGElement, zIndex: number) {
  Object.assign(element.style, { position: "fixed", pointerEvents: "none", zIndex: String(zIndex) })
  document.body.appendChild(element)
}

let frame = 0

const followers = new Set<() => void>()

function pump() {
  for (const follow of followers) follow()

  frame = followers.size > 0 ? requestAnimationFrame(pump) : 0
}

/**
 * Overlays keep viewport coordinates from the moment they mount. A row that moves afterwards — a new row inserted
 * above it, the list reordering — would leave the cue behind, so callers register an update that re-reads the row
 * while the cue is alive. Returns the unregister function to call when the cue finishes.
 */
export function followRow(update: () => void) {
  followers.add(update)

  if (frame === 0) frame = requestAnimationFrame(pump)

  return () => {
    followers.delete(update)

    if (followers.size === 0 && frame !== 0) {
      cancelAnimationFrame(frame)
      frame = 0
    }
  }
}

/** A small pill at a row's trailing edge. Callers set its text; it never takes layout space. */
export function createOverlayLabel() {
  const element = document.createElement("div")
  element.setAttribute("aria-hidden", "true")
  Object.assign(element.style, {
    display: "flex",
    height: `${OVERLAY_LABEL_HEIGHT}px`,
    alignItems: "center",
    maxWidth: "220px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: "0 6px",
    borderRadius: "6px",
    border: "1px solid var(--color-divider)",
    background: "var(--v2-background-bg-layer-02)",
    color: "var(--color-text-secondary)",
    fontSize: "13px",
    lineHeight: "var(--line-height-compact)",
  })

  return element
}

/** Sits the label against the row's trailing edge, flipped for right-to-left layouts. */
export function placeTrailingLabel(element: HTMLElement, rect: DOMRect) {
  const rtl = getComputedStyle(element).direction === "rtl"

  element.style.top = `${rect.top + (rect.height - OVERLAY_LABEL_HEIGHT) / 2}px`
  element.style.left = rtl ? `${rect.left + 8}px` : ""
  element.style.right = rtl ? "" : `${window.innerWidth - rect.right + 8}px`
}

export function replicaRow(server: string, sessionID: string) {
  return document.querySelector<HTMLElement>(
    `[data-slot="replica-row"][data-session-server="${CSS.escape(server)}"][data-session-id="${CSS.escape(sessionID)}"]`,
  )
}
