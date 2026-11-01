import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { buildWorkingStep, formatWorkingDuration } from "./working-step"

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

  test("keeps only the current step with file names only in the view model", () => {
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

    expect(buildWorkingStep([message])).toEqual({
      id: "edit-1",
      kind: "edit",
      path: "/repo/src/session/file.ts",
      file: "file.ts",
      running: true,
    })
  })

  test("uses the current assistant after earlier assistant text", () => {
    const first: SessionMessageAssistant = {
      id: "assistant-2",
      type: "assistant",
      time: { created: 1 },
      agent: "build",
      model: { id: "test-model", providerID: "test-provider" },
      content: [
        tool("read", "read-before-text", "completed", { path: "/repo/before.ts" }),
        { type: "text", text: "I found the issue." },
        tool("read", "read-after-text-1", "completed", { path: "/repo/a.ts" }),
      ],
    }
    const second: SessionMessageAssistant = {
      id: "assistant-3",
      type: "assistant",
      time: { created: 2 },
      agent: "build",
      model: { id: "test-model", providerID: "test-provider" },
      content: [{ type: "reasoning", text: "Next step", time: { created: 2 } }],
    }

    expect(buildWorkingStep([first, second])).toEqual({
      id: "assistant-3:thinking:0",
      kind: "thinking",
      running: true,
    })
  })

  test("shows no assistant action while its text is streaming", () => {
    const message: SessionMessageAssistant = {
      id: "assistant-4",
      type: "assistant",
      time: { created: 1 },
      agent: "build",
      model: { id: "test-model", providerID: "test-provider" },
      content: [
        tool("read", "read-before-text", "completed", { path: "/repo/before.ts" }),
        { type: "text", text: "I found the issue." },
      ],
    }

    expect(buildWorkingStep([message])).toBeUndefined()
  })
})
