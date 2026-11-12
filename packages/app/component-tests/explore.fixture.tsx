import type { PluginInfo } from "@opencode/client"
import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { CatalogPlugin } from "../src/explore/catalog"
import { ExplorePluginsView } from "../src/explore/plugins"
import { LanguageProvider } from "../src/runtime/i18n/language"

const sample: CatalogPlugin[] = [
  {
    id: "alpha-plugin",
    name: "alpha-plugin",
    category: "developer-tools",
    author: "example",
    description: "Adds alpha behaviour",
    details: "The full alpha introduction.",
    package: "opencode-plugin-alpha",
    repository: "https://github.com/example/alpha-plugin",
  },
  {
    id: "beta-plugin",
    name: "beta-plugin",
    category: "productivity",
    author: "example",
    description: "Adds beta behaviour",
    package: "opencode-plugin-beta",
    repository: "https://github.com/example/beta-plugin",
    mcpServers: [{ name: "beta-mcp" }],
    skills: [{ name: "Beta Skill", description: "Does beta work" }],
  },
  {
    id: "gamma-plugin",
    name: "gamma-plugin",
    category: "automation",
    author: "example",
    description: "Adds gamma behaviour",
    package: "opencode-plugin-gamma",
    repository: "https://github.com/example/gamma-plugin",
  },
]

/** A discoverable bundle: it ships as one `.ocplugin` file, so the card shows the bundle instead of a package. */
export const webwrightCatalog: CatalogPlugin[] = [
  {
    id: "opencode.webwright",
    name: "Webwright",
    category: "automation",
    author: "OpenCode",
    description: "让 AI 直接操作浏览器：打开网页、点击、填表、抓取内容。",
    package: "opencode.webwright",
    repository: "https://github.com/anomalyco/opencode/tree/dev/packages/plugins/webwright",
    bundle: { file: "opencode.webwright-2.2.5.ocplugin", format: "ocplugin" },
    skills: [{ name: "Webwright", description: "用 webwright.* 工具操作专用浏览器。" }],
  },
]

/** What the server reports once that bundle is unpacked into the plugins directory. */
export const webwrightInstalled: PluginInfo[] = [
  {
    id: "opencode.webwright",
    source: { type: "local", path: "plugins/opencode.webwright" },
    features: { server: true },
    state: { status: "active" },
    display: {
      name: "Webwright",
      description: "让 AI 直接操作浏览器：打开网页、点击、填表、抓取内容。",
      category: "automation",
      skills: [{ id: "webwright", name: "Webwright", description: "用 webwright.* 工具操作专用浏览器。" }],
      tools: ["webwright.*"],
    },
  },
]

/**
 * Mounts the plugins page's real view over fixture data. The page's story provides the app runtime; this only
 * supplies the language context and the selection the real navigation column would own.
 */
export function mountExplorePlugins(input?: {
  catalog?: readonly CatalogPlugin[]
  installed?: readonly PluginInfo[]
}) {
  const catalog = input?.catalog ?? sample
  const [openID, setOpenID] = createSignal<string>()

  const host = document.createElement("div")
  host.dataset.testid = "explore-plugins-fixture"
  host.style.cssText = "position:fixed;inset:24px;display:flex;flex-direction:column;min-height:0;overflow:hidden"
  document.body.appendChild(host)

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <ExplorePluginsView
          catalog={catalog}
          installed={input?.installed}
          catalogEntry={catalog.find((entry) => entry.id === openID())}
          onSelectCatalog={setOpenID}
          onBack={() => setOpenID(undefined)}
          onInstall={() => undefined}
          onInstallCatalog={() => undefined}
        />
      </LanguageProvider>
    ),
    host,
  )

  return {
    host,
    unmount: () => {
      dispose()
      host.remove()
    },
  }
}
