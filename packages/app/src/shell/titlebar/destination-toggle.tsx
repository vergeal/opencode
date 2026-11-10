import { For, Show, createSignal } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"

const DESTINATIONS = [
  { id: "home", labelKey: "home.title", icon: "workspace", command: "destination.home" },
  { id: "inbox", labelKey: "inbox.title", icon: "bubble-5", command: "destination.inbox" },
  { id: "knowledge", labelKey: "knowledge.title", icon: "file-document", command: "destination.knowledge" },
  { id: "scheduled", labelKey: "scheduled.title", icon: "checklist", command: "destination.scheduled" },
] as const satisfies ReadonlyArray<{ id: string; labelKey: string; icon: IconName; command: string }>

export type DestinationID = (typeof DESTINATIONS)[number]["id"]

/**
 * The four destinations as one row of equal switches. The row is a keyboard group: only the focused switch is in
 * the tab order, and the arrow keys move between them, so the sidebar list below stays one Tab away.
 */
export function DestinationToggle(props: {
  pressed: (id: DestinationID) => boolean
  onSelect: (id: DestinationID) => void
  /** Items waiting for a decision, shown as a dot and spelled out in the inbox tooltip. */
  pending?: number
}) {
  const language = useLanguage()
  const command = useCommand()
  const [focus, setFocus] = createSignal(0)
  let row: HTMLDivElement | undefined

  const move = (index: number, direction: -1 | 1) => {
    const next = (index + direction + DESTINATIONS.length) % DESTINATIONS.length
    setFocus(next)
    row?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
  }

  return (
    <div
      ref={row}
      data-slot="destination-toggle"
      role="group"
      aria-label={language.t("inbox.title")}
      class="flex h-7 w-full shrink-0 items-center gap-0.5"
    >
      <For each={DESTINATIONS}>
        {(item, index) => (
          <Tooltip
            placement="bottom"
            value={
              <>
                {language.t(item.labelKey)}
                <Show when={item.id === "inbox" && props.pending}>
                  <span> · {language.plural("inbox.pending", props.pending ?? 0)}</span>
                </Show>
                <Keybind keys={command.keybindParts(item.command)} variant="neutral" />
              </>
            }
          >
            <button
              type="button"
              data-action={`vertical-tabs-${item.id}`}
              data-state={props.pressed(item.id) ? "pressed" : undefined}
              aria-pressed={props.pressed(item.id)}
              aria-label={language.t(item.labelKey)}
              tabIndex={focus() === index() ? 0 : -1}
              class="relative flex h-7 min-w-0 flex-1 items-center justify-center rounded-[6px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base data-[state=pressed]:text-v2-text-text-base"
              onClick={() => props.onSelect(item.id)}
              onFocus={() => setFocus(index())}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault()
                  move(index(), 1)
                }

                if (event.key === "ArrowLeft") {
                  event.preventDefault()
                  move(index(), -1)
                }
              }}
            >
              <Icon name={item.icon} />
              <Show when={item.id === "inbox" && (props.pending ?? 0) > 0}>
                <span
                  data-slot="destination-unread"
                  class="absolute end-1.5 top-1 size-1.5 rounded-full bg-v2-text-text-accent"
                  aria-hidden="true"
                />
              </Show>
            </button>
          </Tooltip>
        )}
      </For>
    </div>
  )
}
