export * as Board from "./board.js"

import { Contract } from "./contract.js"
import { Ledger } from "./ledger.js"

/**
 * The board one session sees. A planner sees every batch it submitted and the newest of them; an executor sees only the
 * single task it was dispatched for, so sibling tasks never leak into its view. Any other session sees nothing.
 *
 * `now` is injectable so elapsed times are deterministic in tests; it defaults to the wall clock.
 */
export function project(file: Ledger.File, sessionID: string, now: number = Date.now()): Contract.BoardState {
  const planned = Object.values(file.plans)
    .filter((plan) => plan.pmSessionID === sessionID)
    .sort(newestFirst)
  if (planned.length > 0) {
    const plans = planned.map(summary)
    return { plans, current: view(file, planned[0]!, planned[0]!.tasks, now) }
  }

  const own = Object.values(file.tasks).find((task) => task.sessionID === sessionID)
  if (!own) return { plans: [], current: null }
  const plan = file.plans[own.planID]
  if (!plan) return { plans: [], current: null }
  return { plans: [summary(plan)], current: view(file, plan, [own.id], now) }
}

function summary(plan: Ledger.Plan): Contract.BoardPlan {
  return { planID: plan.planID, plannerSessionID: plan.pmSessionID ?? "", createdAt: plan.createdAt }
}

/** Newest first; equal timestamps fall back to the id so the order never depends on object key insertion. */
function newestFirst(a: Ledger.Plan, b: Ledger.Plan): number {
  return b.createdAt.localeCompare(a.createdAt) || a.planID.localeCompare(b.planID)
}

function view(
  file: Ledger.File,
  plan: Ledger.Plan,
  taskIDs: readonly string[],
  now: number,
): Contract.BoardCurrent {
  const tasks = taskIDs
    .map((id) => file.tasks[id])
    .filter((task): task is Ledger.Task => task !== undefined)
    .map((task) => row(file, task, now))
  return { planID: plan.planID, counts: count(tasks), tasks }
}

/** Every status is present, so a reader can render a fixed column without treating a missing key as zero. */
function count(tasks: readonly Contract.BoardTask[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const status of Ledger.STATUSES) counts[status] = 0
  for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1
  return counts
}

function row(file: Ledger.File, task: Ledger.Task, now: number): Contract.BoardTask {
  const started = task.dispatchedAt === undefined ? Number.NaN : Date.parse(task.dispatchedAt)
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    sessionID: task.sessionID ?? null,
    branch: task.branch ?? null,
    commit: task.commit ?? null,
    elapsedMs: Number.isNaN(started) ? 0 : Math.max(0, now - started),
    anomaly: anomaly(file, task.id),
  }
}

/** The last anomaly recorded for a task is the current explanation; `since` belongs to the first sighting. */
function anomaly(file: Ledger.File, taskID: string): string | null {
  let detail: string | null = null
  for (const item of file.anomalies) if (item.taskID === taskID) detail = item.detail
  return detail
}
