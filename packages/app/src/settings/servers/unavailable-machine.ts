/** The retry button's lifecycle. One union, so a stale error cannot disagree with a running retry. */
export type RetryState = { status: "idle" } | { status: "retrying" } | { status: "failed"; message: string }

export type RetryEvent = { type: "retry.started" } | { type: "retry.succeeded" } | { type: "retry.failed"; message: string }

export function transition(state: RetryState, event: RetryEvent): RetryState {
  switch (event.type) {
    case "retry.started":
      return state.status === "retrying" ? state : { status: "retrying" }
    case "retry.succeeded":
      return { status: "idle" }
    case "retry.failed":
      return { status: "failed", message: event.message }
  }
}
