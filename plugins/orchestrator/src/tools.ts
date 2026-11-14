export * as Tools from "./tools.js"

import type { ToolEditor } from "@opencode/plugin/promise/tool"
import { Tool } from "@opencode/schema/tool"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"
import { Ledger } from "./ledger.js"
import { Plan } from "./plan.js"

/** What the tools need from the rest of the plugin. Narrow on purpose: tests run them against a real temp ledger. */
export interface Deps {
  readonly store: Ledger.Store
  readonly now: () => string
  readonly approve: (input: { planID: string; tasks?: readonly string[] }) => Promise<{
    dispatched: string[]
    waiting: string[]
  }>
  readonly resolve: (input: {
    taskID: string
    decision: Ledger.Decision
    note?: string
  }) => Promise<{ taskID: string; status: Ledger.Status; dispatched?: boolean }>
}

export interface Caller {
  readonly sessionID: string
}

const Conflict = Schema.Struct({ a: Schema.String, b: Schema.String, path: Schema.String })
const Rejected = Schema.Struct({ id: Schema.String, reason: Schema.String })

const PlanOutput = Schema.Struct({
  planID: Schema.String,
  accepted: Schema.Array(Schema.String),
  conflicts: Schema.Array(Conflict),
  rejected: Schema.Array(Rejected),
  awaitingApproval: Schema.Literal(true),
})

const StatusInput = Schema.Struct({
  planID: optional(Schema.String).annotate({
    description: "只看这一批。省略则汇总全部批次；正常任务只进 counts，不逐条返回",
  }),
})

const StatusOutput = Schema.Struct({
  counts: Schema.Record(Ledger.Status, Schema.Int),
  anomalies: Schema.Array(Ledger.Anomaly),
})

const ApproveInput = Schema.Struct({
  planID: Schema.String.annotate({ description: "要放行的批次 ID" }),
  tasks: optional(Schema.Array(Schema.String)).annotate({
    description: "只放行这些任务。省略则放行整个就绪层（依赖已全部合入且未派发的任务）",
  }),
})

const ApproveOutput = Schema.Struct({
  dispatched: Schema.Array(Schema.String),
  waiting: Schema.Array(Schema.String),
})

const ResolveInput = Schema.Struct({
  taskID: Schema.String.annotate({ description: "要裁决的任务 ID" }),
  decision: Ledger.Decision.annotate({
    description:
      "retry：失败任务重做，保留批准并立即重派；merged：已核任务合入，解锁下游；unblock：阻塞任务回到待派；abandon：放弃，下游标阻塞；accept：越过验收失败直接进入已核，必须带 note",
  }),
  note: optional(Schema.String).annotate({ description: "写进台账供审计；accept 时必填" }),
})

const ResolveOutput = Schema.Struct({
  taskID: Schema.String,
  status: Ledger.Status,
  dispatched: optional(Schema.Boolean),
})

export function register(editor: ToolEditor, deps: Deps) {
  editor.namespace({
    name: "orchestrator",
    description:
      "确定性任务编排：台账、依赖判断、派发、收回结构化结果、跑机械核对。工具不做任何判断，异常只报告不自动处理。",
  })

  editor.add({
    name: "plan",
    description:
      "提交一批任务图。校验 ID、依赖环与路径冲突后写台账，所有任务从「待派」开始，不派发，等 approve。重复提交同一 planID 且输入一致是幂等的。",
    input: Plan.Input,
    output: PlanOutput,
    options: { namespace: "orchestrator", permission: "orchestrator", codemode: true },
    execute: (input, context) => guard(() => plan(deps, input, context)),
  })

  editor.add({
    name: "status",
    description:
      "看批次进度：正常任务只给计数，异常逐条列出（任务 ID、类型、≤200 字说明、起始时间）。anomalies 为空表示无异常。",
    input: StatusInput,
    output: StatusOutput,
    options: { namespace: "orchestrator", permission: "orchestrator", codemode: true },
    execute: (input) => guard(() => status(deps, input)),
  })

  editor.add({
    name: "approve",
    description:
      "放行任务并按并发上限立即派发。省略 tasks 时放行整个就绪层。返回已派发与仍在等待的任务 ID；派发失败的任务回滚到待派并进异常。",
    input: ApproveInput,
    output: ApproveOutput,
    options: { namespace: "orchestrator", permission: "orchestrator", codemode: true },
    execute: (input) =>
      guard(async () => {
        const result = await deps.approve({ planID: input.planID, tasks: input.tasks })
        return {
          output: result,
          content: `已派发 ${result.dispatched.length} 个：${result.dispatched.join("、") || "（无）"}；等待 ${result.waiting.length} 个：${result.waiting.join("、") || "（无）"}`,
        }
      }),
  })

  editor.add({
    name: "resolve",
    description:
      "对一个任务做出裁决：retry / merged / unblock / abandon / accept。状态不匹配或缺 note 会直接报错，不做静默忽略。",
    input: ResolveInput,
    output: ResolveOutput,
    options: { namespace: "orchestrator", permission: "orchestrator", codemode: true },
    execute: (input) =>
      guard(async () => {
        const result = await deps.resolve({ taskID: input.taskID, decision: input.decision, note: input.note })
        return {
          output: result,
          content: `任务 ${result.taskID} 现在是「${result.status}」${result.dispatched ? "，已重新派发" : ""}。`,
        }
      }),
  })
}

async function plan(deps: Deps, input: Plan.Input, context: Caller) {
  const prepared = Plan.prepare(input)
  const existing = (await deps.store.read()).plans[prepared.planID]
  if (existing) {
    const archived = await deps.store.readPlan(prepared.planID)
    if (archived !== undefined && canonical(comparable(archived)) !== canonical(comparable(input)))
      throw new Tool.Error({
        message: `planID「${prepared.planID}」已经提交过且输入不同。换一个 planID，不要复用已有批次。`,
      })
    // The ledger is the authority for what was accepted and in which order; the archive only proves the input.
    return output({ ...prepared, accepted: existing.tasks })
  }

  const at = deps.now()
  await deps.store.update((file) => {
    // A concurrent second call may have written the plan between the read above and this update.
    if (file.plans[prepared.planID]) return
    file.plans[prepared.planID] = {
      planID: prepared.planID,
      base: prepared.base,
      concurrency: prepared.concurrency,
      pmSessionID: context.sessionID,
      createdAt: at,
      tasks: [...prepared.accepted],
    }
    for (const task of prepared.tasks) {
      file.tasks[task.id] = {
        id: task.id,
        planID: prepared.planID,
        title: task.title,
        deps: [...task.deps],
        allowPaths: [...task.allowPaths],
        verify: [...task.verify],
        status: "待派",
        updatedAt: at,
      }
    }
  })
  await deps.store.writePlan(prepared.planID, input)
  return output(prepared)
}

function output(prepared: Plan.Prepared) {
  return {
    output: {
      planID: prepared.planID,
      accepted: [...prepared.accepted],
      conflicts: prepared.conflicts.map((item) => ({ ...item })),
      rejected: prepared.rejected.map((item) => ({ ...item })),
      awaitingApproval: true as const,
    },
    content: describePlan(prepared),
  }
}

function describePlan(prepared: Plan.Prepared) {
  const lines = [`批次 ${prepared.planID}：接收 ${prepared.accepted.length} 个任务，等待 approve。`]
  if (prepared.rejected.length > 0)
    lines.push(`被拒 ${prepared.rejected.length} 个：${prepared.rejected.map((item) => `${item.id}（${item.reason}）`).join("；")}`)
  if (prepared.conflicts.length > 0)
    lines.push(
      `路径冲突 ${prepared.conflicts.length} 对，不会自动串行化：${prepared.conflicts.map((item) => `${item.a}×${item.b} @ ${item.path}`).join("；")}`,
    )
  return lines.join("\n")
}

async function status(deps: Deps, input: { planID?: string }) {
  const file = await deps.store.read()
  if (input.planID !== undefined && !file.plans[input.planID]) {
    const known = Object.keys(file.plans).join("、") || "（无）"
    throw new Tool.Error({ message: `没有 planID「${input.planID}」。已有批次：${known}。` })
  }

  const tasks = Object.values(file.tasks).filter((task) => input.planID === undefined || task.planID === input.planID)
  const counts = Object.fromEntries(Ledger.STATUSES.map((key) => [key, 0])) as Record<Ledger.Status, number>
  for (const task of tasks) counts[task.status] += 1

  const anomalies = file.anomalies
    .filter((item) => input.planID === undefined || file.tasks[item.taskID]?.planID === input.planID)
    .map((item) => ({ ...item, detail: item.detail.slice(0, 200) }))
    .sort((a, b) => a.since.localeCompare(b.since))

  return { output: { counts, anomalies }, content: describeStatus(counts, anomalies) }
}

function describeStatus(counts: Record<Ledger.Status, number>, anomalies: Ledger.Anomaly[]) {
  const summary = Ledger.STATUSES.map((key) => `${key} ${counts[key]}`).join(" · ")
  if (anomalies.length === 0) return `${summary}\n无异常。`
  return [summary, `异常 ${anomalies.length} 条：`, ...anomalies.map((item) => `- ${item.taskID} ${item.kind}：${item.detail}`)].join("\n")
}

/** Task order carries no meaning, so a re-submitted plan is compared with tasks keyed by ID. */
function comparable(value: unknown) {
  if (value === null || typeof value !== "object") return value
  const tasks = (value as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) return value
  return {
    ...value,
    tasks: [...tasks].sort((a, b) => {
      const left = String((a as { id?: unknown }).id)
      const right = String((b as { id?: unknown }).id)
      return left < right ? -1 : left > right ? 1 : 0
    }),
  }
}

/** Key order must not make an idempotent retry look like a different plan. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof Tool.Error) throw error
    throw new Tool.Error({ message: error instanceof Error ? error.message : String(error) })
  }
}
