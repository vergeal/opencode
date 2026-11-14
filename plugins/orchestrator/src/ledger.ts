export * as Ledger from "./ledger.js"

import { optional } from "@opencode/schema/schema"
import { Option, Schema } from "effect"
import type { Types } from "effect"
import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export const STATUSES = ["待派", "进行中", "已回传", "已核", "已合入", "失败", "阻塞"] as const
export const Status = Schema.Literals(STATUSES)
export type Status = typeof Status.Type

export const KINDS = ["验收失败", "超时", "范围越界", "结果缺失", "会话失联", "阻塞", "执行失败"] as const
export const Kind = Schema.Literals(KINDS)
export type Kind = typeof Kind.Type

export const DECISIONS = ["retry", "merged", "unblock", "abandon", "accept"] as const
export const Decision = Schema.Literals(DECISIONS)
export type Decision = typeof Decision.Type

/** Which states each `resolve` decision accepts. Anything else is refused with the current state in the message. */
export const DECISION_FROM: Readonly<Record<Decision, readonly Status[]>> = {
  retry: ["失败"],
  merged: ["已核"],
  unblock: ["阻塞"],
  abandon: ["失败", "已回传"],
  accept: ["失败"],
}

export const Anomaly = Schema.Struct({
  taskID: Schema.String,
  kind: Kind,
  detail: Schema.String,
  since: Schema.String,
})
export type Anomaly = typeof Anomaly.Type

export const Task = Schema.Struct({
  id: Schema.String,
  planID: Schema.String,
  title: Schema.String,
  deps: Schema.Array(Schema.String),
  allowPaths: Schema.Array(Schema.String),
  verify: Schema.Array(Schema.String),
  status: Status,
  /** Set by `approve`. `retry` keeps it so a re-dispatch does not need another approval. */
  approvedAt: optional(Schema.String),
  dispatchedAt: optional(Schema.String),
  sessionID: optional(Schema.String),
  branch: optional(Schema.String),
  worktree: optional(Schema.String),
  commit: optional(Schema.String),
  note: optional(Schema.String),
  updatedAt: Schema.String,
})
export type Task = typeof Task.Type

export const Plan = Schema.Struct({
  planID: Schema.String,
  base: Schema.String,
  concurrency: Schema.Int,
  /** The session that called `plan`; the brief names it as the only address an executor may message. */
  pmSessionID: optional(Schema.String),
  createdAt: Schema.String,
  tasks: Schema.Array(Schema.String),
})
export type Plan = typeof Plan.Type

export const File = Schema.Struct({
  version: Schema.Literal(1),
  plans: Schema.Record(Schema.String, Plan),
  tasks: Schema.Record(Schema.String, Task),
  anomalies: Schema.Array(Anomaly),
})
export type File = typeof File.Type

export type MutableFile = Types.DeepMutable<File>
export type MutableTask = Types.DeepMutable<Task>

/**
 * The whole state machine. Every write to `status` goes through {@link move}, so a hand-edited or stale caller cannot
 * jump straight from `进行中` to `已核` or revive a merged task.
 */
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  待派: ["进行中"],
  进行中: ["已回传", "失败"],
  已回传: ["已核", "失败"],
  // `失败 → 已核` is `resolve accept`; spec v2 lists accept but omits the edge.
  失败: ["待派", "已核"],
  已核: ["已合入"],
  已合入: [],
  阻塞: ["待派"],
}

export class TransitionError extends Error {
  constructor(
    readonly from: Status,
    readonly to: Status,
  ) {
    const allowed = TRANSITIONS[from].join("、") || "无（终态）"
    super(`非法状态迁移：${from} → ${to}。允许的目标：${allowed}。`)
    this.name = "TransitionError"
  }
}

export function move<T extends Task>(task: T, to: Status, at: string): T {
  if (!TRANSITIONS[task.status].includes(to)) throw new TransitionError(task.status, to)
  return { ...task, status: to, updatedAt: at }
}

/** `resolve abandon` marks every downstream task blocked. `已合入` is terminal and is never downgraded. */
export function block<T extends Task>(task: T, at: string): T {
  if (task.status === "已合入" || task.status === "阻塞") return task
  return { ...task, status: "阻塞", updatedAt: at }
}

/**
 * One row per task and kind: refreshing a recurring anomaly updates its text but keeps `since`, so `status` reports when
 * the problem started rather than when it was last noticed. `detail` is capped at the width `status` returns.
 */
export function upsertAnomaly(file: MutableFile, taskID: string, kind: Kind, detail: string, since: string) {
  const text = detail.slice(0, 200)
  const existing = file.anomalies.find((item) => item.taskID === taskID && item.kind === kind)
  if (existing) {
    existing.detail = text
    return
  }
  file.anomalies.push({ taskID, kind, detail: text, since })
}

export function clearAnomalies(file: MutableFile, taskID: string) {
  file.anomalies = file.anomalies.filter((item) => item.taskID !== taskID)
}

export interface ResultRead {
  readonly present: boolean
  readonly value?: unknown
  readonly error?: string
}

export interface Store {
  read(): Promise<File>
  update<T>(change: (file: MutableFile) => T | Promise<T>): Promise<T>
  planPath(planID: string): string
  resultPath(planID: string, taskID: string): string
  readPlan(planID: string): Promise<unknown>
  writePlan(planID: string, input: unknown): Promise<void>
  readResult(planID: string, taskID: string): Promise<ResultRead>
  clearResult(planID: string, taskID: string): Promise<void>
}

const LOCK_TIMEOUT_MS = 10_000
const STALE_LOCK_MS = 30_000
const LOCK_RETRY_MS = 10

/**
 * The ledger is the only authority, so it is written whole on every change: a temp file, then a rename. `update` runs
 * changes one at a time because tool calls and event handlers both mutate it. Each plugin instance owns its own store
 * but they all share the same data directory, so the in-process queue is not enough: the whole read-modify-write runs
 * under a lock file so two instances cannot interleave and overwrite each other.
 */
export function createStore(directory: string): Store {
  const ledgerPath = join(directory, "ledger.json")
  const lockPath = join(directory, "ledger.json.lock")
  let tail: Promise<unknown> = Promise.resolve()

  const planPath = (planID: string) => join(directory, "plans", `${planID}.json`)
  const resultPath = (planID: string, taskID: string) => join(directory, "results", planID, `${taskID}.json`)

  const load = async (): Promise<File> => {
    const file = Bun.file(ledgerPath)
    if (!(await file.exists())) return { version: 1, plans: {}, tasks: {}, anomalies: [] }
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(File))(await file.text())
    if (Option.isNone(decoded))
      throw new Error(`台账 ${ledgerPath} 不是合法 JSON 或结构不匹配。修好或移走它，插件不会重建以免覆盖。`)
    return decoded.value
  }

  const writeAtomic = async (path: string, text: string) => {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, text)
    await rename(temp, path)
  }

  const write = (file: File) => writeAtomic(ledgerPath, `${JSON.stringify(file, null, 2)}\n`)

  const update = async <T>(change: (file: MutableFile) => T | Promise<T>): Promise<T> => {
    const run = async () => {
      // The lock spans the callback: reading after acquiring it is what makes the read-modify-write atomic.
      const release = await acquireLock(lockPath)
      try {
        const draft = structuredClone(await load()) as MutableFile
        const value = await change(draft)
        await write(draft)
        return value
      } finally {
        await release()
      }
    }
    // Errors propagate to the caller, but the queue itself must stay usable for the next change.
    const result = tail.then(run, run)
    tail = result.catch(() => undefined)
    return result
  }

  return {
    read: async () => structuredClone(await load()),
    update,
    planPath,
    resultPath,
    readPlan: async (planID) => {
      const file = Bun.file(planPath(planID))
      if (!(await file.exists())) return undefined
      const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))(await file.text())
      if (Option.isNone(decoded)) throw new Error(`plan 存档 ${planPath(planID)} 不是合法 JSON。`)
      return decoded.value
    },
    writePlan: async (planID, input) => {
      // Same lock as the ledger so a plan save cannot be merged into a different snapshot of it.
      const release = await acquireLock(lockPath)
      try {
        await writeAtomic(planPath(planID), `${JSON.stringify(input, null, 2)}\n`)
      } finally {
        await release()
      }
    },
    readResult: async (planID, taskID) => {
      const path = resultPath(planID, taskID)
      const file = Bun.file(path)
      if (!(await file.exists())) return { present: false }
      const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))(await file.text())
      if (Option.isNone(decoded)) return { present: true, error: "不是合法 JSON" }
      return { present: true, value: decoded.value }
    },
    clearResult: async (planID, taskID) => {
      await rm(resultPath(planID, taskID), { force: true })
    },
  }
}

/** Creates `path` exclusively; a second holder sees `EEXIST` and retries until {@link LOCK_TIMEOUT_MS}. */
async function acquireLock(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true })
  const owner = JSON.stringify({ pid: process.pid, at: new Date().toISOString() })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let reclaimed = false
  for (;;) {
    const handle = await open(path, "wx").catch((error: unknown) => {
      if (isBusy(error)) return undefined
      throw error
    })
    if (handle) {
      try {
        await handle.writeFile(owner)
      } catch (error) {
        await handle.close()
        await rm(path, { force: true })
        throw error
      }
      await handle.close()
      return () => releaseLock(path, owner)
    }
    if (!reclaimed && (await reclaimStaleLock(path))) {
      reclaimed = true
      continue
    }
    if (Date.now() >= deadline)
      throw new Error(
        `台账锁 ${path} 等待超过 ${LOCK_TIMEOUT_MS / 1000} 秒仍未获得。另一个实例可能卡住：确认没有写入方在跑之后删掉该锁文件再重试。`,
      )
    await Bun.sleep(LOCK_RETRY_MS)
  }
}

function isBusy(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}

/** Drops a lock older than {@link STALE_LOCK_MS}, but only while the file still matches what was inspected. */
async function reclaimStaleLock(path: string) {
  const text = await readFile(path, "utf8").catch(() => undefined)
  if (text === undefined) return false
  if ((await lockAge(path, text)) <= STALE_LOCK_MS) return false
  // Re-read before unlinking: a holder that replaced the lock in between must not lose it.
  if ((await readFile(path, "utf8").catch(() => undefined)) !== text) return false
  await unlink(path).catch(() => undefined)
  return true
}

async function lockAge(path: string, text: string) {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ at: Schema.String })))(text)
  if (Option.isSome(decoded)) {
    const at = Date.parse(decoded.value.at)
    if (!Number.isNaN(at)) return Date.now() - at
  }
  const info = await stat(path).catch(() => undefined)
  return info ? Date.now() - info.mtimeMs : 0
}

/** Only removes the lock while it still carries this holder's token, so a reclaim elsewhere is not undone. */
async function releaseLock(path: string, owner: string) {
  if ((await readFile(path, "utf8").catch(() => undefined)) !== owner) return
  await unlink(path).catch(() => undefined)
}
