export * as Watch from "./watch.js"

import type { Collect } from "./collect.js"
import { Ledger } from "./ledger.js"

/** The one question the sweep asks about an executor. Injected so tests do not need a real server. */
export interface Sessions {
  alive(sessionID: string): Promise<boolean>
}

export interface Ports {
  readonly store: Ledger.Store
  readonly sessions: Sessions
  readonly now: () => string
  /** How long an executor gets to write its result file after its execution ends. */
  readonly graceMs: number
  /** A task running longer than this is flagged. The task keeps running: the PM decides what to do. */
  readonly timeoutMs: number
  readonly collect: (taskID: string) => Promise<Collect.Outcome>
  readonly markMissing: (taskID: string) => Promise<Collect.Outcome>
  readonly markExecutionFailed: (
    taskID: string,
    detail: string,
    kind?: "执行失败" | "会话失联",
  ) => Promise<Collect.Outcome>
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * The four facts the plugin reacts to. `session.idle` is a fallback only: `succeeded` is the durable signal that the
 * executor finished, while `idle` also fires between steps and after an interruption.
 */
export type Event =
  | { readonly type: "session.execution.succeeded"; readonly sessionID: string }
  | { readonly type: "session.execution.failed"; readonly sessionID: string; readonly error?: unknown }
  | { readonly type: "session.execution.interrupted"; readonly sessionID: string; readonly reason: string }
  | { readonly type: "session.idle"; readonly sessionID: string }

const MANAGED: readonly Ledger.Status[] = ["进行中", "已回传"]

/** The task an executor is working on. A retried task has a new session, so the old one stops matching here. */
export async function findBySession(store: Ledger.Store, sessionID: string): Promise<Ledger.Task | undefined> {
  const file = await store.read()
  return Object.values(file.tasks).find((task) => task.sessionID === sessionID && MANAGED.includes(task.status))
}

export async function handle(ports: Ports, event: Event): Promise<void> {
  if (event.type === "session.execution.succeeded") return settle(ports, event.sessionID)

  if (event.type === "session.execution.failed")
    return fail(ports, event.sessionID, `${describe(event.error)}`, "执行失败")

  if (event.type === "session.execution.interrupted") {
    // A user interruption is not a failure: the task stays 进行中 and the timeout sweep eventually flags it.
    if (event.reason === "user") return
    return fail(ports, event.sessionID, `执行被中断（${event.reason}）`, "会话失联")
  }

  // Fallback: the result file may already be there, in which case there is nothing to wait for.
  const task = await findBySession(ports.store, event.sessionID)
  if (!task) return
  if ((await ports.store.readResult(task.planID, task.id)).present) await ports.collect(task.id)
}

async function settle(ports: Ports, sessionID: string) {
  const sleep = ports.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  await sleep(ports.graceMs)
  const task = await findBySession(ports.store, sessionID)
  if (!task) return
  if ((await ports.collect(task.id)).status !== "missing") return
  // Re-read: the task may have been retried while the grace period ran, and a fresh attempt must not be failed.
  const current = await findBySession(ports.store, sessionID)
  if (current) await ports.markMissing(current.id)
}

async function fail(ports: Ports, sessionID: string, detail: string, kind: "执行失败" | "会话失联") {
  const task = await findBySession(ports.store, sessionID)
  if (!task) return
  await ports.markExecutionFailed(task.id, detail, kind)
}

/**
 * Catches what no event reports: an executor whose session disappeared, a task that never came back, and a result
 * file that never appeared. Every branch is idempotent, so running it often is safe.
 */
export async function sweep(ports: Ports): Promise<{ lost: string[]; timedOut: string[]; missing: string[] }> {
  const file = await ports.store.read()
  const at = ports.now()
  const lost: string[] = []
  const timedOut: string[] = []
  const missing: string[] = []

  for (const task of Object.values(file.tasks)) {
    if (task.status === "进行中" && task.sessionID && !(await ports.sessions.alive(task.sessionID))) {
      const outcome = await ports.markExecutionFailed(task.id, "执行会话已不存在", "会话失联")
      if (outcome.status !== "ignored") lost.push(task.id)
      continue
    }

    const dispatchedAt = task.dispatchedAt
    if (task.status === "进行中" && dispatchedAt && elapsed(dispatchedAt, at) > ports.timeoutMs) {
      await ports.store.update((draft) => {
        if (draft.tasks[task.id]?.status !== "进行中") return
        Ledger.upsertAnomaly(
          draft,
          task.id,
          "超时",
          `已运行 ${Math.round(elapsed(dispatchedAt, at) / 60_000)} 分钟，仍未回传`,
          at,
        )
      })
      timedOut.push(task.id)
      continue
    }

    if (task.status !== "已回传" || elapsed(task.updatedAt, at) <= ports.graceMs) continue
    if ((await ports.store.readResult(task.planID, task.id)).present) continue
    await ports.markMissing(task.id)
    missing.push(task.id)
  }

  return { lost, timedOut, missing }
}

/** Startup recovery: `已回传` tasks are collected, then the sweep covers everything else. */
export async function reconcile(ports: Ports): Promise<string[]> {
  const file = await ports.store.read()
  const collected: string[] = []
  for (const task of Object.values(file.tasks)) {
    if (task.status !== "已回传") continue
    if ((await ports.collect(task.id)).status === "checked") collected.push(task.id)
  }
  await sweep(ports)
  return collected
}

export interface Runner {
  stop(): Promise<void>
}

/**
 * Subscribes once and sweeps on an interval. The subscription gets the abort signal so stopping the plugin also ends
 * the stream, rather than leaving a reader attached to a dead server.
 */
export function start(
  ports: Ports,
  subscribe: (signal: AbortSignal) => AsyncIterable<Event>,
  options: { readonly sweepMs?: number; readonly onError?: (error: unknown) => void } = {},
): Runner {
  const controller = new AbortController()
  const report = options.onError ?? (() => undefined)
  const loop = (async () => {
    try {
      for await (const event of subscribe(controller.signal)) {
        if (controller.signal.aborted) break
        await handle(ports, event).catch(report)
      }
    } catch (error) {
      if (!controller.signal.aborted) report(error)
    }
  })()
  const timer = setInterval(() => {
    void sweep(ports).catch(report)
  }, options.sweepMs ?? 60_000)
  timer.unref?.()

  return {
    stop: async () => {
      controller.abort()
      clearInterval(timer)
      await loop.catch(() => undefined)
    },
  }
}

function elapsed(from: string, to: string) {
  const delta = Date.parse(to) - Date.parse(from)
  return Number.isFinite(delta) ? Math.max(0, delta) : 0
}

function describe(error: unknown) {
  if (error === undefined || error === null) return "执行失败"
  if (typeof error === "string") return error
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim() !== "") return message
  }
  return JSON.stringify(error)
}
