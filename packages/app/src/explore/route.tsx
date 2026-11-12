import { createMemo, Match, Show, Switch } from "solid-js"
import { ServerProvider } from "@/runtime/server/current"
import { useServers } from "@/runtime/server/registry"
import { PagePanel } from "@/shell/page"
import { useLayout } from "@/shell/state/layout"
import { ExplorePlugins } from "./plugins"
import { ExploreSkills } from "./skills"
import "./explore.css"

/** Plugins and skills live here instead of Settings, so both are one click from the rail. */
export function ExploreScreen() {
  const servers = useServers()
  const layout = useLayout()

  // Explore manages the first configured server, the one Home opens with.
  const connection = createMemo(() => servers.list[0])

  return (
    <Show when={connection()} keyed fallback={<div class="min-h-0 flex-1" aria-busy="true" />}>
      {(conn) => (
        <ServerProvider conn={conn}>
          <PagePanel>
            <div class="explore-content flex min-h-0 flex-1 flex-col">
              <Switch>
                <Match when={layout.destination.explore.section() === "plugins"}>
                  <ExplorePlugins />
                </Match>
                <Match when={layout.destination.explore.section() === "skills"}>
                  <ExploreSkills />
                </Match>
              </Switch>
            </div>
          </PagePanel>
        </ServerProvider>
      )}
    </Show>
  )
}
