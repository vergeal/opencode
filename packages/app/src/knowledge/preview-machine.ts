/** The file preview's lifecycle. The path lives inside each phase so a late read cannot show under another file. */
export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; path: string }
  | { status: "ready"; path: string; text: string }
  /** A read that failed keeps its path so the pane can retry the same file. */
  | { status: "failed"; path: string; message: string }

export type PreviewEvent =
  | { type: "file.opened"; path: string }
  | { type: "file.loaded"; path: string; text: string }
  | { type: "file.failed"; path: string; message: string }
  | { type: "file.closed" }

/** The path the pane is showing or waiting for, so the row can mark itself selected. */
export function previewPath(state: PreviewState) {
  return state.status === "idle" ? "" : state.path
}

export function transition(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case "file.opened":
      if (state.status === "loading" && state.path === event.path) return state

      return { status: "loading", path: event.path }
    case "file.loaded":
      // Only the file the user is still waiting for may write; an earlier read must not overwrite a later one.
      if (state.status !== "loading" || state.path !== event.path) return state

      return { status: "ready", path: event.path, text: event.text }
    case "file.failed":
      if (state.status === "idle" || state.path !== event.path) return state

      return { status: "failed", path: event.path, message: event.message }
    case "file.closed":
      return state.status === "idle" ? state : { status: "idle" }
  }
}
