export * as Ledger from "./ledger.js"

import { optional } from "@opencode/schema/schema"
import { Option, Schema } from "effect"
import type { Types } from "effect"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export const STATUSES = ["待派", "进行中", "已回传", "已核", "已合入", "失败", "阻塞"] as const
export const Status = Schema.Literals(STATUSES)
export type Status = typeof Status.Type

export const KINDS = ["验收失败", "超时", "范围越界", "结果缺失", "会话失联", "阻塞", "执行失败"] as const
export const Kind = Schema.Literals(KINDS)
export type Kind = typeof Kind.Type

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

export function move(task: Task, to: Status, at: string): Task {
  if (!TRANSITIONS[task.status].includes(to)) throw new TransitionError(task.status, to)
  return { ...task, status: to, updatedAt: at }
}

/** `resolve abandon` marks every downstream task blocked. `已合入` is terminal and is never downgraded. */
export function block(task: Task, at: string): Task {
  if (task.status === "已合入" || task.status === "阻塞") return task
  return { ...task, status: "阻塞", updatedAt: at }
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

/**
 * The ledger is the only authority, so it is written whole on every change: a temp file, then a rename. `update` runs
 * changes one at a time because tool calls and event handlers both mutate it.
 */
export function createStore(directory: string): Store {
  const ledgerPath = join(directory, "ledger.json")
  let cache: File | undefined
  let tail: Promise<unknown> = Promise.resolve()
  let counter = 0

  const planPath = (planID: string) => join(directory, "plans", `${planID}.json`)
  const resultPath = (planID: string, taskID: string) => join(directory, "results", planID, `${taskID}.json`)

  const load = async (): Promise<File> => {
    if (cache) return cache
    const file = Bun.file(ledgerPath)
    if (!(await file.exists())) {
      cache = { version: 1, plans: {}, tasks: {}, anomalies: [] }
      return cache
    }
    const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(File))(await file.text())
    if (Option.isNone(decoded))
      throw new Error(`台账 ${ledgerPath} 不是合法 JSON 或结构不匹配。修好或移走它，插件不会重建以免覆盖。`)
    cache = decoded.value
    return cache
  }

  const writeAtomic = async (path: string, text: string) => {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.${counter++}.tmp`
    await writeFile(temp, text)
    await rename(temp, path)
  }

  const write = (file: File) => writeAtomic(ledgerPath, `${JSON.stringify(file, null, 2)}\n`)

  const update = async <T>(change: (file: MutableFile) => T | Promise<T>): Promise<T> => {
    const run = async () => {
      const draft = structuredClone(await load()) as MutableFile
      const value = await change(draft)
      await write(draft)
      cache = draft
      return value
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
      await writeAtomic(planPath(planID), `${JSON.stringify(input, null, 2)}\n`)
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
