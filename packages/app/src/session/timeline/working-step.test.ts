import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { buildWorkingSteps, formatWorkingDuration } from "./working-step"

const tool = (
  name: string,
  id: string,
  status: "running" | "completed",
  input: Record<string, string>,
): SessionMessageAssistant["content"][number] => ({
  type: "tool",
  id,
  name,
  state:
    status === "running" ? { status, input, metadata: {} } : { status, input, content: [{ type: "text", text: "" }] },
  time: { created: 1, ...(status === "running" ? {} : { completed: 2 }) },
})

describe("working activity", () => {
  test("formats the live duration as hours, minutes and seconds", () => {
    expect(formatWorkingDuration(0)).toBe("0秒")
    expect(formatWorkingDuration(65_000)).toBe("1分5秒")
    expect(formatWorkingDuration(3_723_000)).toBe("1时2分3秒")
  })

  test("keeps ordered thinking and tool steps with file names only in the view model", () => {
    const message: SessionMessageAssistant = {
      id: "assistant-1",
      type: "assistant",
      time: { created: 1 },
      agent: "build",
      model: { id: "test-model", providerID: "test-provider" },
      content: [
        { type: "reasoning", text: "Inspect the change", time: { created: 1 } },
        tool("shell", "command-1", "completed", { command: "bun test" }),
        tool("read", "read-1", "completed", { path: "/repo/src/session/file.ts" }),
        tool("edit", "edit-1", "running", { path: "/repo/src/session/file.ts" }),
      ],
    }

    expect(buildWorkingSteps([message])).toEqual([
      { id: "assistant-1:thinking:0", kind: "thinking", running: true },
      {
        id: "command-1",
        kind: "command",
        detail: "bun test",
        running: false,
      },
      {
        id: "read-1",
        kind: "read",
        path: "/repo/src/session/file.ts",
        file: "file.ts",
        running: false,
      },
      {
        id: "edit-1",
        kind: "edit",
        path: "/repo/src/session/file.ts",
        file: "file.ts",
        running: true,
      },
    ])
  })

  test("starts a new activity group after assistant text and keeps every step", () => {
    const message: SessionMessageAssistant = {
      id: "assistant-2",
      type: "assistant",
      time: { created: 1 },
      agent: "build",
      model: { id: "test-model", providerID: "test-provider" },
      content: [
        tool("read", "read-before-text", "completed", { path: "/repo/before.ts" }),
        { type: "text", text: "I found the issue." },
        tool("read", "read-after-text-1", "completed", { path: "/repo/a.ts" }),
        tool("read", "read-after-text-2", "completed", { path: "/repo/b.ts" }),
        tool("edit", "edit-after-text", "completed", { path: "/repo/c.ts" }),
        tool("shell", "command-after-text", "completed", { command: "bun test" }),
        tool("read", "read-after-text-3", "completed", { path: "/repo/d.ts" }),
        tool("read", "read-after-text-4", "completed", { path: "/repo/e.ts" }),
        tool("read", "read-after-text-5", "completed", { path: "/repo/f.ts" }),
      ],
    }

    expect(buildWorkingSteps([message]).map((step) => step.id)).toEqual([
      "read-after-text-1",
      "read-after-text-2",
      "edit-after-text",
      "command-after-text",
      "read-after-text-3",
      "read-after-text-4",
      "read-after-text-5",
    ])
  })
})
