import { For } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import { useLayout } from "@/shell/state/layout"

type RailItem = { id: "home" | "history" | "explore" | "more"; icon: IconName; labelKey: string; path?: string }

const ITEMS: readonly RailItem[] = [
  { id: "home", icon: "workspace", labelKey: "replica.rail.home", path: "/" },
  { id: "history", icon: "outline-list-changelog", labelKey: "replica.rail.history", path: "/inbox" },
  { id: "explore", icon: "outline-globe", labelKey: "replica.rail.explore", path: "/knowledge" },
  { id: "more", icon: "outline-dots", labelKey: "replica.rail.more" },
]

const BUTTON =
  "flex size-[30px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-icon-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-icon-primary)] data-[state=pressed]:bg-[var(--color-selected)] data-[state=pressed]:text-[var(--color-icon-primary)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--color-icon-secondary)]"

/** The 46px first-level rail: four navigation entries, with updates and settings pinned to the bottom. */
export function ReplicaRail() {
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const command = useCommand()

  const active = (id: RailItem["id"]) => {
    const type = layout.route().type

    if (id === "home") return type === "home"

    if (id === "history") return type === "inbox"

    if (id === "explore") return type === "knowledge"

    return false
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
                onClick={() => (item.path ? navigate(item.path) : command.trigger("command.palette"))}
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
            <Icon name="download" />
          </button>
        </Tooltip>
        <Tooltip placement="bottom" value={language.t("replica.rail.settings")}>
          <button
            type="button"
            data-replica-control
            aria-label={language.t("replica.rail.settings")}
            class={BUTTON}
            onClick={() => navigate("/settings")}
          >
            <Icon name="settings-gear" />
          </button>
        </Tooltip>
      </div>
    </nav>
  )
}
