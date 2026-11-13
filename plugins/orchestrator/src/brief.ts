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
  // The title goes inside a double-quoted shell argument, so quote and expand characters must be escaped.
  const title = input.title.replace(/["\\$`]/g, (char) => `\\${char}`)
  return [
    `# 任务 ${input.id}：${input.title}`,
    "",
    "你是执行者，不是编排者。不要创建会话、不要投递任务、不要改本任务范围之外的任何文件。",
    "",
    "## 工作目录",
    input.worktree,
    "",
    "## 分支",
    `${input.branch}（已从 ${input.base} 创建；不要切到别的分支，不要 push）`,
    "",
    "## 允许修改的路径",
    ...input.allowPaths.map((path) => `- ${path}`),
    "",
    "## 验收命令（你必须自己跑，全绿才算完成）",
    ...(input.verify.length > 0
      ? input.verify.map((command) => `- \`${command}\``)
      : ["（本任务没有验收命令，插件只核对改动路径）"]),
    "",
    "如果验收命令失败，先修到全绿。确实修不动，就不要写一个自称通过的结果文件——按下面第 2 或第 3 种情况投递，说明卡在哪条命令、输出是什么。",
    "",
    "## 完成时",
    "",
    `1. 把所有改动提交到 ${input.branch}，**不要 push**：`,
    "",
    "   ```",
    `   git add -A && git commit -m "task ${input.id}: ${title}"`,
    "   ```",
    "",
    "   提交之后跑 `git rev-parse HEAD`，把完整 40 位填进 `commit`；短 sha 会被判结果缺失。",
    "",
    `2. 写文件 \`${input.resultPath}\`（目录不存在就先 mkdir -p 它的父目录），不要给我发消息：`,
    "",
    "   ```json",
    "   {",
    `     "task": "${input.id}",`,
    `     "branch": "${input.branch}",`,
    '     "commit": "<git rev-parse HEAD 输出的 40 位小写 sha>",',
    '     "changed": ["plugins/x/a.ts", "plugins/x/b.ts"],',
    '     "verify": "<每条验收命令的实际结果，如 613 pass / 16 fail 与基线一致>"',
    "   }",
    "   ```",
    "",
    "   一条路径一个元素；没有改动就填 `[]`。",
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
