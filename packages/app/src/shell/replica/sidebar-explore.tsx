import { For, Show, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useExploreInstalled } from "@/explore/installed"
import { PluginIcon } from "@/explore/plugin-icon"
import { SkillIcon } from "@/explore/skill-icon"
import { ExploreSkeleton } from "@/explore/skeleton"
import { pluginLabel } from "@/providers/catalog/plugin"
import { useLanguage } from "@/runtime/i18n/language"
import { EXPLORE_SECTIONS, useLayout, type ExploreSection } from "@/shell/state/layout"
import { HEADER, LIST, ROW, SECTION, TITLE } from "./sidebar-tokens"

// The shelves reuse the marks their pages use, painted in currentColor so the navigation stays quiet.
const SECTIONS: Record<ExploreSection, { icon: Component<{ class?: string }>; labelKey: string }> = {
  plugins: { icon: (props) => <PluginIcon class={props.class} monochrome />, labelKey: "explore.nav.plugins" },
  skills: { icon: (props) => <SkillIcon class={props.class} monochrome />, labelKey: "explore.nav.skills" },
}

type NavItem = { id: string; label: string; description?: string }

/** The explore navigation column: the two shelves, then what this project already has installed. */
export function ExploreNav() {
  const language = useLanguage()
  const layout = useLayout()
  const installed = useExploreInstalled()

  const section = () => layout.destination.explore.section()

  // The installed shelf lists plugins only; installed skills live in the skills page's own tab.
  const items = (): NavItem[] =>
    installed.plugins().map((plugin) => ({
      id: plugin.id ?? pluginLabel(plugin),
      label: pluginLabel(plugin),
      description: plugin.display?.description,
    }))

  // Wait for the server's answer so an empty shelf never flashes before the rows arrive.
  const ready = () => installed.pluginStatus() === "ready"

  const waiting = () => installed.pluginStatus() === "loading"

  return (
    <>
      <div data-slot="replica-sidebar-header" data-ui="sidebar-header" class={HEADER}>
        <h1 data-slot="replica-sidebar-title" class={TITLE}>
          {language.t("replica.nav.title.explore")}
        </h1>
      </div>

      <div class={`${LIST} px-2`}>
        <For each={EXPLORE_SECTIONS}>
          {(shelf) => (
            <button
              type="button"
              data-replica-control
              data-slot="replica-row"
              class={ROW}
              data-state={section() === shelf ? "pressed" : undefined}
              aria-pressed={section() === shelf}
              onClick={() => layout.destination.explore.setSection(shelf)}
            >
              <Dynamic component={SECTIONS[shelf].icon} class="size-4 shrink-0 text-[var(--color-icon-secondary)]" />
              <span class="min-w-0 flex-1 truncate">{language.t(SECTIONS[shelf].labelKey)}</span>
            </button>
          )}
        </For>
      </div>

      <Show
        when={ready()}
        fallback={
          <Show when={waiting()}>
            <div class="px-2">
              <ExploreSkeleton rows={3} />
            </div>
          </Show>
        }
      >
        <div data-slot="replica-sidebar-scroll" class="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <section class="flex flex-col">
            <h2 class={SECTION}>{language.t("explore.nav.installed")}</h2>
            <Show
              when={items().length > 0}
              fallback={
                <p class="px-2 py-2 text-[13px] leading-[var(--line-height-compact)] text-[var(--color-text-secondary)]">
                  {language.t("explore.plugins.empty.title")}
                </p>
              }
            >
              <div class={LIST}>
                <For each={items()}>
                  {(item) => (
                    <button
                      type="button"
                      data-replica-control
                      data-slot="replica-installed-row"
                      title={item.label}
                      data-state={layout.destination.explore.selected() === item.id ? "pressed" : undefined}
                      onClick={() => {
                        // The installed shelf lists plugins, so opening one from the skills shelf still lands on the
                        // plugins page; the section setter clears the selection it replaces.
                        layout.destination.explore.setSection("plugins")
                        layout.destination.explore.setSelected(item.id)
                      }}
                    >
                      <span data-slot="replica-installed-icon">
                        <PluginIcon />
                      </span>
                      <span data-slot="replica-installed-copy">
                        <span data-slot="replica-installed-name">{item.label}</span>
                        <Show when={item.description}>
                          {(description) => (
                            <span data-slot="replica-installed-description">{description()}</span>
                          )}
                        </Show>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>
      </Show>
    </>
  )
}
