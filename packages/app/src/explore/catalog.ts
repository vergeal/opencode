/**
 * The Explore catalog: the plugins and skills people publish for OpenCode, as the sidebar's "Discover" lists.
 *
 * The app ships a copy of the catalog until a registry endpoint exists. `loadCatalog` is the one seam that changes
 * then: swap its body for a request that returns the same shape and every surface below keeps working.
 */
export const PLUGIN_CATEGORIES = ["developer-tools", "productivity", "automation"] as const

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]

export type CatalogPlugin = {
  id: string
  name: string
  /** Which shelf the list groups this entry under. */
  category: PluginCategory
  /** The publisher shown under the name on the detail page. */
  author: string
  /** One line under the name in the list. */
  description: string
  /** The longer introduction on the detail page; the list's description stands in when absent. */
  details?: string
  /** The npm package a config entry loads the plugin from. */
  package: string
  repository: string
  /** MCP servers the plugin starts, when the catalog knows them. */
  mcpServers?: readonly { name: string }[]
  /** Skills the plugin ships, when the catalog knows them. */
  skills?: readonly { name: string; description: string }[]
}

export type CatalogSkill = {
  /** Also the SKILL.md directory name, so it must stay a lowercase hyphenated slug. */
  id: string
  title: string
  description: string
  /** The markdown body written below the frontmatter. */
  instructions: string
}

export type CatalogSource = {
  plugins: readonly CatalogPlugin[]
  skills: readonly CatalogSkill[]
}

// From the docs' ecosystem page: each repository's published npm name, so the copied config entry loads it.
const plugins: readonly CatalogPlugin[] = [
  {
    id: "opencode-wakatime",
    name: "opencode-wakatime",
    category: "developer-tools",
    author: "angristan",
    description: "用 Wakatime 记录 OpenCode 的使用时长。",
    details:
      "把 OpenCode 的会话时长上报给 Wakatime，和在编辑器里写代码的时间一起统计。适合想看清一天里有多少时间花在 AI 编程上的团队和个人。",
    package: "opencode-wakatime",
    repository: "https://github.com/angristan/opencode-wakatime",
  },
  {
    id: "opencode-notifier",
    name: "opencode-notifier",
    category: "productivity",
    author: "mohak34",
    description: "为权限请求、任务完成和错误事件发送桌面通知与提示音。",
    details:
      "长任务在后台运行时，插件在需要你确认权限、会话完成或出错时弹出系统通知。可以只开提示音，也可以关掉某一类事件。",
    package: "@mohak34/opencode-notifier",
    repository: "https://github.com/mohak34/opencode-notifier",
  },
  {
    id: "opencode-pty",
    name: "opencode-pty",
    category: "developer-tools",
    author: "shekohex",
    description: "在 PTY 中运行后台进程，并向它们发送交互式输入。",
    details: "让模型启动一个持久终端进程，之后继续向它写入命令并读取输出。适合需要交互的构建、测试和长时间运行的服务。",
    package: "opencode-pty",
    repository: "https://github.com/shekohex/opencode-pty",
  },
  {
    id: "opencode-md-table-formatter",
    name: "opencode-md-table-formatter",
    category: "developer-tools",
    author: "franlol",
    description: "整理模型输出的 Markdown 表格。",
    details: "在模型写完表格后对齐列宽和分隔行，让 diff 只在内容变化时出现，而不是整张表都被重排。",
    package: "@franlol/opencode-md-table-formatter",
    repository: "https://github.com/franlol/opencode-md-table-formatter",
  },
  {
    id: "opencode-scheduler",
    name: "opencode-scheduler",
    category: "automation",
    author: "different-ai",
    description: "用 cron 语法在 launchd 或 systemd 上安排周期性任务。",
    details: "把重复的检查、总结和同步交给系统调度器，按 cron 表达式定时运行，不依赖 OpenCode 一直开着。",
    package: "opencode-scheduler",
    repository: "https://github.com/different-ai/opencode-scheduler",
  },
  {
    id: "opencode-supermemory",
    name: "opencode-supermemory",
    category: "productivity",
    author: "supermemoryai",
    description: "用 Supermemory 在会话之间保留长期记忆。",
    details: "把重要的偏好和结论写入 Supermemory，新会话开始时再取回来，不必每次重新交代背景。",
    package: "opencode-supermemory",
    repository: "https://github.com/supermemoryai/opencode-supermemory",
  },
]

// Bundled until the registry serves skill bodies. Each one is a complete SKILL.md, so installing writes a usable skill.
const skills: readonly CatalogSkill[] = [
  {
    id: "commit-message",
    title: "Commit messages",
    description: "Write one conventional commit message for the staged diff, then stop.",
    instructions: `# Commit messages

Write the commit message for the currently staged change.

1. Run \`git diff --cached\` for the content and \`git log --oneline -10\` for the project's voice.
2. Summarize what the change makes true, not which files changed.
3. Use one line of \`type(scope): summary\` and add a body only when the reason is not obvious from the summary.
4. Keep the summary under 72 characters, imperative, and without a trailing period.

Never run \`git commit\` yourself. Return the message and wait for the user to approve it.`,
  },
  {
    id: "release-notes",
    title: "Release notes",
    description: "Group merged work between two refs into notes a reader can scan.",
    instructions: `# Release notes

Turn the changes between two refs into release notes.

1. Collect the commits with \`git log --no-merges <from>..<to>\`.
2. Group them under \`Added\`, \`Changed\`, \`Fixed\`, and \`Removed\`, dropping internal chores and dependency bumps.
3. Lead each line with the user-visible result. Name the surface, not the file.
4. Link an issue or pull request number when the commit carries one.

Write the notes in the release's language and do not invent entries for work you cannot see.`,
  },
  {
    id: "test-triage",
    title: "Flaky test triage",
    description: "Decide whether a failing test is broken code or a broken test, with evidence.",
    instructions: `# Flaky test triage

Walk a failing test to a conclusion instead of a guess.

1. Reproduce it alone, then in the full file, then in the whole suite. Each passing context narrows the cause.
2. Read the failure for what the assertion saw, not just the name that failed.
3. Look for shared state: module-level caches, a fixed clock, ports, temporary directories, and tests that write
   the same path.
4. Distrust any test that orders itself by sleeping or by watching a wall clock.
5. Report one of two verdicts: the code is wrong, or the test is wrong. Say which assertion or shared resource
   proves it, and quote the line.`,
  },
]

export function loadCatalog(): Promise<CatalogSource> {
  return Promise.resolve({ plugins, skills })
}
