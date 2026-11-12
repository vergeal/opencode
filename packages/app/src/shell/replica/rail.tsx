import { For } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import { useSettingsDialog } from "@/settings/command"
import { tabHref, tabKey, tabMatchesRoute, useTabs } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"

type RailItem = {
  id: "home" | "inbox" | "scheduled" | "explore" | "knowledge" | "more"
  icon: IconName
  labelKey: string
  path?: string
}

const ITEMS: readonly RailItem[] = [
  { id: "home", icon: "rail-home", labelKey: "replica.rail.home", path: "/" },
  { id: "inbox", icon: "rail-inbox", labelKey: "replica.rail.inbox", path: "/inbox" },
  {
    id: "scheduled",
    icon: "rail-history",
    labelKey: "replica.rail.scheduled",
    path: "/scheduled",
  },
  {
    id: "knowledge",
    icon: "rail-library",
    labelKey: "replica.rail.knowledge",
    path: "/knowledge",
  },
  {
    id: "explore",
    icon: "rail-compass",
    labelKey: "replica.rail.explore",
    path: "/explore",
  },
  { id: "more", icon: "rail-more", labelKey: "replica.rail.more" },
]

const BUTTON =
  "flex size-[30px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-icon-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-icon-primary)] data-[state=pressed]:bg-[var(--color-selected)] data-[state=pressed]:text-[var(--color-icon-primary)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--color-icon-secondary)]"

/** The 46px first-level rail: four navigation entries, with updates and settings pinned to the bottom. */
export function ReplicaRail() {
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const command = useCommand()
  const tabs = useTabs()
  const openSettings = useSettingsDialog()

  const active = (id: RailItem["id"]) => {
    const type = layout.route().type

    if (id === "home") return type === "home" || type === "session" || type === "draft"

    if (id === "inbox") return type === "inbox"

    if (id === "scheduled") return type === "scheduled"

    if (id === "explore") return type === "explore"

    if (id === "knowledge") return type === "knowledge"

    return false
  }

  // Home keeps the conversation at hand: from anywhere else it returns to the last open conversation, and only
  // an empty tab history falls back to the new-chat page. A draft already is that page, so Home does nothing there.
  const goHome = () => {
    const route = layout.route()

    if (route.type === "home" || route.type === "draft") return

    const key = tabs.recentKey()
    const recent = key ? tabs.store.find((tab) => tabKey(tab) === key) : undefined

    if (recent && !tabMatchesRoute(recent, route)) {
      navigate(tabHref(recent))

      return
    }

    navigate("/")
  }

  return (
    <nav data-slot="replica-rail" data-ui="primary-rail" aria-label={language.t("replica.rail.label")}>
      <div class="flex w-full flex-col items-center gap-1">
        <For each={ITEMS}>
          {(item) => (
            <Tooltip placement="bottom" value={language.t(item.labelKey)}>
              <button
                type="button"
                data-replica-control
                data-state={active(item.id) ? "pressed" : undefined}
                aria-pressed={active(item.id)}
                aria-label={language.t(item.labelKey)}
                class={BUTTON}
                onClick={() => {
                  if (item.id === "home") {
                    goHome()

                    return
                  }

                  if (item.path) navigate(item.path)
                  else command.trigger("command.palette")
                }}
              >
                <Icon name={item.icon} />
              </button>
            </Tooltip>
          )}
        </For>
      </div>

      <div data-slot="replica-rail-bottom" data-ui="primary-rail-bottom">
        <Tooltip placement="bottom" value={language.t("replica.rail.updates")}>
          <button
            type="button"
            data-replica-control
            aria-label={language.t("replica.rail.updates")}
            class="flex size-[30px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-accent-blue)] hover:bg-[var(--color-hover)]"
            onClick={() => command.trigger("app.checkForUpdates")}
          >
            <Icon name="rail-download" />
          </button>
        </Tooltip>
        <Tooltip placement="bottom" value={language.t("replica.rail.settings")}>
          <button
            type="button"
            data-replica-control
            data-state={layout.route().type === "settings" ? "pressed" : undefined}
            aria-pressed={layout.route().type === "settings"}
            aria-label={language.t("replica.rail.settings")}
            class={BUTTON}
            onClick={openSettings}
          >
            <Icon name="settings-gear" />
          </button>
        </Tooltip>
      </div>
    </nav>
  )
}
