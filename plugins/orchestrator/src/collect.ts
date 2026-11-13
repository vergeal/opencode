export * as Collect from "./collect.js"

import { Git } from "./git.js"
import type { GitClient } from "./git.js"
import { Ledger } from "./ledger.js"
import { Plan } from "./plan.js"

export interface Ports {
  readonly store: Ledger.Store
  readonly git: GitClient
  readonly now: () => string
  readonly verifyTimeoutMs: number
  /** Dispatch every approved, ready task with a free slot; `retry` uses it to re-dispatch immediately. */
  readonly resume: (planID: string) => Promise<string[]>
  /** Only called for the three kinds the user asked to be told about. */
  readonly notify?: (text: string) => Promise<void>
}

export type Outcome =
  | { readonly status: "checked" }
  /** The result file has not appeared yet. Not an anomaly until the grace period expires. */
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly kind: Ledger.Kind; readonly detail: string }
  | { readonly status: "ignored" }

export interface ResultValue {
  readonly task: string
  readonly branch: string
  readonly commit: string
  readonly changed: readonly string[]
  readonly verify: string
}

const NOTIFY_KINDS = new Set<Ledger.Kind>(["验收失败", "范围越界", "会话失联"])

/**
 * Collects one task's result and runs the mechanical checks. Nothing here judges the code: it compares the reported
 * commit with HEAD, the changed paths with `allowPaths`, and runs `verify` verbatim. The plugin never merges.
 */
export async function collect(ports: Ports, taskID: string): Promise<Outcome> {
  const file = await ports.store.read()
  const task = file.tasks[taskID]
  if (!task) return { status: "ignored" }
  if (task.status !== "进行中" && task.status !== "已回传") return { status: "ignored" }
  const plan = file.plans[task.planID]
  if (!plan) return fail(ports, taskID, "结果缺失", `批次 ${task.planID} 不在台账里，无法核对`)
  if (!task.worktree || !task.branch) return fail(ports, taskID, "结果缺失", "台账里没有 worktree 或 branch，无法核对")

  if (task.status === "进行中") {
    await ports.store.update((draft) => {
      const current = draft.tasks[taskID]
      if (current?.status === "进行中") draft.tasks[taskID] = Ledger.move(current, "已回传", ports.now())
    })
  }

  const read = await ports.store.readResult(plan.planID, taskID)
  if (!read.present) return { status: "missing" }
  if (read.error) return fail(ports, taskID, "结果缺失", `结果文件不是合法 JSON：${read.error}`)
  const parsed = parseResult(read.value, task)
  if (!parsed.ok) return fail(ports, taskID, "结果缺失", parsed.reason)

  const checked = await verifyWorktree(ports, task, plan.base, parsed.value)
  if (checked) return checked

  await ports.store.update((draft) => {
    const current = draft.tasks[taskID]
    if (!current || current.status !== "已回传") return
    draft.tasks[taskID] = { ...Ledger.move(current, "已核", ports.now()), commit: parsed.value.commit }
    Ledger.clearAnomalies(draft, taskID)
  })
  return { status: "checked" }
}

async function verifyWorktree(ports: Ports, task: Ledger.Task, base: string, result: ResultValue): Promise<Outcome | undefined> {
  try {
    const head = await ports.git.head(task.worktree!)
    if (head !== result.commit)
      return fail(ports, task.id, "结果缺失", `结果里的 commit ${short(result.commit)} 不是 HEAD（${short(head)}）`)
    const changed = await ports.git.changed(base, head)
    const outside = changed.filter((path) => !Plan.covers(path, task.allowPaths))
    if (outside.length > 0)
      return fail(ports, task.id, "范围越界", `改到 allowPaths 之外：${list(outside)}`)
    const dirty = await ports.git.dirtyTracked(task.worktree!)
    if (dirty.length > 0) return fail(ports, task.id, "范围越界", `有已跟踪文件未提交：${list(dirty)}`)
  } catch (error) {
    return fail(ports, task.id, "结果缺失", `git 核对失败：${message(error)}`)
  }

  const verified = await Git.runVerify(task.verify, task.worktree!, ports.verifyTimeoutMs).catch((error) => ({
    ok: false,
    command: task.verify.join(" && "),
    detail: `无法执行验收命令：${message(error)}`,
  }))
  if (!verified.ok) return fail(ports, task.id, "验收失败", `${verified.command}：${verified.detail}`)
  return undefined
}

export function parseResult(
  value: unknown,
  task: Pick<Ledger.Task, "id" | "branch">,
): { ok: true; value: ResultValue } | { ok: false; reason: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { ok: false, reason: "结果文件不是 JSON 对象" }
  const record = value as Record<string, unknown>
  if (typeof record.task !== "string") return { ok: false, reason: "缺少 task 字段" }
  if (record.task !== task.id) return { ok: false, reason: `task 字段是「${record.task}」，应为「${task.id}」` }
  if (typeof record.branch !== "string") return { ok: false, reason: "缺少 branch 字段" }
  if (record.branch !== task.branch)
    return { ok: false, reason: `branch 字段是「${record.branch}」，应为「${task.branch}」` }
  if (typeof record.commit !== "string" || !/^[0-9a-f]{40}$/.test(record.commit))
    return { ok: false, reason: "commit 必须是 40 位小写 sha" }
  if (!Array.isArray(record.changed) || !record.changed.every((item) => typeof item === "string"))
    return { ok: false, reason: "changed 必须是字符串数组" }
  if (typeof record.verify !== "string") return { ok: false, reason: "缺少 verify 字段" }
  return {
    ok: true,
    value: {
      task: record.task,
      branch: record.branch,
      commit: record.commit,
      changed: record.changed as string[],
      verify: record.verify,
    },
  }
}

/** The grace period ran out with no result file: this is the point where it becomes an anomaly. */
export async function markMissing(ports: Ports, taskID: string): Promise<Outcome> {
  const task = (await ports.store.read()).tasks[taskID]
  if (!task) return { status: "ignored" }
  return fail(ports, taskID, "结果缺失", `结果文件仍未出现：${ports.store.resultPath(task.planID, taskID)}`)
}

/** `session.execution.failed`, or an interruption the user did not ask for. */
export async function markExecutionFailed(ports: Ports, taskID: string, detail: string): Promise<Outcome> {
  return fail(ports, taskID, "执行失败", detail)
}

export interface ResolveInput {
  readonly taskID: string
  readonly decision: Ledger.Decision
  readonly note?: string
}

export async function resolve(
  ports: Ports,
  input: ResolveInput,
): Promise<{ taskID: string; status: Ledger.Status; dispatched?: boolean }> {
  const file = await ports.store.read()
  const task = file.tasks[input.taskID]
  if (!task) throw new Error(`任务 ${input.taskID} 不在台账里`)
  const allowed = Ledger.DECISION_FROM[input.decision]
  if (!allowed.includes(task.status))
    throw new Error(`任务 ${task.id} 现在是「${task.status}」，不能 ${input.decision}。${input.decision} 需要：${allowed.join("、")}。`)
  if (input.decision === "accept" && !input.note?.trim())
    throw new Error("accept 越过验收失败，必须带 note 说明为什么可以接受。")

  const at = ports.now()
  const note = input.note?.trim()

  if (input.decision === "retry") {
    await ports.store.update((draft) => {
      const current = draft.tasks[input.taskID]
      if (!current) return
      draft.tasks[input.taskID] = {
        ...Ledger.move(current, "待派", at),
        dispatchedAt: undefined,
        sessionID: undefined,
        branch: undefined,
        worktree: undefined,
        commit: undefined,
        note: note ?? current.note,
      }
      Ledger.clearAnomalies(draft, input.taskID)
    })
    const dispatched = (await ports.resume(task.planID)).includes(input.taskID)
    const status = (await ports.store.read()).tasks[input.taskID]!.status
    return { taskID: input.taskID, status, dispatched }
  }

  if (input.decision === "abandon") {
    await ports.store.update((draft) => {
      const current = draft.tasks[input.taskID]
      if (!current) return
      draft.tasks[input.taskID] = {
        ...(current.status === "已回传" ? Ledger.move(current, "失败", at) : current),
        note: note ?? current.note,
      }
      for (const downstreamID of downstream(draft, input.taskID)) {
        const dependent = draft.tasks[downstreamID]
        if (!dependent) continue
        draft.tasks[downstreamID] = Ledger.block(dependent, at)
        Ledger.upsertAnomaly(draft, downstreamID, "阻塞", `依赖 ${input.taskID} 已放弃`, at)
      }
    })
  } else {
    const next: Ledger.Status = input.decision === "merged" ? "已合入" : input.decision === "accept" ? "已核" : "待派"
    await ports.store.update((draft) => {
      const current = draft.tasks[input.taskID]
      if (!current) return
      draft.tasks[input.taskID] = { ...Ledger.move(current, next, at), note: note ?? current.note }
      Ledger.clearAnomalies(draft, input.taskID)
    })
  }

  return { taskID: input.taskID, status: (await ports.store.read()).tasks[input.taskID]!.status }
}

/** Tasks that depend on `taskID`, directly or transitively, within the same plan. */
export function downstream(file: Ledger.File, taskID: string): string[] {
  const planID = file.tasks[taskID]?.planID
  const found = new Set<string>()
  const queue = [taskID]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const task of Object.values(file.tasks)) {
      if (task.planID !== planID || found.has(task.id)) continue
      if (!task.deps.includes(current)) continue
      found.add(task.id)
      queue.push(task.id)
    }
  }
  return [...found]
}

async function fail(ports: Ports, taskID: string, kind: Ledger.Kind, detail: string): Promise<Outcome> {
  const at = ports.now()
  const text = detail.slice(0, 200)
  await ports.store.update((draft) => {
    const task = draft.tasks[taskID]
    if (!task) return
    // `进行中 → 失败` covers a lost session or `execution.failed`; other states only gain the anomaly.
    if (Ledger.TRANSITIONS[task.status].includes("失败")) draft.tasks[taskID] = Ledger.move(task, "失败", at)
    Ledger.upsertAnomaly(draft, taskID, kind, text, at)
  })
  if (NOTIFY_KINDS.has(kind) && ports.notify) await ports.notify(`${taskID} ${kind}：${text.slice(0, 120)}`)
  return { status: "failed", kind, detail: text }
}

function short(sha: string) {
  return sha.slice(0, 12)
}

function list(paths: readonly string[]) {
  const shown = paths.slice(0, 10).join("、")
  return paths.length > 10 ? `${shown} 等 ${paths.length} 个` : shown
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
