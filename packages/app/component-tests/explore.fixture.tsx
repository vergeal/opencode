import type { PluginInfo } from "@opencode/client"
import { render } from "solid-js/web"
import { ExplorePluginsView } from "../src/explore/plugins"
import { LanguageProvider } from "../src/runtime/i18n/language"

const sample: PluginInfo[] = [
  {
    id: "alpha-plugin",
    source: { type: "package", target: "opencode-plugin-alpha" },
    features: { server: true, tui: true },
    state: { status: "active" },
  },
  {
    id: "beta-plugin",
    source: { type: "local", path: "/tmp/opencode/plugin-beta.ts" },
    features: { rpc: true },
    state: { status: "active" },
  },
  {
    id: "gamma-plugin",
    source: { type: "sdk" },
    features: {},
    state: { status: "failed", error: "Could not load gamma" },
  },
]

/**
 * Mounts the plugins pane's real view over fixture data. The page's story provides the app runtime; this only
 * supplies the language context the view reads.
 */
export function mountExplorePlugins(input?: { plugins?: readonly PluginInfo[] }) {
  const host = document.createElement("div")
  host.dataset.testid = "explore-plugins-fixture"
  host.style.cssText = "position:fixed;inset:24px;display:flex;flex-direction:column;min-height:0;overflow:hidden"
  document.body.appendChild(host)

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <ExplorePluginsView
          plugins={input?.plugins ?? sample}
          status="ready"
          own={false}
          onInstall={() => undefined}
          onRetry={() => undefined}
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
