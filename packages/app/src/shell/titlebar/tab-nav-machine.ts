/**
 * The tab's whole transient surface in one value: which overlay is up (preview, context
 * menu, title editor) and the one-shot prompt pulse. A background session's prompt only
 * bumps `pulse`; it never moves the overlay.
 */
export type TabNavState = {
  readonly overlay: "idle" | "preview" | "menu" | "editing"
  /** A context menu chose Rename, so the editor opens once the menu finishes closing. */
  readonly renamePending: boolean
  /** Increments per prompt, then clears after the pulse animation ends. */
  readonly pulse: number
}

export type TabNavEvent =
  | { type: "preview.open" }
  | { type: "preview.close" }
  | { type: "menu.open" }
  | { type: "menu.close" }
  | { type: "rename.request" }
  | { type: "rename.begin" }
  | { type: "rename.end" }
  | { type: "pulse" }
  | { type: "pulse.clear" }

export const initialTabNavState: TabNavState = { overlay: "idle", renamePending: false, pulse: 0 }

export function transitionTabNav(state: TabNavState, event: TabNavEvent): TabNavState {
  switch (event.type) {
    case "preview.open":
      return state.overlay === "idle" ? { ...state, overlay: "preview" } : state
    case "preview.close":
      return state.overlay === "preview" ? { ...state, overlay: "idle" } : state
    case "menu.open":
      return state.overlay === "editing" ? state : { ...state, overlay: "menu", renamePending: false }
    // The closing menu keeps `renamePending`, so `rename.begin` can still open the editor.
    case "menu.close":
      return state.overlay === "menu" ? { ...state, overlay: "idle" } : state
    case "rename.request":
      return state.overlay === "menu" ? { ...state, renamePending: true } : state
    case "rename.begin":
      return state.overlay === "editing" || state.overlay === "menu"
        ? state
        : { ...state, overlay: "editing", renamePending: false }
    case "rename.end":
      return state.overlay === "editing" ? { ...state, overlay: "idle" } : state
    case "pulse":
      return { ...state, pulse: state.pulse + 1 }
    case "pulse.clear":
      return state.pulse === 0 ? state : { ...state, pulse: 0 }
  }
}
