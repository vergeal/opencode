import type { SkillInfo } from "@opencode/client/promise"
import { createSimpleContext } from "@opencode/ui/context"
import { createMemo, createResource } from "solid-js"
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

  // Built-ins always run, so a server with only built-ins has nothing to manage here.
  const plugins = createMemo(() => (pluginList() ?? []).filter((plugin) => plugin.source.type !== "builtin"))

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
