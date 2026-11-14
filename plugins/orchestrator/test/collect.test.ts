import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Collect } from "../src/collect.js"
import type { GitClient } from "../src/git.js"
import { Ledger } from "../src/ledger.js"

const at = "2026-01-01T00:00:00.000Z"
const commit = "a".repeat(40)

interface GitOptions {
  readonly head?: string
  readonly changed?: readonly string[]
  readonly dirty?: readonly string[]
  /** Makes every git read throw, which is what a removed worktree looks like. */
  readonly error?: string
}

function fakeGit(options: GitOptions = {}): GitClient {
  const guard = () => {
    if (options.error) throw new Error(options.error)
  }
  return {
    root: "/repo",
    name: "repo",
    createWorktree: async () => undefined,
    removeWorktree: async () => undefined,
    head: async () => {
      guard()
      return options.head ?? commit
    },
    branch: async () => "task/t1",
    branchExists: async () => false,
    changed: async () => {
      guard()
      return [...(options.changed ?? [])]
    },
    dirtyTracked: async () => {
      guard()
      return [...(options.dirty ?? [])]
    },
    claimDirectory: (base) => base,
  }
}

async function setup(options: { git?: GitOptions; verify?: readonly string[] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "orchestrator-collect-"))
  const worktree = join(root, "wt")
  await mkdir(worktree)
  const store = Ledger.createStore(root)
  const notes: string[] = []
  const resumed: string[] = []
  const ports: Collect.Ports = {
    store,
    git: fakeGit(options.git),
    now: () => at,
    verifyTimeoutMs: 10_000,
    resume: async (planID) => {
      resumed.push(planID)
      return ["t1"]
    },
    notify: async (text) => {
      notes.push(text)
    },
  }
  const base = {
    planID: "p1",
    title: "任务",
    deps: [] as string[],
    allowPaths: ["plugins/x"],
    verify: [...(options.verify ?? ["true"])],
    status: "进行中" as Ledger.Status,
    updatedAt: at,
    branch: "task/t1",
    worktree,
    approvedAt: at,
  }
  return { root, worktree, store, ports, notes, resumed, cleanup: () => rm(root, { recursive: true, force: true }), base }
}

function task(id: string, overrides: Partial<Ledger.MutableTask> = {}): Ledger.MutableTask {
  return {
    id,
    planID: "p1",
    title: `任务 ${id}`,
    deps: [],
    allowPaths: ["plugins/x"],
    verify: ["true"],
    status: "进行中",
    updatedAt: at,
    branch: `task/${id}`,
    worktree: "/wt",
    ...overrides,
  }
}

async function seed(store: Ledger.Store, tasks: Ledger.MutableTask[]) {
  await store.update((file) => {
    file.plans.p1 = { planID: "p1", base: "lts/ocdev", concurrency: 3, createdAt: at, tasks: tasks.map((item) => item.id) }
    for (const item of tasks) file.tasks[item.id] = item
  })
}

function result(taskID: string, overrides: Record<string, unknown> = {}) {
  return {
    task: taskID,
    branch: `task/${taskID}`,
    commit,
    changed: ["plugins/x/a.ts"],
    verify: "通过",
    ...overrides,
  }
}

describe("parseResult", () => {
  const shape = { id: "t1", branch: "task/t1" }

  test("结构完整时接受", () => {
    expect(Collect.parseResult(result("t1"), shape)).toEqual({ ok: true, value: result("t1") })
  })

  test("非对象、字段缺失、类型不符都给出具体原因", () => {
    const cases: Array<[unknown, string]> = [
      [null, "结果文件不是 JSON 对象"],
      [[], "结果文件不是 JSON 对象"],
      ["x", "结果文件不是 JSON 对象"],
      [{}, "缺少 task 字段"],
      [result("t9"), "task 字段是「t9」，应为「t1」"],
      [{ ...result("t1"), branch: 3 }, "缺少 branch 字段"],
      [result("t1", { branch: "task/other" }), "branch 字段是「task/other」，应为「task/t1」"],
      [result("t1", { commit: "abc" }), "commit 必须是 40 位小写 sha"],
      [result("t1", { commit: "A".repeat(40) }), "commit 必须是 40 位小写 sha"],
      [result("t1", { changed: "x" }), "changed 必须是字符串数组"],
      [result("t1", { changed: [1] }), "changed 必须是字符串数组"],
      [result("t1", { verify: null }), "缺少 verify 字段"],
    ]
    for (const [value, reason] of cases) expect(Collect.parseResult(value, shape)).toEqual({ ok: false, reason })
  })
})

describe("collect 的机械核对", () => {
  test("全部通过：进行中 → 已回传 → 已核，commit 落账并清异常", async () => {
    const { store, ports, base, worktree, cleanup } = await setup()
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      await store.update((file) => {
        file.anomalies.push({ taskID: "t1", kind: "验收失败", detail: "上次", since: at })
      })
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))

      expect(await Collect.collect(ports, "t1")).toEqual({ status: "checked" })
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("已核")
      expect(file.tasks.t1?.commit).toBe(commit)
      expect(file.anomalies).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("结果文件还没出现：停在已回传，不算异常", async () => {
    const { store, ports, base, worktree, cleanup } = await setup()
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      expect(await Collect.collect(ports, "t1")).toEqual({ status: "missing" })
      expect((await store.read()).tasks.t1?.status).toBe("已回传")
    } finally {
      await cleanup()
    }
  })

  test("结果不是合法 JSON：失败 + 结果缺失，不通知", async () => {
    const { store, ports, base, worktree, notes, cleanup } = await setup()
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      await Bun.write(store.resultPath("p1", "t1"), "{ nope")
      expect(await Collect.collect(ports, "t1")).toMatchObject({ status: "failed", kind: "结果缺失" })
      expect((await store.read()).tasks.t1?.status).toBe("失败")
      expect(notes).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("结果里的 commit 不是 HEAD：失败 + 结果缺失", async () => {
    const { store, ports, base, worktree, cleanup } = await setup({ git: { head: "b".repeat(40) } })
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      const outcome = await Collect.collect(ports, "t1")
      expect(outcome).toMatchObject({ status: "failed", kind: "结果缺失" })
      expect((await store.read()).anomalies[0]?.detail).toContain("不是 HEAD")
    } finally {
      await cleanup()
    }
  })

  test("改到 allowPaths 之外：失败 + 范围越界 + 通知", async () => {
    const { store, ports, base, worktree, notes, cleanup } = await setup({
      git: { changed: ["plugins/x/a.ts", "packages/core/src/a.ts"] },
    })
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      expect(await Collect.collect(ports, "t1")).toMatchObject({ status: "failed", kind: "范围越界" })
      expect((await store.read()).anomalies[0]?.detail).toContain("packages/core/src/a.ts")
      expect(notes).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  test("有已跟踪文件未提交：失败 + 范围越界", async () => {
    const { store, ports, base, worktree, cleanup } = await setup({ git: { dirty: ["M plugins/x/a.ts"] } })
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      expect(await Collect.collect(ports, "t1")).toMatchObject({ status: "failed", kind: "范围越界" })
      expect((await store.read()).anomalies[0]?.detail).toContain("未提交")
    } finally {
      await cleanup()
    }
  })

  test("verify 非零退出：失败 + 验收失败 + 通知，detail 带退出码与末尾输出", async () => {
    const { store, ports, base, worktree, notes, cleanup } = await setup({ verify: ["echo boom && exit 3"] })
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      expect(await Collect.collect(ports, "t1")).toMatchObject({ status: "failed", kind: "验收失败" })
      const detail = (await store.read()).anomalies[0]?.detail ?? ""
      expect(detail).toContain("退出码 3")
      expect(detail).toContain("boom")
      expect(notes).toHaveLength(1)
    } finally {
      await cleanup()
    }
  })

  test("git 读不出来（worktree 没了）：失败 + 结果缺失", async () => {
    const { store, ports, base, worktree, cleanup } = await setup({ git: { error: "no such directory" } })
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      const outcome = await Collect.collect(ports, "t1")
      expect(outcome).toMatchObject({ status: "failed", kind: "结果缺失" })
      expect((await store.read()).anomalies[0]?.detail).toContain("git 核对失败")
    } finally {
      await cleanup()
    }
  })

  test("不在进行中或已回传的任务直接忽略", async () => {
    const { store, ports, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { status: "待派" })])
      expect(await Collect.collect(ports, "t1")).toEqual({ status: "ignored" })
      expect(await Collect.collect(ports, "ghost")).toEqual({ status: "ignored" })
    } finally {
      await cleanup()
    }
  })
})

describe("停顿与失联", () => {
  test("宽限期到了仍在等进行中：markMissing 记为失败与结果缺失", async () => {
    const { store, ports, base, worktree, cleanup } = await setup()
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      expect(await Collect.markMissing(ports, "t1")).toMatchObject({ status: "failed", kind: "结果缺失" })
      expect((await store.read()).tasks.t1?.status).toBe("失败")
    } finally {
      await cleanup()
    }
  })

  test("执行失败事件：失败 + 执行失败", async () => {
    const { store, ports, base, worktree, cleanup } = await setup()
    try {
      await seed(store, [{ ...base, id: "t1", worktree }])
      expect(await Collect.markExecutionFailed(ports, "t1", "会话退出码 1")).toMatchObject({
        status: "failed",
        kind: "执行失败",
      })
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("失败")
      expect(file.anomalies[0]?.detail).toBe("会话退出码 1")
    } finally {
      await cleanup()
    }
  })
})

describe("resolve", () => {
  test("retry：保留批准、清空上一次的会话与分支、立即重派", async () => {
    const { store, ports, resumed, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { status: "失败", approvedAt: at, sessionID: "ses_old", commit }), task("t2")])
      const outcome = await Collect.resolve(ports, { taskID: "t1", decision: "retry", note: "重做" })
      expect(outcome).toEqual({ taskID: "t1", status: "待派", dispatched: true })
      const current = (await store.read()).tasks.t1!
      expect(current.status).toBe("待派")
      expect(current.approvedAt).toBe(at)
      expect(current.sessionID).toBeUndefined()
      expect(current.branch).toBeUndefined()
      expect(current.worktree).toBeUndefined()
      expect(current.commit).toBeUndefined()
      expect(current.note).toBe("重做")
      expect(resumed).toEqual(["p1"])
    } finally {
      await cleanup()
    }
  })

  test("merged：已核 → 已合入", async () => {
    const { store, ports, resumed, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { status: "已核", commit })])
      const outcome = await Collect.resolve(ports, { taskID: "t1", decision: "merged" })
      expect(outcome).toEqual({ taskID: "t1", status: "已合入" })
      expect(resumed).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("unblock：阻塞 → 待派", async () => {
    const { store, ports, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { status: "阻塞" })])
      expect(await Collect.resolve(ports, { taskID: "t1", decision: "unblock" })).toEqual({
        taskID: "t1",
        status: "待派",
      })
    } finally {
      await cleanup()
    }
  })

  test("abandon：任务转失败，下游全部阻塞并各记一条异常", async () => {
    const { store, ports, cleanup } = await setup()
    try {
      await seed(store, [
        task("t1", { status: "已回传" }),
        task("t2", { deps: ["t1"] }),
        task("t3", { deps: ["t2"] }),
        task("t4"),
      ])
      const outcome = await Collect.resolve(ports, { taskID: "t1", decision: "abandon", note: "方案作废" })
      expect(outcome).toEqual({ taskID: "t1", status: "失败" })
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("失败")
      expect(file.tasks.t1?.note).toBe("方案作废")
      expect(file.tasks.t2?.status).toBe("阻塞")
      expect(file.tasks.t3?.status).toBe("阻塞")
      expect(file.tasks.t4?.status).toBe("进行中")
      expect(file.anomalies.map((item) => `${item.taskID}:${item.kind}`)).toEqual(["t2:阻塞", "t3:阻塞"])
    } finally {
      await cleanup()
    }
  })

  test("accept：失败 → 已核，必须带 note", async () => {
    const { store, ports, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { status: "失败" })])
      await expect(Collect.resolve(ports, { taskID: "t1", decision: "accept", note: "  " })).rejects.toThrow(
        "必须带 note",
      )
      expect(await Collect.resolve(ports, { taskID: "t1", decision: "accept", note: "瑕疵可接受" })).toEqual({
        taskID: "t1",
        status: "已核",
      })
      expect((await store.read()).tasks.t1?.note).toBe("瑕疵可接受")
    } finally {
      await cleanup()
    }
  })

  test("状态不匹配或任务不存在时直接报错，不静默忽略", async () => {
    const { store, ports, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { status: "待派" })])
      await expect(Collect.resolve(ports, { taskID: "t1", decision: "merged" })).rejects.toThrow(
        "现在是「待派」，不能 merged",
      )
      await expect(Collect.resolve(ports, { taskID: "ghost", decision: "retry" })).rejects.toThrow("不在台账里")
      expect((await store.read()).tasks.t1?.status).toBe("待派")
    } finally {
      await cleanup()
    }
  })
})

describe("downstream", () => {
  test("返回直接与间接依赖它的任务，不跨批次", async () => {
    const { store, cleanup } = await setup()
    try {
      await seed(store, [
        task("t1"),
        task("t2", { deps: ["t1"] }),
        task("t3", { deps: ["t2"] }),
        task("t4"),
      ])
      await store.update((file) => {
        file.plans.p2 = { planID: "p2", base: "lts/ocdev", concurrency: 1, createdAt: at, tasks: ["x1"] }
        file.tasks.x1 = task("x1", { planID: "p2", deps: ["t1"] })
      })
      expect(Collect.downstream(await store.read(), "t1")).toEqual(["t2", "t3"])
      expect(Collect.downstream(await store.read(), "t3")).toEqual([])
    } finally {
      await cleanup()
    }
  })
})
