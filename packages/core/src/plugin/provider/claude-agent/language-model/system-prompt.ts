export * as ClaudeSystemPrompt from "./system-prompt.js"

import type { Options } from "@anthropic-ai/claude-agent-sdk"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

export const AGENT_OPTION = "claudeCodeAgent"
export const INSTRUCTIONS_OPTION = "claudeCodeInstructions"

const primary = {
  type: "preset",
  preset: "claude_code",
  // Agent changes must take effect when a process resumes the same native session.
  snapshot: false,
  append: "<runtime_info>你通过 Claude Code harness 运行在 OpenCode 中。只在被问到时提及这一点。</runtime_info>",
} satisfies Options["systemPrompt"]

export function make(role?: string, instructions?: string) {
  const blocks = [primary.append]
  if (role) blocks.push("# Agent 角色（来自 OpenCode）\n" + role)
  if (instructions) blocks.push(instructions)
  return { ...primary, append: blocks.join("\n\n") }
}

export function utility(prompt: LanguageModelV3Prompt) {
  const blocks = prompt.filter((message) => message.role === "system").map((message) => message.content)
  return blocks.join("\n\n") || "你是一个文本生成助手。只返回所要求的输出。"
}
