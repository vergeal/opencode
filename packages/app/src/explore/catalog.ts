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
  /** Brand mark to render instead of the generic plugin icon. */
  icon?: "chrome"
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

// The catalog currently lists the one integration this build carries: Chrome is compiled into the server, so
// installing it enables a plugin that is already here instead of downloading a package.
const plugins: readonly CatalogPlugin[] = [
  {
    id: "opencode.chrome",
    name: "Chrome 浏览器",
    category: "automation",
    author: "OpenCode",
    description: "让 AI 直接操作专用 Chrome 窗口：打开网页、点击、填表、截图，不用你一步步教。",
    details:
      "启用后，AI 会打开一个和你日常浏览器分开的专用 Chrome 窗口。它能在里面打开网页、点击按钮、填写表单、截图，也能操作在线文档、地图、白板这类没有普通按钮的页面。\n\n需要登录的网站，在那个窗口里登录一次即可，登录状态会保留。窗口可以随时关掉，关掉后 AI 就停下来。",
    package: "opencode.chrome",
    repository: "https://github.com/anomalyco/opencode/tree/dev/packages/plugin-chrome",
    integrated: true,
    icon: "chrome",
    skills: [
      {
        name: "Chrome 浏览器",
        description:
          "用 `chrome.*` 工具操作专用的 OpenCode Chrome 窗口：列出和切换标签页、读取页面结构、点击和填表、执行页面脚本、截图、上传文件，并在页面上显示光标。第一次调用 `chrome.*` 前先加载本技能。",
      },
    ],
  },
]

// Likewise nothing is bundled to install, so the skills shelf lists only what the server builds in.
const skills: readonly CatalogSkill[] = []

export function loadCatalog(): Promise<CatalogSource> {
  return Promise.resolve({ plugins, skills })
}
