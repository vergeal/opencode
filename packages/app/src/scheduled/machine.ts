import type { ScheduleInfo } from "@opencode/client/promise"

/** What the page knows about the task list. The list owns it, so no boolean beside it repeats the phase. */
export type TaskState =
  | { status: "loading" }
  | { status: "refreshing"; tasks: readonly ScheduleInfo[] }
  | { status: "ready"; tasks: readonly ScheduleInfo[] }
  /** A failed load keeps whatever the page already showed, so a retry is not a blank page. */
  | { status: "error"; message: string; tasks: readonly ScheduleInfo[] }

export type TaskEvent =
  | { type: "load.started" }
  | { type: "load.succeeded"; tasks: readonly ScheduleInfo[] }
  | { type: "load.failed"; message: string }
  | { type: "task.upserted"; task: ScheduleInfo }
  | { type: "task.removed"; id: string }

/** The rows a page should render, whether they are fresh, refreshing or stale behind an error. */
export function tasksOf(state: TaskState): readonly ScheduleInfo[] {
  return state.status === "loading" ? [] : state.tasks
}

/**
 * A task change only means something once a list exists, so an event that lands while loading keeps the
 * current state and lets the driver reload instead.
 */
export function transition(state: TaskState, event: TaskEvent): TaskState {
  switch (event.type) {
    case "load.started":
      // Only the first load blanks the page; a reload keeps the rows and shows the header spinner.
      if (state.status === "loading") return state

      return { status: "refreshing", tasks: tasksOf(state) }
    case "load.succeeded":
      return { status: "ready", tasks: event.tasks }
    case "load.failed":
      return { status: "error", message: event.message, tasks: tasksOf(state) }
    case "task.upserted": {
      if (state.status === "loading") return state

      const known = state.tasks.some((task) => task.id === event.task.id)

      return {
        status: state.status === "error" ? "ready" : state.status,
        tasks: known
          ? state.tasks.map((task) => (task.id === event.task.id ? event.task : task))
          : [...state.tasks, event.task],
      }
    }

    case "task.removed": {
      if (state.status === "loading") return state

      return {
        status: state.status === "error" ? "ready" : state.status,
        tasks: state.tasks.filter((task) => task.id !== event.id),
      }
    }
  }
}
