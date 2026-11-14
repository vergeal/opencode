import { describe, expect, test } from "bun:test"
import { Plan } from "../src/plan.js"

const base = { planID: "p1", base: "lts/ocdev" }

function tasks(...items: Array<Partial<Plan.TaskInput> & { id: string }>): Plan.TaskInput[] {
  return items.map((item) => ({
    title: item.title ?? `任务 ${item.id}`,
    allowPaths: item.allowPaths ?? [`plugins/${item.id}`],
    verify: item.verify ?? ["bun test"],
    ...item,
  }))
}

describe("路径", () => {
  test("规范化去掉多余分隔符，拒绝越界写法", () => {
    expect(Plan.normalizePath(" plugins//x/ ")).toBe("plugins/x")
    expect(Plan.normalizePath("./src/a")).toBe("src/a")
    expect(() => Plan.normalizePath("/abs")).toThrow(Plan.PlanError)
    expect(() => Plan.normalizePath("../up")).toThrow(Plan.PlanError)
    expect(() => Plan.normalizePath("a/../../b")).toThrow(Plan.PlanError)
    expect(() => Plan.normalizePath("~/x")).toThrow(Plan.PlanError)
    expect(() => Plan.normalizePath("   ")).toThrow(Plan.PlanError)
  })

  test("前缀相同或互相包含才算重叠，兄弟路径不算", () => {
    expect(Plan.overlap("src/a", "src/a")).toBe("src/a")
    expect(Plan.overlap("src/a", "src/a/b")).toBe("src/a/b")
    expect(Plan.overlap("src/a/b", "src/a")).toBe("src/a/b")
    expect(Plan.overlap("src/a", "src/ab")).toBeUndefined()
    expect(Plan.overlap("src/a", "src/b")).toBeUndefined()
  })
})

describe("prepare", () => {
  test("接受合法任务并补齐默认并发", () => {
    const plan = Plan.prepare({
      ...base,
      tasks: tasks({ id: "t1" }, { id: "t2", deps: ["t1"] }),
    })
    expect(plan.accepted).toEqual(["t1", "t2"])
    expect(plan.concurrency).toBe(3)
    expect(plan.rejected).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  test("重复 ID 只保留第一次出现，并给出原因", () => {
    const plan = Plan.prepare({ ...base, tasks: tasks({ id: "t1" }, { id: "t1" }) })
    expect(plan.accepted).toEqual(["t1"])
    expect(plan.rejected).toEqual([{ id: "t1", reason: "任务 ID 重复" }])
  })

  test("非法 ID、空标题、空 allowPaths 都进 rejected", () => {
    const plan = Plan.prepare({
      ...base,
      tasks: tasks({ id: "-bad" }, { id: "t2", title: " " }, { id: "t3", allowPaths: [] }),
    })
    expect(plan.accepted).toEqual([])
    expect(plan.rejected.map((item) => item.id)).toEqual(["-bad", "t2", "t3"])
  })

  test("依赖不存在的任务直接拒绝，依赖被拒的任务级联拒绝", () => {
    const plan = Plan.prepare({
      ...base,
      tasks: tasks({ id: "t1", deps: ["ghost"] }, { id: "t2", deps: ["t1"] }),
    })
    expect(plan.accepted).toEqual([])
    expect(plan.rejected).toEqual([
      { id: "t1", reason: "deps 引用了不存在的任务：ghost" },
      { id: "t2", reason: "依赖未通过校验：t1" },
    ])
  })

  test("环上的任务全部拒绝，环外的依赖者级联拒绝", () => {
    const plan = Plan.prepare({
      ...base,
      tasks: tasks({ id: "a", deps: ["b"] }, { id: "b", deps: ["a"] }, { id: "c" }),
    })
    expect(plan.rejected.map((item) => item.id)).toEqual(["a", "b"])
    expect(plan.rejected[0]?.reason).toContain("依赖环：a → b → a")
    expect(plan.accepted).toEqual(["c"])
  })

  test("自依赖与空 dep 被拒绝", () => {
    const plan = Plan.prepare({ ...base, tasks: tasks({ id: "t1", deps: ["t1"] }, { id: "t2", deps: [" "] }) })
    expect(plan.rejected).toEqual([
      { id: "t1", reason: "任务不能依赖自己" },
      { id: "t2", reason: "deps 里有空 ID" },
    ])
  })

  test("可能同时就绪的任务才报路径冲突", () => {
    const plan = Plan.prepare({
      ...base,
      tasks: tasks(
        { id: "t1", allowPaths: ["src/a"] },
        { id: "t2", allowPaths: ["src/a/b"] },
        { id: "t3", allowPaths: ["src/ab"] },
        { id: "t4", allowPaths: ["src/a"], deps: ["t1"] },
      ),
    })
    expect(plan.conflicts).toEqual([
      { a: "t1", b: "t2", path: "src/a/b" },
      { a: "t2", b: "t4", path: "src/a/b" },
    ])
  })

  test("planID 与并发非法时直接抛错，不产生半份结果", () => {
    expect(() => Plan.prepare({ ...base, planID: " ", tasks: tasks({ id: "t1" }) })).toThrow("planID")
    expect(() => Plan.prepare({ ...base, planID: "a/b", tasks: tasks({ id: "t1" }) })).toThrow("planID")
    expect(() => Plan.prepare({ ...base, tasks: [] })).toThrow("tasks 不能为空")
    expect(() => Plan.prepare({ ...base, tasks: tasks({ id: "t1" }), concurrency: 9 })).toThrow("concurrency")
    expect(() => Plan.prepare({ ...base, tasks: tasks({ id: "t1" }), concurrency: 0 })).toThrow("concurrency")
    expect(() => Plan.prepare({ ...base, base: " ", tasks: tasks({ id: "t1" }) })).toThrow("base")
  })

  test("依赖链上的任务不算冲突", () => {
    const plan = Plan.prepare({
      ...base,
      tasks: tasks(
        { id: "t1", allowPaths: ["src"] },
        { id: "t2", allowPaths: ["src/a"], deps: ["t1"] },
      ),
    })
    expect(plan.conflicts).toEqual([])
  })
})
