export * as Brief from "./brief.js"

export interface Input {
  readonly id: string
  readonly title: string
  readonly allowPaths: readonly string[]
  readonly verify: readonly string[]
  readonly branch: string
  readonly base: string
  readonly worktree: string
  /** Absolute path of this task's result file; the executor writes it when it is done. */
  readonly resultPath: string
  /** The session that called `plan`. The only address an executor may message, and only for the three cases below. */
  readonly pmSessionID?: string
}

/** The only text an executor sees. Everything it needs to work and to report lives here. */
export function render(input: Input): string {
  return [
    `# 任务 ${input.id}：${input.title}`,
    "",
    "你是执行者，不是编排者。不要创建会话、不要投递任务、不要改本任务范围之外的任何文件。",
    "",
    "## 工作目录",
    input.worktree,
    "",
    "## 分支",
    `${input.branch}（已从 ${input.base} 创建；不要切到别的分支，不要推主干）`,
    "",
    "## 允许修改的路径",
    ...input.allowPaths.map((path) => `- ${path}`),
    "",
    "## 验收命令（你必须自己跑，全绿才算完成）",
    ...(input.verify.length > 0
      ? input.verify.map((command) => `- \`${command}\``)
      : ["（本任务没有验收命令，插件只核对改动路径）"]),
    "",
    "## 完成时",
    "",
    `写文件 \`${input.resultPath}\`，不要给我发消息：`,
    "",
    "```json",
    "{",
    `  "task": "${input.id}",`,
    `  "branch": "${input.branch}",`,
    '  "commit": "<HEAD 的完整 sha>",',
    '  "changed": ["<git diff --name-only 的结果>"],',
    '  "verify": "<每条验收命令的实际结果，如 613 pass / 16 fail 与基线一致>"',
    "}",
    "```",
    "",
    "## 只有这三种情况才投递消息给编排者",
    "",
    "1. 卡住超过 30 分钟无法推进",
    "2. 需要做出需求没写的决策",
    `3. 发现必须修改 ${input.allowPaths.map((path) => `\`${path}\``).join("、")} 之外的路径`,
    "",
    `投递地址是**发起 plan 的那个会话**${input.pmSessionID ? `（\`${input.pmSessionID}\`）` : ""}，不是插件本身。`,
    "消息里给：任务 ID、卡在哪、你需要的决定。不要写进度汇报。",
  ].join("\n")
}
