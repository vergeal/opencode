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

/** The 36px first-level icon column. It holds four entries: home, history, explore and the command menu. */
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
    <nav data-slot="replica-rail" aria-label={language.t("replica.rail.label")} class="flex flex-col items-center pt-2">
      <For each={ITEMS}>
        {(item) => (
          <Tooltip placement="bottom" value={language.t(item.labelKey)}>
            <button
              type="button"
              data-replica-control
              data-state={active(item.id) ? "pressed" : undefined}
              aria-pressed={active(item.id)}
              aria-label={language.t(item.labelKey)}
              class="mb-3 flex size-6 items-center justify-center rounded-[5px] text-[var(--icon-secondary)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--icon-secondary)]"
              onClick={() => (item.path ? navigate(item.path) : command.trigger("command.palette"))}
            >
              <Icon name={item.icon} size="small" />
            </button>
          </Tooltip>
        )}
      </For>
    </nav>
  )
}
