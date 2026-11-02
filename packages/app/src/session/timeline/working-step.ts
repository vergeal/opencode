import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"

type AssistantMessage = Pick<SessionMessageAssistant, "id" | "content" | "time">

export type WorkingStep = {
  id: string
  kind:
    | "thinking"
    | "command"
    | "read"
    | "edit"
    | "search"
    | "list"
    | "browse"
    | "web-search"
    | "subagent"
    | "skill"
    | "tool"
  label?: string
  detail?: string
  path?: string
  file?: string
  extraFiles?: number
  running: boolean
}

const toolKinds: Record<string, WorkingStep["kind"]> = {
  shell: "command",
  execute: "command",
  read: "read",
  edit: "edit",
  write: "edit",
  patch: "edit",
  glob: "search",
  grep: "search",
  list: "list",
  browser: "browse",
  webfetch: "browse",
  websearch: "web-search",
  subagent: "subagent",
  skill: "skill",
}

export function formatWorkingDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60

  if (hours > 0) return `${hours}时${minutes}分${seconds}秒`
  if (minutes > 0) return `${minutes}分${seconds}秒`

  return `${seconds}秒`
}

export function buildWorkingSteps(messages: readonly AssistantMessage[]): WorkingStep[] {
  return messages.flatMap((message) =>
    message.content.flatMap<WorkingStep>((content, index) => {
      if (content.type === "tool") return [toolStep(content)]

      if (content.type !== "reasoning" || !content.text.trim()) return []

      return [
        {
          id: `${message.id}:thinking:${index}`,
          kind: "thinking",
          running: content.time?.completed === undefined,
        },
      ]
    }),
  )
}

export function buildWorkingStep(messages: readonly AssistantMessage[]): WorkingStep | undefined {
  const latest = messages.at(-1)

  if (!latest) return
  const current = latest.content.at(-1)

  if (current?.type === "reasoning")
    return {
      id: `${latest.id}:thinking:${latest.content.length - 1}`,
      kind: "thinking",
      running: current.time?.completed === undefined,
    }

  if (current?.type === "tool") return toolStep(current)
  if (current?.type === "text" && current.text.trim()) return
  if (latest.time.completed !== undefined) return

  return {
    id: `${latest.id}:thinking`,
    kind: "thinking",
    running: true,
  }
}

function toolStep(tool: SessionMessageAssistantTool): WorkingStep {
  const files = toolFiles(tool)
  const input = toolInput(tool)
  const metadata = toolMetadata(tool)
  const kind = toolKinds[tool.name] ?? "tool"
  const detail =
    tool.name === "shell" || tool.name === "execute"
      ? (stringValue(metadata.command) ?? stringValue(input.command))
      : tool.name === "glob" || tool.name === "grep"
        ? stringValue(input.pattern)
        : tool.name === "websearch"
          ? stringValue(input.query)
          : tool.name === "webfetch" || tool.name === "browser"
            ? stringValue(input.url)
            : tool.name === "skill"
              ? (stringValue(metadata.name) ?? stringValue(input.name) ?? stringValue(input.id))
              : tool.name === "subagent"
                ? (stringValue(input.description) ?? stringValue(input.agent))
                : undefined

  return {
    id: tool.id,
    kind,
    ...(kind === "tool" ? { label: tool.name } : {}),
    ...(detail ? { detail } : {}),
    ...(files[0] ? { path: files[0], file: getFilename(files[0]) } : {}),
    ...(files.length > 1 ? { extraFiles: files.length - 1 } : {}),
    running: tool.state.status === "streaming" || tool.state.status === "running",
  }
}

function toolFiles(tool: SessionMessageAssistantTool) {
  const input = toolInput(tool)
  const metadata = toolMetadata(tool)
  const paths = [
    ...(typeof input.path === "string" ? [input.path] : []),
    ...(Array.isArray(metadata.files)
      ? metadata.files.flatMap((entry: unknown) => {
          if (typeof entry !== "object" || entry == null) return []
          const file = entry as Record<string, unknown>
          const path = file.path ?? file.file

          return typeof path === "string" ? [path] : []
        })
      : []),
  ]

  return [...new Set(paths)]
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function toolInput(tool: SessionMessageAssistantTool): Record<string, unknown> {
  if (tool.state.status !== "streaming") return tool.state.input

  try {
    const parsed: unknown = JSON.parse(tool.state.input)

    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function toolMetadata(tool: SessionMessageAssistantTool): Record<string, unknown> {
  return "metadata" in tool.state && isRecord(tool.state.metadata) ? tool.state.metadata : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null
}
