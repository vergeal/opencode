import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Ledger } from "../src/ledger.js"

const now = () => new Date().toISOString()

function task(id: string, status: Ledger.Status = "待派"): Ledger.MutableTask {
  return {
    id,
    planID: "p1",
    title: `任务 ${id}`,
    deps: [],
    allowPaths: ["plugins/x"],
    verify: ["bun test"],
    status,
    updatedAt: now(),
  }
}

describe("状态机", () => {
  test("只放行 TRANSITIONS 里列出的边，其余全部拒绝", () => {
    for (const from of Ledger.STATUSES) {
      for (const to of Ledger.STATUSES) {
        const allowed = Ledger.TRANSITIONS[from].includes(to)
        const run = () => Ledger.move(task("t1", from), to, now())
        if (allowed) expect(run().status).toBe(to)
        else expect(run).toThrow(Ledger.TransitionError)
      }
    }
  })

  test("move 返回新对象，不改原始任务", () => {
    const before = task("t1")
    const after = Ledger.move(before, "进行中", "2026-01-01T00:00:00.000Z")
    expect(before.status).toBe("待派")
    expect(after.status).toBe("进行中")
    expect(after.updatedAt).toBe("2026-01-01T00:00:00.000Z")
  })

  test("accept 可以从失败进入已核，已合入没有出边", () => {
    expect(Ledger.move(task("t1", "失败"), "已核", now()).status).toBe("已核")
    expect(Ledger.TRANSITIONS["已合入"]).toEqual([])
  })

  test("block 不降级已合入，且对阻塞幂等", () => {
    expect(Ledger.block(task("t1", "已合入"), now()).status).toBe("已合入")
    const blocked = Ledger.block(task("t1", "已回传"), now())
    expect(blocked.status).toBe("阻塞")
    expect(Ledger.block(blocked, now())).toBe(blocked)
  })
})

describe("台账存储", () => {
  test("空目录读出空台账", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      expect(await Ledger.createStore(directory).read()).toEqual({
        version: 1,
        plans: {},
        tasks: {},
        anomalies: [],
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("一次 update 立即落盘，新 store 能读到", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      await Ledger.createStore(directory).update((file) => {
        file.tasks.t1 = task("t1")
      })
      const reloaded = await Ledger.createStore(directory).read()
      expect(reloaded.tasks.t1?.title).toBe("任务 t1")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("并发 update 不丢写", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      const store = Ledger.createStore(directory)
      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          store.update((file) => {
            file.anomalies.push({ taskID: `t${index}`, kind: "超时", detail: "x", since: now() })
          }),
        ),
      )
      expect((await Ledger.createStore(directory).read()).anomalies).toHaveLength(20)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("update 抛错不污染缓存，也不卡住下一次写入", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      const store = Ledger.createStore(directory)
      await expect(
        store.update((file) => {
          file.tasks.t1 = task("t1")
          throw new Error("boom")
        }),
      ).rejects.toThrow("boom")
      expect((await store.read()).tasks.t1).toBeUndefined()
      await store.update((file) => {
        file.tasks.t2 = task("t2")
      })
      expect((await store.read()).tasks.t2).toBeDefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("数据目录不存在时 update 会创建它", async () => {
    const parent = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      const directory = join(parent, "nested", "data")
      const store = Ledger.createStore(directory)
      await store.update((file) => {
        file.tasks.t1 = task("t1")
      })
      expect((await Ledger.createStore(directory).read()).tasks.t1?.title).toBe("任务 t1")
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  test("两个实例并发 update，20 个 key 全部落盘", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      const a = Ledger.createStore(directory)
      const b = Ledger.createStore(directory)
      const writes = (store: Ledger.Store, prefix: string) =>
        Array.from({ length: 10 }, (_, index) =>
          store.update((file) => {
            file.tasks[`${prefix}${index}`] = task(`${prefix}${index}`)
          }),
        )
      await Promise.all([...writes(a, "a"), ...writes(b, "b")])
      const keys = [...Array.from({ length: 10 }, (_, index) => `a${index}`), ...Array.from({ length: 10 }, (_, index) => `b${index}`)]
      expect(Object.keys((await Ledger.createStore(directory).read()).tasks).sort()).toEqual(keys.sort())
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("旧快照 update 不抹掉另一个实例的写入", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      const a = Ledger.createStore(directory)
      const b = Ledger.createStore(directory)
      expect((await a.read()).tasks.t2).toBeUndefined()
      await b.update((file) => {
        file.tasks.t2 = task("t2")
      })
      await a.update((file) => {
        file.tasks.t1 = task("t1")
      })
      const reloaded = await Ledger.createStore(directory).read()
      expect(reloaded.tasks.t2?.title).toBe("任务 t2")
      expect(reloaded.tasks.t1?.title).toBe("任务 t1")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("陈旧锁被回收后仍能写入", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      const lockPath = join(directory, "ledger.json.lock")
      await writeFile(lockPath, JSON.stringify({ pid: 999999, at: new Date(Date.now() - 40_000).toISOString() }))
      const store = Ledger.createStore(directory)
      await store.update((file) => {
        file.tasks.t1 = task("t1")
      })
      expect((await store.read()).tasks.t1?.title).toBe("任务 t1")
      expect(await Bun.file(lockPath).exists()).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("损坏的台账直接报错，不重建覆盖", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      await writeFile(join(directory, "ledger.json"), "{ not json")
      await expect(Ledger.createStore(directory).read()).rejects.toThrow("不是合法 JSON 或结构不匹配")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("结果文件区分不存在、非法 JSON 与正常值", async () => {
    const directory = await mkdtemp(join(tmpdir(), "orchestrator-ledger-"))
    try {
      const store = Ledger.createStore(directory)
      expect(await store.readResult("p1", "t1")).toEqual({ present: false })
      await store.writePlan("p1", { planID: "p1", tasks: [] })
      expect(await store.readPlan("p1")).toEqual({ planID: "p1", tasks: [] })
      await Bun.write(store.resultPath("p1", "t1"), "not json")
      expect(await store.readResult("p1", "t1")).toEqual({ present: true, error: "不是合法 JSON" })
      await Bun.write(store.resultPath("p1", "t1"), JSON.stringify({ task: "t1" }))
      expect(await store.readResult("p1", "t1")).toEqual({ present: true, value: { task: "t1" } })
      await store.clearResult("p1", "t1")
      expect(await store.readResult("p1", "t1")).toEqual({ present: false })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
