import { describe, expect, test } from "bun:test"
import { Board } from "../src/board.js"
import type { Ledger } from "../src/ledger.js"

const PLANNER = "ses_planner"
const EXECUTOR_A = "ses_exec_a"
const EXECUTOR_C = "ses_exec_c"
const STRANGER = "ses_stranger"

function task(id: string, planID: string, status: Ledger.Status, extra: Partial<Ledger.Task> = {}): Ledger.Task {
  return {
    id,
    planID,
    title: `任务 ${id}`,
    deps: [],
    allowPaths: ["plugins/x"],
    verify: ["bun test"],
    status,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  }
}

function plan(planID: string, pmSessionID: string, createdAt: string, tasks: string[]): Ledger.Plan {
  return { planID, base: "lts/ocdev", concurrency: 2, pmSessionID, createdAt, tasks }
}

function ledger(): Ledger.File {
  return {
    version: 1,
    plans: {
      p1: plan("p1", PLANNER, "2026-01-01T00:00:00.000Z", ["a", "b"]),
      p2: plan("p2", PLANNER, "2026-01-01T00:10:00.000Z", ["c"]),
      other: plan("other", "ses_other", "2026-01-01T00:05:00.000Z", ["x"]),
    },
    tasks: {
      a: task("a", "p1", "进行中", {
        sessionID: EXECUTOR_A,
        branch: "task/a",
        dispatchedAt: "2026-01-01T00:01:00.000Z",
      }),
      b: task("b", "p1", "待派"),
      c: task("c", "p2", "失败", {
        sessionID: EXECUTOR_C,
        dispatchedAt: "2026-01-01T00:10:00.000Z",
      }),
      x: task("x", "other", "已合入", { sessionID: "ses_exec_x", commit: "a".repeat(40) }),
    },
    anomalies: [
      { taskID: "a", kind: "超时", detail: "第一次", since: "2026-01-01T00:02:00.000Z" },
      { taskID: "a", kind: "执行失败", detail: "第二次", since: "2026-01-01T00:03:00.000Z" },
      { taskID: "c", kind: "验收失败", detail: "bun test 退出码 1", since: "2026-01-01T00:11:00.000Z" },
    ],
  }
}

describe("看板投影", () => {
  test("planner 看到自己全部批次，并默认选中最近一个", () => {
    const state = Board.project(ledger(), PLANNER, Date.parse("2026-01-01T00:20:00.000Z"))
    expect(state.plans.map((item) => item.planID)).toEqual(["p2", "p1"])
    expect(state.plans.every((item) => item.plannerSessionID === PLANNER)).toBe(true)
    expect(state.current?.planID).toBe("p2")
    expect(state.current?.tasks.map((item) => item.id)).toEqual(["c"])
    expect(state.current?.counts["失败"]).toBe(1)
    expect(state.current?.counts["已合入"]).toBe(0)
    expect(state.current?.tasks[0]?.anomaly).toBe("bun test 退出码 1")
    expect(state.current?.tasks[0]?.elapsedMs).toBe(10 * 60_000)
  })

  test("执行者只看得到自己那一条任务，看不到兄弟任务", () => {
    const state = Board.project(ledger(), EXECUTOR_A, Date.parse("2026-01-01T00:20:00.000Z"))
    expect(state.plans.map((item) => item.planID)).toEqual(["p1"])
    expect(state.current?.planID).toBe("p1")
    expect(state.current?.tasks.map((item) => item.id)).toEqual(["a"])
    expect(state.current?.tasks.some((item) => item.id === "b")).toBe(false)
    expect(state.current?.tasks.some((item) => item.id === "c")).toBe(false)
    expect(state.current?.counts["进行中"]).toBe(1)
    expect(state.current?.counts["待派"]).toBe(0)
    expect(state.current?.tasks[0]?.sessionID).toBe(EXECUTOR_A)
    expect(state.current?.tasks[0]?.branch).toBe("task/a")
    expect(state.current?.tasks[0]?.anomaly).toBe("第二次")
    expect(state.current?.tasks[0]?.elapsedMs).toBe(19 * 60_000)
  })

  test("无关会话看到空看板", () => {
    expect(Board.project(ledger(), STRANGER, 0)).toEqual({ plans: [], current: null })
  })
})
