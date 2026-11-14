export * as Plan from "./plan.js"

import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"

export const TaskInput = Schema.Struct({
  id: Schema.String.annotate({
    description: "任务 ID，字母或数字开头，只含字母、数字、点、下划线和短横线，1–48 字符",
  }),
  title: Schema.String.annotate({ description: "任务标题，执行会话只看得到这段文字与任务书" }),
  deps: optional(Schema.Array(Schema.String)).annotate({
    description: "依赖的任务 ID。全部进入「已合入」之后这个任务才可派发",
  }),
  allowPaths: Schema.Array(Schema.String).annotate({
    description: "允许改动的仓库相对路径前缀，至少一条。写成目录前缀，如 plugins/dbro",
  }),
  verify: Schema.Array(Schema.String).annotate({
    description: "验收命令，插件在收到结果后原样执行；可以是空数组，表示只做范围核对",
  }),
})
export type TaskInput = typeof TaskInput.Type

export const Input = Schema.Struct({
  planID: Schema.String.annotate({ description: "本批次 ID，1–64 字符；重复提交同一 planID 且输入一致是幂等的" }),
  base: Schema.String.annotate({ description: "执行分支的基线 git 引用，如 lts/ocdev" }),
  tasks: Schema.Array(TaskInput).annotate({ description: "任务图，一次最多 200 个任务" }),
  concurrency: optional(Schema.Int).annotate({ description: "本批次同时进行的任务数上限，默认 3，允许 1–8" }),
})
export type Input = typeof Input.Type

export interface Conflict {
  readonly a: string
  readonly b: string
  readonly path: string
}

export interface Rejected {
  readonly id: string
  readonly reason: string
}

export interface PreparedTask {
  readonly id: string
  readonly title: string
  readonly deps: readonly string[]
  readonly allowPaths: readonly string[]
  readonly verify: readonly string[]
}

export interface Prepared {
  readonly planID: string
  readonly base: string
  readonly concurrency: number
  readonly tasks: readonly PreparedTask[]
  readonly accepted: readonly string[]
  readonly conflicts: readonly Conflict[]
  readonly rejected: readonly Rejected[]
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PlanError"
  }
}

export const DEFAULT_CONCURRENCY = 3
export const MAX_CONCURRENCY = 8
export const MAX_TASKS = 200

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * `allowPaths` ends up in a git pathspec and a conflict test, so it is normalized once at the boundary: POSIX
 * separators, no trailing slash, no `./`, no absolute paths and no `..` segments.
 */
export function normalizePath(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/")
  if (trimmed === "") throw new PlanError("路径不能为空")
  if (trimmed.startsWith("/") || /^[A-Za-z]:\//.test(trimmed)) throw new PlanError(`必须是相对仓库根的路径：${value}`)
  if (trimmed.startsWith("~")) throw new PlanError(`不接受家目录路径：${value}`)
  const parts = trimmed.split("/").filter((part) => part !== "" && part !== ".")
  if (parts.length === 0) throw new PlanError(`不是有效路径：${value}`)
  if (parts.includes("..")) throw new PlanError(`不接受 .. 段：${value}`)
  return parts.join("/")
}

/** The shared prefix of two path scopes, or `undefined` when they cannot collide. `src/a` and `src/ab` do not collide. */
export function overlap(a: string, b: string): string | undefined {
  if (a === b) return a
  if (a.startsWith(`${b}/`)) return a
  if (b.startsWith(`${a}/`)) return b
  return undefined
}

/** `allowPaths` collide when any pair overlaps. Reported path is the narrower scope, which is what a reviewer reads. */
export function scopeConflict(a: readonly string[], b: readonly string[]): string | undefined {
  for (const left of a) {
    for (const right of b) {
      const shared = overlap(left, right)
      if (shared) return shared
    }
  }
  return undefined
}

/** Whether one changed repository-relative path belongs to a task's allowed scope. */
export function covers(path: string, allowPaths: readonly string[]): boolean {
  return allowPaths.some((scope) => path === scope || path.startsWith(`${scope}/`))
}

/**
 * A task is ready only after every dependency is merged, so two tasks can run at the same time exactly when neither
 * can reach the other through `deps`. Tasks on the same chain are therefore never a conflict.
 */
export function canRunTogether(id: string, other: string, deps: ReadonlyMap<string, readonly string[]>): boolean {
  return !reaches(id, other, deps) && !reaches(other, id, deps)
}

function reaches(from: string, target: string, deps: ReadonlyMap<string, readonly string[]>, seen = new Set<string>()): boolean {
  if (seen.has(from)) return false
  seen.add(from)
  for (const dep of deps.get(from) ?? []) {
    if (dep === target || reaches(dep, target, deps, seen)) return true
  }
  return false
}

/**
 * Validates one plan and returns what the ledger should record. Invalid tasks are reported, never dropped silently;
 * only a malformed plan (empty task list, bad concurrency, oversize planID) throws.
 */
export function prepare(input: Input): Prepared {
  const planID = input.planID.trim()
  if (planID === "" || planID.length > 64) throw new PlanError("planID 必须是 1–64 个字符")
  if (/[/\\\s]/.test(planID)) throw new PlanError("planID 不能包含斜杠、反斜杠或空白")
  const base = input.base.trim()
  if (base === "" || /\s/.test(base)) throw new PlanError("base 必须是一个不带空白的 git 引用，如 lts/ocdev")
  if (input.tasks.length === 0) throw new PlanError("tasks 不能为空")
  if (input.tasks.length > MAX_TASKS) throw new PlanError(`一次最多 ${MAX_TASKS} 个任务`)
  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY)
    throw new PlanError(`concurrency 必须是 1–${MAX_CONCURRENCY} 的整数`)

  const rejected: Rejected[] = []
  const seen = new Set<string>()
  const shaped: TaskInput[] = []

  for (const task of input.tasks) {
    const id = task.id.trim()
    if (id.length === 0 || id.length > 48) {
      rejected.push({ id: task.id, reason: "任务 ID 必须是 1–48 个字符" })
      continue
    }
    if (!ID_PATTERN.test(id)) {
      rejected.push({ id, reason: "任务 ID 只能是字母、数字、点、下划线和短横线，且以字母或数字开头" })
      continue
    }
    if (seen.has(id)) {
      rejected.push({ id, reason: "任务 ID 重复" })
      continue
    }
    if (task.title.trim() === "") {
      rejected.push({ id, reason: "title 不能为空" })
      continue
    }
    const deps = [...new Set((task.deps ?? []).map((dep) => dep.trim()))]
    if (deps.some((dep) => dep === "")) {
      rejected.push({ id, reason: "deps 里有空 ID" })
      continue
    }
    if (deps.includes(id)) {
      rejected.push({ id, reason: "任务不能依赖自己" })
      continue
    }
    const allowPaths: string[] = []
    let pathError: string | undefined
    for (const path of task.allowPaths) {
      try {
        allowPaths.push(normalizePath(path))
      } catch (error) {
        pathError = error instanceof Error ? error.message : String(error)
      }
    }
    if (allowPaths.length === 0) {
      rejected.push({ id, reason: pathError ?? "allowPaths 不能为空" })
      continue
    }
    if (pathError) {
      rejected.push({ id, reason: pathError })
      continue
    }
    seen.add(id)
    shaped.push({ ...task, id, title: task.title.trim(), deps, allowPaths })
  }

  // A dependency that never appeared in the input is a typo; one that appeared but failed validation is pruned below.
  const inputIDs = new Set(input.tasks.map((task) => task.id.trim()))
  const alive = new Map(shaped.map((task) => [task.id, task]))
  for (const [id, task] of alive) {
    const unknown = (task.deps ?? []).filter((dep) => !inputIDs.has(dep))
    if (unknown.length === 0) continue
    rejected.push({ id, reason: `deps 引用了不存在的任务：${unknown.join("、")}` })
    alive.delete(id)
  }
  prune(alive, rejected)
  const deps = new Map([...alive].map(([id, task]) => [id, task.deps ?? []]))
  const cycle = findCycle([...alive.keys()], deps)
  if (cycle) {
    const path = cycle.join(" → ")
    // The DFS returns the closing node twice; report each task on the cycle once.
    for (const id of new Set(cycle)) {
      rejected.push({ id, reason: `依赖环：${path}` })
      alive.delete(id)
    }
    prune(alive, rejected)
  }

  const tasks = [...alive.values()].map((task) => ({
    id: task.id,
    title: task.title,
    deps: [...(task.deps ?? [])],
    allowPaths: task.allowPaths,
    verify: task.verify,
  }))
  const conflicts: Conflict[] = []
  for (let left = 0; left < tasks.length; left++) {
    for (let right = left + 1; right < tasks.length; right++) {
      const a = tasks[left]!
      const b = tasks[right]!
      if (!canRunTogether(a.id, b.id, deps)) continue
      const path = scopeConflict(a.allowPaths, b.allowPaths)
      if (path) conflicts.push({ a: a.id, b: b.id, path })
    }
  }

  return { planID, base, concurrency, tasks, accepted: tasks.map((task) => task.id), conflicts, rejected }
}

/** Drop tasks whose dependencies were rejected, repeatedly, so a rejected dep does not leave an unverifiable task. */
function prune(alive: Map<string, TaskInput>, rejected: Rejected[]) {
  let changed = true
  while (changed) {
    changed = false
    for (const [id, task] of alive) {
      const missing = (task.deps ?? []).filter((dep) => !alive.has(dep))
      if (missing.length === 0) continue
      rejected.push({ id, reason: `依赖未通过校验：${missing.join("、")}` })
      alive.delete(id)
      changed = true
    }
  }
}

/** Depth-first search over the dependency graph; returns the cycle in dependency order, or `undefined`. */
export function findCycle(ids: readonly string[], deps: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const visiting = new Set<string>()
  const done = new Set<string>()
  const stack: string[] = []

  const visit = (id: string): string[] | undefined => {
    if (done.has(id)) return undefined
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id]
    visiting.add(id)
    stack.push(id)
    for (const dep of deps.get(id) ?? []) {
      const cycle = visit(dep)
      if (cycle) return cycle
    }
    stack.pop()
    visiting.delete(id)
    done.add(id)
    return undefined
  }

  for (const id of ids) {
    const cycle = visit(id)
    if (cycle) return cycle
  }
  return undefined
}
