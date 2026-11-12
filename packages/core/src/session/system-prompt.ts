export * as SessionSystemPrompt from "./system-prompt.js"

import PROMPT from "./runner/prompt/system.txt"

export function make(tools: string[]) {
  return render(PROMPT, tools)
}

export function render(prompt: string, tools: string[]) {
  const instructions: string[] = []
  if (tools.includes("shell")) {
    instructions.push(
      "- 优先使用专用工具而不是 shell 命令；当某个工具无法完成所需操作时，再退回到 shell。",
      "- 不要用 `echo \"====\";` 或 `printf '---'` 这类分隔符串联 shell 命令；输出会变得杂乱，让用户侧的对话体验变差。",
    )
  }
  if (tools.includes("write")) {
    instructions.push("- 使用 write 工具创建文件或完全替换其内容。局部改动优先使用 edit 工具。")
  }
  if (tools.includes("edit")) {
    instructions.push(
      "- 使用 edit 工具对现有文本文件做局部改动。它把 `oldString` 中的确切文本替换为 `newString`，且两者的值必须不同。默认情况下，`oldString` 必须只出现一次。如果出现多次，请包含更多上下文使其唯一，或设置 `replaceAll` 为 true 以替换每一处。",
    )
  }
  return prompt.replace("${OPENCODE_TOOL_GUIDANCE}", instructions.join("\n"))
}
