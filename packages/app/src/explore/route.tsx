import { Tabs } from "@opencode/ui/tabs"
import { createMemo, createSignal, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerProvider } from "@/runtime/server/current"
import { useServers } from "@/runtime/server/registry"
import { PageHeader, PagePanel, PageToolbar } from "@/shell/page"
import { ExplorePlugins } from "./plugins"
import { ExploreSkills } from "./skills"
import "./explore.css"

type ExploreTab = "plugins" | "skills"

const isTab = (value: string): value is ExploreTab => value === "plugins" || value === "skills"

/** Plugins and skills live here instead of Settings, so both are one click from the rail. */
export function ExploreScreen() {
  const language = useLanguage()
  const servers = useServers()
  const [tab, setTab] = createSignal<ExploreTab>("plugins")

  // Explore manages the first configured server, the one Home opens with.
  const connection = createMemo(() => servers.list[0])

  return (
    <Show when={connection()} keyed fallback={<div class="min-h-0 flex-1" aria-busy="true" />}>
      {(conn) => (
        <ServerProvider conn={conn}>
          <PagePanel>
            <PageHeader title={language.t("explore.title")} description={language.t("explore.description")} />
            <Tabs
              variant="pill"
              value={tab()}
              onChange={(value) => {
                if (isTab(value)) setTab(value)
              }}
              class="explore-tabs flex min-h-0 flex-1 flex-col"
            >
              <PageToolbar>
                <Tabs.List>
                  <Tabs.Trigger value="plugins">{language.t("explore.tab.plugins")}</Tabs.Trigger>
                  <Tabs.Trigger value="skills">{language.t("explore.tab.skills")}</Tabs.Trigger>
                </Tabs.List>
              </PageToolbar>

              <Tabs.Content value="plugins" class="explore-content flex min-h-0 flex-1 flex-col">
                <ExplorePlugins />
              </Tabs.Content>

              <Tabs.Content value="skills" class="explore-content flex min-h-0 flex-1 flex-col">
                <ExploreSkills />
              </Tabs.Content>
            </Tabs>
          </PagePanel>
        </ServerProvider>
      )}
    </Show>
  )
}
