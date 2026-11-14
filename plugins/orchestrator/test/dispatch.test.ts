import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Dispatch } from "../src/dispatch.js"
import type { GitClient } from "../src/git.js"
import { Ledger } from "../src/ledger.js"

const at = "2026-01-01T00:00:00.000Z"

interface Calls {
  create: Array<{ directory: string; branch: string; base: string }>
  remove: Array<{ directory: string; branch: string }>
}

function fakeGit(branches: string[] = []): { git: GitClient; calls: Calls } {
  const calls: Calls = { create: [], remove: [] }
  const git: GitClient = {
    root: "/repo",
    name: "repo",
    createWorktree: async (input) => {
      calls.create.push(input)
    },
    removeWorktree: async (input) => {
      calls.remove.push(input)
    },
    head: async () => "a".repeat(40),
    branch: async () => "task/t1",
    branchExists: async (branch) => branches.includes(branch),
    changed: async () => [],
    dirtyTracked: async () => [],
    claimDirectory: (base) => base,
  }
  return { git, calls }
}

function fakeSession(failAt?: "create" | "move" | "prompt") {
  const state = {
    creates: 0,
    moved: [] as Array<{ sessionID: string; directory: string }>,
    prompts: [] as Array<{ sessionID: string; text: string }>,
    removed: [] as string[],
  }
  const session: Dispatch.SessionPort = {
    create: async () => {
      if (failAt === "create") throw new Error("建会话失败")
      state.creates += 1
      return `ses_${state.creates}`
    },
    move: async (input) => {
      if (failAt === "move") throw new Error("移动失败")
      state.moved.push(input)
    },
    prompt: async (input) => {
      if (failAt === "prompt") throw new Error("投递失败")
      state.prompts.push(input)
    },
    remove: async ({ sessionID }) => {
      state.removed.push(sessionID)
    },
  }
  return { session, state }
}

async function setup(options: { concurrency?: number; branches?: string[]; failAt?: "create" | "move" | "prompt" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "orchestrator-dispatch-"))
  const store = Ledger.createStore(directory)
  const { git, calls } = fakeGit(options.branches)
  const { session, state } = fakeSession(options.failAt)
  const ports: Dispatch.Ports = { store, git, session, worktrees: "/worktrees", now: () => at }
  const dispatcher = Dispatch.createDispatcher(ports)
  return {
    directory,
    store,
    calls,
    state,
    dispatcher,
    ports,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

async function seed(store: Ledger.Store, concurrency = 3, tasks?: Ledger.MutableTask[]) {
  await store.update((file) => {
    file.plans.p1 = {
      planID: "p1",
      base: "lts/ocdev",
      concurrency,
      pmSessionID: "ses_pm",
      createdAt: at,
      tasks: ["t1", "t2", "t3"],
    }
    for (const task of tasks ??
      ["t1", "t2", "t3"].map((id) => ({
        id,
        planID: "p1",
        title: `任务 ${id}`,
        deps: [],
        allowPaths: [`plugins/${id}`],
        verify: ["bun test"],
        status: "待派" as const,
        updatedAt: at,
      }))) {
      file.tasks[task.id] = task
    }
  })
}

describe("派发", () => {
  test("成功派发写齐字段、生成任务书并清掉旧异常", async () => {
    const { store, calls, state, dispatcher, cleanup } = await setup()
    try {
      await seed(store)
      await store.update((file) => {
        file.anomalies.push({ taskID: "t1", kind: "执行失败", detail: "上次失败", since: at })
      })
      const result = await dispatcher.approve({ planID: "p1", tasks: ["t1"] })
      expect(result).toEqual({ dispatched: ["t1"], waiting: [] })

      const task = (await store.read()).tasks.t1!
      expect(task.status).toBe("进行中")
      expect(task.sessionID).toBe("ses_1")
      expect(task.branch).toBe("task/t1")
      expect(task.worktree).toBe("/worktrees/repo-t1")
      expect(task.dispatchedAt).toBe(at)
      expect(task.approvedAt).toBe(at)

      expect(calls.create).toEqual([{ directory: "/worktrees/repo-t1", branch: "task/t1", base: "lts/ocdev" }])
      expect(state.moved).toEqual([{ sessionID: "ses_1", directory: "/worktrees/repo-t1" }])
      expect(state.prompts[0]?.text).toContain("/results/p1/t1.json")
      expect(state.prompts[0]?.text).toContain("`ses_pm`")
      expect((await store.read()).anomalies).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("并发上限按 plan 计数，多余进 waiting", async () => {
    const { store, dispatcher, cleanup } = await setup({ concurrency: 2 })
    try {
      await seed(store, 2)
      const result = await dispatcher.approve({ planID: "p1" })
      expect(result.dispatched).toEqual(["t1", "t2"])
      expect(result.waiting).toEqual(["t3"])
    } finally {
      await cleanup()
    }
  })

  test("依赖未合入的任务只记批准，不派发", async () => {
    const { store, dispatcher, calls, cleanup } = await setup()
    try {
      await seed(store)
      await store.update((file) => {
        file.tasks.t2!.deps = ["t1"]
      })
      const result = await dispatcher.approve({ planID: "p1", tasks: ["t2"] })
      expect(result).toEqual({ dispatched: [], waiting: ["t2"] })
      expect((await store.read()).tasks.t2?.approvedAt).toBe(at)
      expect(calls.create).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("派发失败回滚到待派、删会话与 worktree、记异常且保留批准", async () => {
    const { store, dispatcher, calls, state, cleanup } = await setup({ failAt: "move" })
    try {
      await seed(store)
      const result = await dispatcher.approve({ planID: "p1", tasks: ["t1"] })
      expect(result).toEqual({ dispatched: [], waiting: ["t1"] })

      const file = await store.read()
      const task = file.tasks.t1!
      expect(task.status).toBe("待派")
      expect(task.sessionID).toBeUndefined()
      expect(task.branch).toBeUndefined()
      expect(task.worktree).toBeUndefined()
      expect(task.approvedAt).toBe(at)
      expect(file.anomalies[0]).toMatchObject({ taskID: "t1", kind: "执行失败" })
      expect(file.anomalies[0]?.detail).toContain("派发失败：移动失败")
      expect(state.removed).toEqual(["ses_1"])
      expect(calls.remove).toEqual([{ directory: "/worktrees/repo-t1", branch: "task/t1" }])
    } finally {
      await cleanup()
    }
  })

  test("build 失败也要把异常写进台账", async () => {
    const { store, dispatcher, cleanup } = await setup({ failAt: "create" })
    try {
      await seed(store)
      await dispatcher.approve({ planID: "p1", tasks: ["t1"] })
      expect((await store.read()).anomalies[0]?.detail).toContain("建会话失败")
    } finally {
      await cleanup()
    }
  })

  test("指定不属于本批次的任务直接报错，一次列全", async () => {
    const { store, dispatcher, cleanup } = await setup()
    try {
      await seed(store)
      await expect(dispatcher.approve({ planID: "p1", tasks: ["t1", "ghost", "t9"] })).rejects.toThrow(
        "不属于批次「p1」：ghost、t9",
      )
    } finally {
      await cleanup()
    }
  })
})

describe("重试分支", () => {
  test("已有分支时改用 -r<n>，不在旧分支续写", async () => {
    const git = fakeGit(["task/t1", "task/t1-r2"]).git
    expect(await Dispatch.nextBranch(git, "t1")).toBe("task/t1-r3")
    expect(await Dispatch.nextBranch(fakeGit().git, "t1")).toBe("task/t1")
  })

  test("dispatchTask 对不存在的任务返回失败而不是抛错", async () => {
    const { store, dispatcher, cleanup } = await setup()
    try {
      await seed(store)
      expect(await dispatcher.dispatchTask("ghost")).toMatchObject({ ok: false, error: "任务 ghost 不在台账里" })
    } finally {
      await cleanup()
    }
  })
})
