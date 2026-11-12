export * as SessionRecentText from "./recent-text.js"

import type { SessionMessage } from "./message.js"
import type { SessionStored } from "./stored.js"

const TOOL_OUTPUT_MAX_CHARS = 1_250

/**
 * The text of the messages a summary compaction kept verbatim. History rebuilds it from `metadata.keepID`;
 * compactions written before that reference carry the text they stored.
 */
export const kept = (message: SessionMessage.CompactionCompleted) =>
  typeof message.metadata?.recent === "string" ? message.metadata.recent : ""

/** One message as the recent, verbatim part of a summary shows it. Empty for messages that part leaves out. */
export const messageToText = (message: SessionMessage.Info | SessionStored.User): string => {
  switch (message.type) {
    // Earlier summaries and instruction updates are handled outside the recent part.
    case "compaction":
    case "system":
      return ""

    case "user": {
      const skills =
        message.skills?.flatMap((skill) =>
          skill.text === undefined ? [] : [`[技能已激活：${skill.name}]\n${skill.text}`],
        ) ?? []
      const files =
        message.files?.map((file) => {
          const name = file.name ?? (file.source.type === "uri" ? file.source.uri : "内联附件")
          return `[附件 ${file.mime}：${name}]`
        }) ?? []
      return [...skills, `[用户]：${message.text}`, ...files].join("\n")
    }

    case "location-switched":
      return `[用户]：工作目录已切换为 ${message.location.directory}。`

    case "assistant":
      return message.content
        .flatMap((part) => {
          if (part.type === "text") return [`[助手]：${part.text}`]
          // Providers return summaries of the real reasoning, and written out as text it can read like an attempt to
          // extract the model's thinking.
          if (part.type === "reasoning") return []

          const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
          const call = `[助手工具调用]：${part.name}(${input})`
          if (part.state.status === "completed") {
            return [call, `[工具结果]：${truncateToolOutput(serializeToolContent(part.state.content))}`]
          }
          if (part.state.status === "error") return [call, `[工具错误]：${part.state.error.message}`]
          return [call]
        })
        .join("\n")

    case "synthetic":
      return `[合成上下文]：${message.text}`

    case "skill":
      return `[技能已激活：${message.name}]\n${message.text}`

    case "shell":
      if (message.metadata?.background === true) return ""
      return `[Shell 命令]：${message.command}\n${truncateToolOutput(message.output?.output ?? "")}`

    default:
      return ""
  }
}

export const truncateToolOutput = (value: string) => {
  if (value.length <= TOOL_OUTPUT_MAX_CHARS) return value

  // Count code points so a surrogate pair is never split.
  let end = 0
  let kept = 0
  for (const char of value) {
    if (kept === TOOL_OUTPUT_MAX_CHARS) break
    end += char.length
    kept++
  }
  if (end === value.length) return value
  return `${value.slice(0, end)}\n[已截断]`
}

export const serializeToolContent = (content: ReadonlyArray<SessionMessage.ToolStateCompleted["content"][number]>) =>
  content
    .map((item) => {
      if (item.type === "text") return item.text
      return `[附件 ${item.mime}${item.name === undefined ? "" : `：${item.name}`}]`
    })
    .join("\n")
