import { describe, expect, test } from "bun:test"
import type { Info, ToolContext, ToolEditor } from "@opencode/plugin/promise/tool"
import { Tool } from "@opencode/schema/tool"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Ledger } from "../src/ledger.js"
import { Tools } from "../src/tools.js"

const now = () => "2026-01-01T00:00:00.000Z"

function editor() {
  const tools = new Map<string, Info & { id: string }>()
  const fake = {
    list: () => [...tools.values()],
    get: (id: string) => tools.get(id),
    namespace: () => undefined,
    add: (tool: Info) => {
      const id = `${tool.options?.namespace}.${tool.name}`
      tools.set(id, { ...tool, id })
    },
    update: () => undefined,
    remove: () => undefined,
  } satisfies ToolEditor
  return { editor: fake, tool: (name: string) => tools.get(`orchestrator.${name}`)! }
}

function context(): ToolContext {
  return {
    sessionID: "ses_test" as never,
    agent: "build" as never,
    messageID: "msg_test" as never,
    id: "call_test" as never,
    signal: new AbortController().signal,
    progress: async () => undefined,
  }
}

async function setup(
  overrides: Partial<Tools.Deps> = {},
): Promise<{ directory: string; tools: ReturnType<typeof editor>; deps: Tools.Deps }> {
  const directory = await mkdtemp(join(tmpdir(), "orchestrator-tools-"))
  const deps: Tools.Deps = {
    store: Ledger.createStore(directory),
    now,
    approve: async () => ({ dispatched: [], waiting: [] }),
    resolve: async (input) => ({ taskID: input.taskID, status: "待派" }),
    ...overrides,
  }
  const tools = editor()
  Tools.register(tools.editor, deps)
  return { directory, tools, deps }
}

const input = {
  planID: "p1",
  base: "lts/ocdev",
  tasks: [
    { id: "t1", title: "第一件", allowPaths: ["plugins/a"], verify: ["bun test"] },
    { id: "t2", title: "第二件", deps: ["t1"], allowPaths: ["plugins/b"], verify: [] },
  ],
}

describe("orchestrator.plan", () => {
  test("写台账、记调用方会话、状态全部是待派", async () => {
    const { directory, tools, deps } = await setup()
    try {
      const result = await tools.tool("plan").execute(input, context())
      expect(result.output).toMatchObject({ planID: "p1", accepted: ["t1", "t2"], awaitingApproval: true })
      const file = await deps.store.read()
      expect(file.tasks.t1?.status).toBe("待派")
      expect(file.tasks.t2?.deps).toEqual(["t1"])
      expect(file.plans.p1?.pmSessionID).toBe("ses_test")
      expect(file.plans.p1?.concurrency).toBe(3)
      expect(await deps.store.readPlan("p1")).toBeDefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("同一 planID 相同输入幂等，不同输入报错", async () => {
    const { directory, tools } = await setup()
    try {
      await tools.tool("plan").execute(input, context())
      const again = await tools.tool("plan").execute({ ...input, tasks: [...input.tasks].reverse() }, context())
      expect(again.output).toMatchObject({ accepted: ["t1", "t2"] })

      await expect(
        tools.tool("plan").execute({ ...input, base: "main" }, context()),
      ).rejects.toThrow("已经提交过且输入不同")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("校验失败抛出可读错误", async () => {
    const { directory, tools } = await setup()
    try {
      await expect(
        tools.tool("plan").execute({ ...input, tasks: [{ ...input.tasks[0]!, id: "bad id" }] }, context()),
      ).resolves.toBeDefined()
      await expect(tools.tool("plan").execute({ ...input, planID: " " }, context())).rejects.toBeInstanceOf(Tool.Error)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("orchestrator.status", () => {
  test("空台账返回零计数与空异常", async () => {
    const { directory, tools } = await setup()
    try {
      const result = await tools.tool("status").execute({}, context())
      expect(result.output).toEqual({
        counts: { 待派: 0, 进行中: 0, 已回传: 0, 已核: 0, 已合入: 0, 失败: 0, 阻塞: 0 },
        anomalies: [],
      })
      expect(String(result.content)).toContain("无异常")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("异常逐条返回并截断 200 字，未知批次报错", async () => {
    const { directory, tools, deps } = await setup()
    try {
      await deps.store.update((file) => {
        file.plans.p1 = { planID: "p1", base: "lts/ocdev", concurrency: 3, createdAt: now(), tasks: ["t9"] }
        file.tasks.t9 = {
          id: "t9",
          planID: "p1",
          title: "x",
          deps: [],
          allowPaths: ["a"],
          verify: [],
          status: "失败",
          updatedAt: now(),
        }
        file.anomalies.push({ taskID: "t9", kind: "验收失败", detail: "x".repeat(500), since: now() })
      })
      const result = (await tools.tool("status").execute({ planID: "p1" }, context())) as {
        output: { counts: Record<string, number>; anomalies: Array<{ detail: string }> }
      }
      expect(result.output.counts["失败"]).toBe(1)
      expect(result.output.anomalies).toHaveLength(1)
      expect(result.output.anomalies[0]?.detail).toHaveLength(200)
      await expect(tools.tool("status").execute({ planID: "nope" }, context())).rejects.toThrow("没有 planID")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("orchestrator.approve / resolve", () => {
  test("原样转发参数", async () => {
    const calls: unknown[] = []
    const { directory, tools } = await setup({
      approve: async (value) => {
        calls.push(value)
        return { dispatched: ["t1"], waiting: ["t2"] }
      },
      resolve: async (value) => {
        calls.push(value)
        return { taskID: value.taskID, status: "待派", dispatched: true }
      },
    })
    try {
      const approved = await tools.tool("approve").execute({ planID: "p1", tasks: ["t1"] }, context())
      expect(approved.output).toEqual({ dispatched: ["t1"], waiting: ["t2"] })
      const resolved = await tools.tool("resolve").execute(
        { taskID: "t1", decision: "retry", note: "重做" },
        context(),
      )
      expect(resolved.output).toEqual({ taskID: "t1", status: "待派", dispatched: true })
      expect(calls).toEqual([
        { planID: "p1", tasks: ["t1"] },
        { taskID: "t1", decision: "retry", note: "重做" },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("下游错误转成 Tool.Error", async () => {
    const { directory, tools } = await setup({
      resolve: async () => {
        throw new Error("状态不匹配")
      },
    })
    try {
      await expect(tools.tool("resolve").execute({ taskID: "t1", decision: "merged" }, context())).rejects.toThrow(
        Tool.Error,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
