import { For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { useExploreInstalled } from "@/explore/installed"
import { ExploreSkeleton } from "@/explore/skeleton"
import { pluginLabel } from "@/providers/catalog/plugin"
import { useLanguage } from "@/runtime/i18n/language"
import { EXPLORE_SECTIONS, useLayout, type ExploreSection } from "@/shell/state/layout"
import { HEADER, LIST, ROW, SECTION, TITLE } from "./sidebar-tokens"

const SECTIONS: Record<ExploreSection, { icon: IconName; labelKey: string }> = {
  plugins: { icon: "cube", labelKey: "explore.nav.plugins" },
  skills: { icon: "post-skill", labelKey: "explore.nav.skills" },
}

type NavItem = { id: string; label: string }

/** The explore navigation column: the two shelves, then what this project already has installed. */
export function ExploreNav() {
  const language = useLanguage()
  const layout = useLayout()
  const installed = useExploreInstalled()

  const section = () => layout.destination.explore.section()

  // Wait for the server's answer so an empty shelf never flashes before the rows arrive.
  const ready = () => (section() === "plugins" ? installed.pluginStatus() === "ready" : installed.skillsLoaded())

  const waiting = () => (section() === "plugins" ? installed.pluginStatus() === "loading" : !installed.skillsLoaded())

  const items = (): NavItem[] => {
    if (section() === "plugins") {
      return installed.plugins().map((plugin) => ({ id: plugin.id ?? pluginLabel(plugin), label: pluginLabel(plugin) }))
    }

    return installed.skills().map((skill) => ({ id: skill.id, label: skill.name }))
  }

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
              <Icon name={SECTIONS[shelf].icon} class="size-4 shrink-0 text-[var(--color-icon-secondary)]" />
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
                  {language.t(section() === "plugins" ? "explore.plugins.empty.title" : "explore.skills.empty.title")}
                </p>
              }
            >
              <div class={LIST}>
                <For each={items()}>
                  {(item) => (
                    <button
                      type="button"
                      data-replica-control
                      data-slot="replica-row"
                      class={ROW}
                      title={item.label}
                      data-state={layout.destination.explore.selected() === item.id ? "pressed" : undefined}
                      onClick={() => layout.destination.explore.setSelected(item.id)}
                    >
                      <span class="min-w-0 flex-1 truncate">{item.label}</span>
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
