import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Collect } from "../src/collect.js"
import type { GitClient } from "../src/git.js"
import { Ledger } from "../src/ledger.js"
import { Watch } from "../src/watch.js"

const commit = "a".repeat(40)
const start = "2026-01-01T00:00:00.000Z"

function fakeGit(): GitClient {
  return {
    root: "/repo",
    name: "repo",
    createWorktree: async () => undefined,
    removeWorktree: async () => undefined,
    head: async () => commit,
    branch: async () => "task/t1",
    branchExists: async () => false,
    changed: async () => [],
    dirtyTracked: async () => [],
    claimDirectory: (base) => base,
  }
}

async function setup(options: { alive?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "orchestrator-watch-"))
  const worktree = join(root, "wt")
  await mkdir(worktree)
  const store = Ledger.createStore(root)
  const clock = { at: start }
  const calls: string[] = []
  const collect: Collect.Ports = {
    store,
    git: fakeGit(),
    now: () => clock.at,
    verifyTimeoutMs: 10_000,
    resume: async () => [],
  }
  const ports: Watch.Ports = {
    store,
    sessions: { alive: async () => options.alive ?? true },
    now: () => clock.at,
    graceMs: 60_000,
    timeoutMs: 7_200_000,
    collect: async (id) => {
      calls.push(`collect:${id}`)
      return Collect.collect(collect, id)
    },
    markMissing: async (id) => {
      calls.push(`missing:${id}`)
      return Collect.markMissing(collect, id)
    },
    markExecutionFailed: async (id, detail, kind) => {
      calls.push(`failed:${id}:${kind}`)
      return Collect.markExecutionFailed(collect, id, detail, kind)
    },
    sleep: async () => {
      await Promise.resolve()
    },
  }
  return { root, worktree, store, clock, calls, ports, cleanup: () => rm(root, { recursive: true, force: true }) }
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
    updatedAt: start,
    approvedAt: start,
    dispatchedAt: start,
    sessionID: `ses_${id}`,
    branch: `task/${id}`,
    worktree: "/wt",
    ...overrides,
  }
}

async function seed(store: Ledger.Store, tasks: Ledger.MutableTask[]) {
  await store.update((file) => {
    file.plans.p1 = { planID: "p1", base: "lts/ocdev", concurrency: 8, createdAt: start, tasks: tasks.map((item) => item.id) }
    for (const item of tasks) file.tasks[item.id] = item
  })
}

function result(taskID: string) {
  return { task: taskID, branch: `task/${taskID}`, commit, changed: ["plugins/x/a.ts"], verify: "通过" }
}

describe("事件", () => {
  test("succeeded 等宽限期后收取结果并核对", async () => {
    const { store, ports, worktree, calls, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree })])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      await Watch.handle(ports, { type: "session.execution.succeeded", sessionID: "ses_t1" })
      expect(calls).toEqual(["collect:t1"])
      expect((await store.read()).tasks.t1?.status).toBe("已核")
    } finally {
      await cleanup()
    }
  })

  test("succeeded 后结果文件仍未出现：宽限到期才记结果缺失", async () => {
    const { store, ports, worktree, calls, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree })])
      await Watch.handle(ports, { type: "session.execution.succeeded", sessionID: "ses_t1" })
      expect(calls).toEqual(["collect:t1", "missing:t1"])
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("失败")
      expect(file.anomalies[0]?.kind).toBe("结果缺失")
    } finally {
      await cleanup()
    }
  })

  test("failed 记执行失败，detail 取错误消息", async () => {
    const { store, ports, worktree, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree })])
      await Watch.handle(ports, {
        type: "session.execution.failed",
        sessionID: "ses_t1",
        error: { _tag: "SessionError", message: "provider 429" },
      })
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("失败")
      expect(file.anomalies[0]).toMatchObject({ kind: "执行失败", detail: "provider 429" })
    } finally {
      await cleanup()
    }
  })

  test("用户主动中断不动任务，其他原因算会话失联", async () => {
    const { store, ports, worktree, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree })])
      await Watch.handle(ports, { type: "session.execution.interrupted", sessionID: "ses_t1", reason: "user" })
      expect((await store.read()).tasks.t1?.status).toBe("进行中")

      await Watch.handle(ports, { type: "session.execution.interrupted", sessionID: "ses_t1", reason: "shutdown" })
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("失败")
      expect(file.anomalies[0]?.kind).toBe("会话失联")
    } finally {
      await cleanup()
    }
  })

  test("idle 只作兜底：结果文件已在就收取，否则等 succeeded 或巡检", async () => {
    const { store, ports, worktree, calls, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree })])
      await Watch.handle(ports, { type: "session.idle", sessionID: "ses_t1" })
      expect(calls).toEqual([])

      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      await Watch.handle(ports, { type: "session.idle", sessionID: "ses_t1" })
      expect(calls).toEqual(["collect:t1"])
    } finally {
      await cleanup()
    }
  })

  test("不认识或已重新派发的会话一律忽略", async () => {
    const { store, ports, worktree, calls, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree, sessionID: "ses_new" })])
      await Watch.handle(ports, { type: "session.execution.succeeded", sessionID: "ses_old" })
      await Watch.handle(ports, { type: "session.execution.failed", sessionID: "ses_ghost" })
      expect(calls).toEqual([])
      expect((await store.read()).tasks.t1?.status).toBe("进行中")
    } finally {
      await cleanup()
    }
  })
})

describe("巡检", () => {
  test("会话已不存在：失败 + 会话失联", async () => {
    const { store, ports, worktree, cleanup } = await setup({ alive: false })
    try {
      await seed(store, [task("t1", { worktree })])
      expect(await Watch.sweep(ports)).toMatchObject({ lost: ["t1"] })
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("失败")
      expect(file.anomalies[0]?.kind).toBe("会话失联")
    } finally {
      await cleanup()
    }
  })

  test("超过 timeout：只记超时异常，任务仍在进行中", async () => {
    const { store, ports, worktree, clock, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree })])
      clock.at = "2026-01-01T03:00:00.000Z"
      expect(await Watch.sweep(ports)).toMatchObject({ timedOut: ["t1"] })
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("进行中")
      expect(file.anomalies[0]?.kind).toBe("超时")
      expect(file.anomalies[0]?.detail).toContain("180 分钟")
    } finally {
      await cleanup()
    }
  })

  test("已回传且结果缺失：宽限期到了才记缺失", async () => {
    const { store, ports, worktree, clock, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree, status: "已回传", updatedAt: start, sessionID: undefined })])
      expect(await Watch.sweep(ports)).toMatchObject({ missing: [] })
      clock.at = "2026-01-01T00:02:00.000Z"
      expect(await Watch.sweep(ports)).toMatchObject({ missing: ["t1"] })
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("失败")
      expect(file.anomalies[0]?.kind).toBe("结果缺失")
    } finally {
      await cleanup()
    }
  })

  test("已回传且结果存在：巡检不动它，交给 reconcile", async () => {
    const { store, ports, worktree, clock, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree, status: "已回传", sessionID: undefined })])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      clock.at = "2026-01-01T01:00:00.000Z"
      expect(await Watch.sweep(ports)).toMatchObject({ missing: [] })
      expect((await store.read()).tasks.t1?.status).toBe("已回传")
    } finally {
      await cleanup()
    }
  })

  test("reconcile 先把已回传的任务核完，再巡检", async () => {
    const { store, ports, worktree, clock, cleanup } = await setup({ alive: false })
    try {
      await seed(store, [
        task("t1", { worktree, status: "已回传", sessionID: undefined }),
        task("t2", { worktree, status: "进行中", sessionID: "ses_gone" }),
      ])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      clock.at = "2026-01-01T00:10:00.000Z"
      expect(await Watch.reconcile(ports)).toEqual(["t1"])
      const file = await store.read()
      expect(file.tasks.t1?.status).toBe("已核")
      expect(file.tasks.t2?.status).toBe("失败")
    } finally {
      await cleanup()
    }
  })
})

describe("订阅", () => {
  test("start 消费事件流，stop 后不再处理", async () => {
    const { store, ports, worktree, calls, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree })])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))

      const list: Watch.Event[] = [{ type: "session.execution.succeeded", sessionID: "ses_t1" }]
      const runner = Watch.start(ports, () => stream(list), { sweepMs: 60_000 })
      await waitFor(() => calls.length > 0)
      await runner.stop()

      calls.length = 0
      await Bun.sleep(20)
      expect(calls).toEqual([])
      expect((await store.read()).tasks.t1?.status).toBe("已核")
    } finally {
      await cleanup()
    }
  })

  test("事件处理抛错不会终止订阅", async () => {
    const { store, ports, worktree, calls, cleanup } = await setup()
    try {
      await seed(store, [task("t1", { worktree })])
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify(result("t1")))
      const errors: unknown[] = []
      const runner = Watch.start(
        { ...ports, collect: async () => {
          calls.push("boom")
          throw new Error("boom")
        } },
        () =>
          stream([
            { type: "session.execution.succeeded", sessionID: "ses_t1" },
            { type: "session.execution.succeeded", sessionID: "ses_t1" },
          ]),
        { sweepMs: 60_000, onError: (error) => errors.push(error) },
      )
      await waitFor(() => calls.length === 2)
      await runner.stop()
      expect(errors).toHaveLength(2)
    } finally {
      await cleanup()
    }
  })
})

async function* stream(events: readonly Watch.Event[]): AsyncIterable<Watch.Event> {
  for (const event of events) yield event
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("等待超时")
    await Bun.sleep(5)
  }
}
