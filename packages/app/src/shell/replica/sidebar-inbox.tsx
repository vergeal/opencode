import { createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useInbox } from "@/inbox/context"
import {
  INBOX_FILTERS,
  INBOX_FILTER_LABELS,
  INBOX_FILTER_STATUS,
  INBOX_KIND_ICONS,
} from "@/inbox/filters"
import type { InboxItem } from "@/inbox/model"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { FILTER, HEADER, LIST, PRIMARY, ROW, SEARCH, TITLE } from "./sidebar-tokens"

const DOT: Record<string, string> = {
  pending: "bg-[var(--v2-state-fg-warning)]",
  failed: "bg-[var(--v2-state-fg-danger)]",
  done: "bg-[var(--v2-state-fg-success)]",
}

/** The inbox navigation column: the category filters over the messages that need a decision. */
export function InboxNav() {
  const language = useLanguage()
  const layout = useLayout()
  const inbox = useInbox()
  const [query, setQuery] = createSignal("")

  const filter = () => layout.destination.inbox.filter()

  const items = createMemo(() => {
    const status = INBOX_FILTER_STATUS[filter()]
    const needle = query().trim().toLocaleLowerCase()

    return inbox
      .items()
      .filter((item) => status === undefined || item.status === status)
      .filter((item) => {
        if (!needle) return true

        return `${item.title}\n${item.summary}\n${item.source.name ?? ""}`
          .toLocaleLowerCase()
          .includes(needle)
      })
  })

  const count = (key: (typeof INBOX_FILTERS)[number]) => {
    const status = INBOX_FILTER_STATUS[key]

    return status ? inbox.count(status) : inbox.items().length
  }

  const unread = () => items().filter((item) => inbox.unread(item)).length

  const open = (item: InboxItem) => {
    layout.destination.inbox.setSelected(item.key)
    inbox.markSeen(item)
  }

  return (
    <>
      <div data-slot="replica-sidebar-header" data-ui="sidebar-header" class={HEADER}>
        <h1 data-slot="replica-sidebar-title" class={TITLE}>
          {language.t("replica.nav.title.inbox")}
        </h1>
        <Show when={inbox.loading()}>
          <Loader class="ms-auto shrink-0 text-[var(--color-icon-secondary)]" />
        </Show>
      </div>

      <button
        type="button"
        data-replica-control
        data-slot="replica-new-chat"
        class={PRIMARY}
        disabled={unread() === 0}
        onClick={() => inbox.markAllSeen(items())}
      >
        <Icon name="check" class="shrink-0 text-[var(--color-icon-secondary)]" />
        <span class="min-w-0 truncate">{language.t("replica.nav.markAllRead")}</span>
      </button>

      <div class="mt-2 flex flex-wrap gap-1 px-2">
        <For each={INBOX_FILTERS}>
          {(key) => (
            <button
              type="button"
              data-replica-control
              class={FILTER}
              data-selected={filter() === key ? "" : undefined}
              aria-pressed={filter() === key}
              onClick={() => layout.destination.inbox.setFilter(key)}
            >
              <span class="min-w-0 truncate">{language.t(INBOX_FILTER_LABELS[key])}</span>
              <span class="ms-1 tabular-nums opacity-60">{count(key)}</span>
            </button>
          )}
        </For>
      </div>

      <label class={`${SEARCH} mt-2`}>
        <Icon name="magnifying-glass" size="small" class="shrink-0 text-[var(--color-icon-secondary)]" />
        <input
          type="search"
          data-replica-control
          class="min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-[var(--color-text-primary)] outline-none"
          placeholder={language.t("replica.nav.search")}
          aria-label={language.t("replica.nav.search")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>

      <div data-slot="replica-sidebar-scroll" class="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Show
          when={items().length > 0}
          fallback={
            <p class="px-2 py-6 text-center text-[12px] leading-[var(--line-height-compact)] text-[var(--color-text-secondary)]">
              {language.t("inbox.empty")}
            </p>
          }
        >
          <div class={LIST}>
            <For each={items()}>
              {(item) => (
                <button
                  type="button"
                  data-slot="replica-row"
                  data-ui="inbox-row"
                  data-kind={item.kind}
                  data-status={item.status}
                  data-unread={inbox.unread(item) ? "" : undefined}
                  data-state={layout.destination.inbox.selected() === item.key ? "pressed" : undefined}
                  class={ROW}
                  onClick={() => open(item)}
                >
                  <Icon
                    name={INBOX_KIND_ICONS[item.kind]}
                    class="size-4 shrink-0 text-[var(--color-icon-secondary)]"
                  />
                  <span class="min-w-0 flex-1 truncate">{item.title}</span>
                  <Show when={inbox.unread(item)}>
                    <span
                      data-slot="inbox-unread"
                      class="size-1.5 shrink-0 rounded-full bg-[var(--color-accent-blue)]"
                      aria-label={language.t("inbox.list.unread")}
                    />
                  </Show>
                  <span class={`size-[6px] shrink-0 rounded-full ${DOT[item.status]}`} aria-hidden="true" />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
