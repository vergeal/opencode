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
  /**
   * Ships inside the app: installing only writes the config entry that enables it, so no package is downloaded.
   */
  integrated?: boolean
  /**
   * A single-file `.ocplugin` bundle. There is no package to fetch and no config entry to write: the host unpacks the
   * file into its plugins directory, so the card shows the bundle instead of offering a package install.
   */
  bundle?: { file: string; format: "ocplugin" }
  /** Version shown on the install card. */
  version?: string
  /** Tool families the plugin registers, for the install card. */
  tools?: readonly string[]
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

// Webwright ships as one `.ocplugin` bundle, so the catalog entry carries the manifest's user-facing fields rather
// than a package to download. The bundle itself is distributed separately.
const plugins: readonly CatalogPlugin[] = [
  {
    id: "opencode.webwright",
    name: "Webwright",
    category: "automation",
    author: "OpenCode",
    description: "让 AI 直接操作浏览器：打开网页、点击、填表、抓取内容，不需要安装扩展。",
    details:
      "Webwright 用 Playwright 驱动一个和日常浏览分开的专用浏览器：默认使用系统 Chrome，其次 Edge，都没有时用自带 Chromium。它能打开网页、点击和拖拽、填写表单、执行页面脚本、截图，也能为 canvas 这类没有 DOM 的表面提供坐标元数据。\n\n配置目录独立保存在 ~/.opencode/webwright/profile，登录状态会保留。",
    package: "opencode.webwright",
    repository: "https://github.com/anomalyco/opencode/tree/dev/packages/plugins/webwright",
    bundle: { file: "opencode.webwright-2.2.5.ocplugin", format: "ocplugin" },
    version: "2.2.5",
    tools: ["webwright.*"],
    skills: [
      {
        name: "Webwright",
        description:
          "用 `webwright.*` 工具操作专用的 Playwright 浏览器：打开和切换标签页、读取页面结构、点击、填表、执行页面脚本、截图并抓取页面内容。第一次调用 `webwright.*` 前先加载本技能。",
      },
    ],
  },
]

// Likewise nothing is bundled to install, so the skills shelf lists only what the server builds in.
const skills: readonly CatalogSkill[] = []

export function loadCatalog(): Promise<CatalogSource> {
  return Promise.resolve({ plugins, skills })
}
