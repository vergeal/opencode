/** The one lifecycle Home's session list reads: first load, populated, empty, and a failed refresh. */
export type HomeSessionsState =
  | { status: "loading" }
  | { status: "ready"; count: number }
  | { status: "empty" }
  | { status: "error"; message: string; count: number }

export type HomeSessionsEvent =
  | { type: "refresh" }
  | { type: "loaded"; count: number }
  | { type: "failed"; message: string }
  | { type: "reset" }

export function transition(state: HomeSessionsState, event: HomeSessionsEvent): HomeSessionsState {
  switch (event.type) {
    case "refresh":
      // A refresh keeps whatever the user is already reading; only the first load blanks the list.
      return state.status === "ready" || state.status === "error" ? state : { status: "loading" }
    case "loaded":
      return event.count > 0 ? { status: "ready", count: event.count } : { status: "empty" }
    case "failed":
      return {
        status: "error",
        message: event.message,
        count: state.status === "ready" || state.status === "error" ? state.count : 0,
      }
    case "reset":
      return { status: "loading" }
  }
}
