export * as Dispatch from "./dispatch.js"

import { join } from "node:path"
import { Brief } from "./brief.js"
import type { GitClient } from "./git.js"
import { Ledger } from "./ledger.js"

export interface SessionPort {
  create(input: { title: string }): Promise<string>
  move(input: { sessionID: string; directory: string }): Promise<void>
  prompt(input: { sessionID: string; text: string }): Promise<void>
  remove(input: { sessionID: string }): Promise<void>
}

export interface Ports {
  readonly store: Ledger.Store
  readonly git: GitClient
  readonly session: SessionPort
  /** Root directory for task worktrees; each dispatch creates `<repo>-<taskID>` under it. */
  readonly worktrees: string
  readonly now: () => string
}

export interface Outcome {
  readonly ok: boolean
  readonly taskID: string
  readonly error?: string
}

export interface Dispatcher {
  approve(input: { planID: string; tasks?: readonly string[] }): Promise<{ dispatched: string[]; waiting: string[] }>
  /** Dispatch every approved, ready task with a free slot. Returns the tasks dispatched in this pass. */
  resume(planID?: string): Promise<string[]>
  /** Dispatch one already-approved task, used by `resolve retry` to re-dispatch immediately. */
  dispatchTask(taskID: string): Promise<Outcome>
}

export function createDispatcher(ports: Ports): Dispatcher {
  let tail: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
    const result = tail.then(run, run)
    tail = result.catch(() => undefined)
    return result
  }

  const resume = (planID?: string) =>
    exclusive(async () => {
      if (planID) return dispatchPass(ports, planID)
      const planIDs = Object.keys((await ports.store.read()).plans)
      const dispatched: string[] = []
      for (const id of planIDs) dispatched.push(...(await dispatchPass(ports, id)))
      return dispatched
    })

  const approve = (input: { planID: string; tasks?: readonly string[] }) =>
    exclusive(async () => {
      const file = await ports.store.read()
      const plan = file.plans[input.planID]
      if (!plan) {
        const known = Object.keys(file.plans).join("、") || "（无）"
        throw new Error(`没有 planID「${input.planID}」。已有批次：${known}。`)
      }

      const candidates = input.tasks
        ? requireMembers(file, plan, input.tasks)
        : plan.tasks.filter((id) => {
            const task = file.tasks[id]
            return task?.status === "待派" && ready(file, task)
          })

      const at = ports.now()
      await ports.store.update((draft) => {
        for (const id of candidates) {
          const task = draft.tasks[id]
          if (!task || task.planID !== plan.planID || task.status !== "待派") continue
          task.approvedAt = task.approvedAt ?? at
          task.updatedAt = at
        }
      })

      const dispatched = await dispatchPass(ports, plan.planID)
      return { dispatched, waiting: candidates.filter((id) => !dispatched.includes(id)) }
    })

  const dispatchTask = (taskID: string) =>
    exclusive(async () => {
      const file = await ports.store.read()
      const task = file.tasks[taskID]
      if (!task) return { ok: false, taskID, error: `任务 ${taskID} 不在台账里` }
      const plan = file.plans[task.planID]
      if (!plan) return { ok: false, taskID, error: `任务 ${taskID} 的批次 ${task.planID} 不在台账里` }
      return dispatchOne(ports, plan, task)
    })

  return { approve, resume, dispatchTask }
}

/** `resume` without taking the lock again; only called from inside `exclusive`. */
async function dispatchPass(ports: Ports, planID: string): Promise<string[]> {
  const dispatched: string[] = []
  const blocked = new Set<string>()
  while (true) {
    const file = await ports.store.read()
    const plan = file.plans[planID]
    if (!plan || running(file, planID) >= plan.concurrency) break
    const task = plan.tasks
      .map((taskID) => file.tasks[taskID])
      .find((task) => task && !blocked.has(task.id) && task.status === "待派" && task.approvedAt && ready(file, task))
    if (!task) break
    const outcome = await dispatchOne(ports, plan, task)
    if (outcome.ok) dispatched.push(outcome.taskID)
    else blocked.add(outcome.taskID)
  }
  return dispatched
}

/**
 * One dispatch is five steps and any of them can fail. A failure rolls the task back to `待派` — keeping its approval,
 * so the next pass retries it — and records why. Nothing else is undone: other tasks keep running.
 */
export async function dispatchOne(ports: Ports, plan: Ledger.Plan, task: Ledger.Task): Promise<Outcome> {
  const branch = await nextBranch(ports.git, task.id)
  const directory = ports.git.claimDirectory(join(ports.worktrees, `${ports.git.name}-${task.id}`))
  let sessionID: string | undefined
  let created = false
  try {
    await ports.git.createWorktree({ directory, branch, base: plan.base })
    created = true
    sessionID = await ports.session.create({ title: `orchestrator/${task.id}` })
    await ports.session.move({ sessionID, directory })
    await ports.session.prompt({
      sessionID,
      text: Brief.render({
        id: task.id,
        title: task.title,
        allowPaths: task.allowPaths,
        verify: task.verify,
        branch,
        base: plan.base,
        worktree: directory,
        resultPath: ports.store.resultPath(task.planID, task.id),
        pmSessionID: plan.pmSessionID,
      }),
    })

    const at = ports.now()
    await ports.store.update((file) => {
      const current = file.tasks[task.id]
      if (!current) throw new Error(`任务 ${task.id} 不在台账里`)
      file.tasks[task.id] = {
        ...Ledger.move(current, "进行中", at),
        deps: [...current.deps],
        allowPaths: [...current.allowPaths],
        verify: [...current.verify],
        approvedAt: current.approvedAt ?? at,
        dispatchedAt: at,
        sessionID,
        branch,
        worktree: directory,
      }
      Ledger.clearAnomalies(file, task.id)
    })
    return { ok: true, taskID: task.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (sessionID) await ports.session.remove({ sessionID }).catch(() => undefined)
    if (created) await ports.git.removeWorktree({ directory, branch }).catch(() => undefined)
    await ports.store.update((file) => {
      const current = file.tasks[task.id]
      if (current && current.status === "待派")
        file.tasks[task.id] = {
          ...current,
          sessionID: undefined,
          branch: undefined,
          worktree: undefined,
          dispatchedAt: undefined,
        }
      Ledger.upsertAnomaly(file, task.id, "执行失败", `派发失败：${message}`, ports.now())
    })
    return { ok: false, taskID: task.id, error: message }
  }
}

/** Reusing `task/<id>` after a retry would continue on top of the failed attempt; every retry gets a fresh branch. */
export async function nextBranch(git: GitClient, taskID: string): Promise<string> {
  const base = `task/${taskID}`
  if (!(await git.branchExists(base))) return base
  for (let index = 2; ; index++) {
    const candidate = `${base}-r${index}`
    if (!(await git.branchExists(candidate))) return candidate
  }
}

function running(file: Ledger.File, planID: string) {
  return Object.values(file.tasks).filter((task) => task.planID === planID && task.status === "进行中").length
}

function ready(file: Ledger.File, task: Ledger.Task) {
  return task.deps.every((dep) => file.tasks[dep]?.status === "已合入")
}

function requireMembers(file: Ledger.File, plan: Ledger.Plan, ids: readonly string[]) {
  const invalid = ids.filter((id) => {
    const task = file.tasks[id]
    return !task || task.planID !== plan.planID
  })
  if (invalid.length > 0)
    throw new Error(`这些任务不属于批次「${plan.planID}」：${invalid.join("、")}。不属于本批次的任务不会被派发。`)
  return [...new Set(ids)]
}
