import type { SkillInfo } from "@opencode/client/promise"
import { createSimpleContext } from "@opencode/ui/context"
import { createEffect, createMemo, createResource, onCleanup } from "solid-js"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useLayout } from "@/shell/state/layout"

export type ExploreStatusKind = "offline" | "loading" | "error" | "ready"

/**
 * One project's installed plugins and skills. The navigation column lists them, the pane shows the selected one's
 * details and the catalog to install from, so both read this instead of fetching the same server twice.
 */
export function createExploreInstalled() {
  const servers = useServers()
  const global = useGlobal()
  const layout = useLayout()

  const ctx = createMemo(() => {
    const conn = servers.list[0]

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  })

  const active = () => layout.route().type === "explore"

  const connected = () => ctx()?.sdk.connection.status() === "connected"

  const directory = () => layout.home.selection().directory ?? ctx()?.data.location.default().directory ?? ""

  // The list is only needed on Explore, so opening it fetches once per visit instead of at app start.
  const [pluginList, { refetch }] = createResource(
    () => (active() && connected() ? ctx() : undefined),
    (server) => server.sdk.api.plugin.list().then((result) => result.data),
  )

  // Built-in plugins are server parts with nothing to manage, so only the ones that declare display metadata (a
  // user-facing capability bundle) are listed. Every installed plugin is listed, including one installed globally:
  // the user asked to see what is available here, and a global plugin is available to this project too.
  const plugins = createMemo(() =>
    (pluginList() ?? []).filter((plugin) => {
      // A built-in plugin is a server part with nothing to manage here, unless it declares display metadata and
      // therefore wants to appear as a capability bundle.
      if (plugin.source.type === "builtin") return plugin.display !== undefined

      return true
    }),
  )

  // Installing a plugin rewrites the config and then installs the package; refresh when either lands.
  createEffect(() => {
    const server = ctx()
    if (!server) return

    onCleanup(server.sdk.event.on("config.updated", () => void refetch()))
    onCleanup(server.sdk.event.on("plugin.updated", () => void refetch()))
  })

  const skillList = () => (active() ? ctx()?.data.location.skill.list({ directory: directory() }) : undefined)
  const skills = (): readonly SkillInfo[] => skillList() ?? []

  const pluginStatus = (): ExploreStatusKind => {
    if (!connected()) return "offline"

    if (pluginList.loading && plugins().length === 0) return "loading"

    if (pluginList.error) return "error"

    return "ready"
  }

  const pluginError = () =>
    pluginList.error instanceof Error
      ? pluginList.error.message
      : pluginList.error
        ? String(pluginList.error)
        : undefined

  return {
    directory,
    plugins,
    pluginStatus,
    pluginError,
    refetchPlugins: refetch,
    skills,
    /** False until the server reports a skill list for this directory, so the column can wait instead of flashing empty. */
    skillsLoaded: () => skillList() !== undefined,
  }
}

export const { use: useExploreInstalled, provider: ExploreInstalledProvider } = createSimpleContext({
  name: "ExploreInstalled",
  gate: false,
  init: () => createExploreInstalled(),
})
