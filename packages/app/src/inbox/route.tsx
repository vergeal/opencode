import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useNavigate } from "@solidjs/router"
import { createMediaQuery } from "@solid-primitives/media"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { PageHeader, PagePanel, PageToolbar } from "@/shell/page"
import { getRelativeTime } from "@/shell/time"
import { InboxDetail } from "./detail"
import { createInbox, type InboxItem, type InboxStatus } from "./model"

const FILTERS = ["all", "pending", "failed", "done"] as const

const FILTER_LABELS = {
  all: "inbox.filter.all",
  pending: "inbox.filter.pending",
  failed: "inbox.filter.failed",
  done: "inbox.filter.done",
} as const

const FILTER_STATUS: Record<(typeof FILTERS)[number], InboxStatus | undefined> = {
  all: undefined,
  pending: "pending",
  failed: "failed",
  done: "done",
}

const KIND_ICONS = {
  approval: "check",
  question: "bubble-5",
  failure: "outline-hexagonal-warning",
  output: "terminal",
  result: "file-document",
} as const

const STATUS_DOTS = {
  pending: "bg-v2-text-text-accent",
  failed: "bg-v2-state-fg-danger",
  done: "bg-v2-text-text-faint",
} as const

/**
 * The inbox is where runs that need a decision land: an output to accept, a failure to look at, a permission
 * request or a question to answer. The left column is the directory and the right column the decision.
 */
export function InboxScreen() {
  const language = useLanguage()
  const navigate = useNavigate()
  const mobile = createMediaQuery("(max-width: 767px)")
  const inbox = createInbox()

  const [filter, setFilter] = createSignal<(typeof FILTERS)[number]>("all")
  const [selected, setSelected] = createSignal<string | undefined>()

  const items = createMemo(() => {
    const status = FILTER_STATUS[filter()]

    return status ? inbox.items().filter((item) => item.status === status) : inbox.items()
  })

  const current = createMemo(() => {
    const key = selected()
    const item = key ? inbox.items().find((candidate) => candidate.key === key) : undefined

    return item
  })

  // The detail panel is the decision, not a page of its own, so it opens once and hides again when the item leaves.
  const open = (item: InboxItem) => {
    setSelected(item.key)
    inbox.markSeen(item)
  }

  const follow = (item: InboxItem) => {
    switch (item.source.type) {
      case "session":
        inbox.openSession(item)
        break
      case "schedule":
        navigate("/scheduled")
        break
      case "knowledge":
        navigate("/knowledge")
        break
    }
  }

  const count = (key: (typeof FILTERS)[number]) => {
    const status = FILTER_STATUS[key]

    return status ? inbox.count(status) : inbox.items().length
  }

  return (
    <PagePanel>
      <PageHeader
        title={language.t("inbox.title")}
        description={language.t("inbox.description")}
        actions={
          <div class="flex items-center gap-2">
            <Show when={inbox.loading()}>
              <Loader class="text-v2-text-text-faint" />
            </Show>
            <p role="status" class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
              {language.plural("inbox.pending", inbox.count("pending"))}
            </p>
          </div>
        }
      />

      <PageToolbar>
        <div role="group" aria-label={language.t("inbox.filter.ariaLabel")} class="flex items-center gap-1">
          <For each={FILTERS}>
            {(key) => (
              <Button
                size="small"
                variant={filter() === key ? "contrast" : "ghost-muted"}
                aria-pressed={filter() === key}
                onClick={() => setFilter(key)}
              >
                {language.t(FILTER_LABELS[key])}
                <span class="tabular-nums opacity-60">{count(key)}</span>
              </Button>
            )}
          </For>
        </div>
      </PageToolbar>

      <div class="flex min-h-0 flex-1">
        <Show when={!mobile() || !current()}>
          <aside
            data-slot="inbox-list"
            data-scrollable
            aria-label={language.t("inbox.list.ariaLabel")}
            class="flex w-80 shrink-0 flex-col gap-0.5 overflow-y-auto border-e-[0.5px] border-v2-border-border-muted p-2 max-md:w-full max-md:border-e-0"
          >
            <Show
              when={items().length > 0}
              fallback={
                <div
                  role="status"
                  class="my-auto flex flex-col items-center gap-3 px-4 py-10 text-center"
                  data-slot="inbox-empty"
                >
                  <span class="flex size-9 items-center justify-center rounded-[9px] bg-v2-background-bg-layer-02 text-v2-icon-icon-muted">
                    <Icon name="notifications" />
                  </span>
                  <p class="text-[13px] leading-[var(--line-height-base)]">{language.t("inbox.empty")}</p>
                  <p class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                    {language.t("inbox.empty.hint")}
                  </p>
                  <Button size="small" variant="neutral" onClick={() => navigate("/scheduled")}>
                    {language.t("inbox.empty.action")}
                  </Button>
                </div>
              }
            >
              <For each={items()}>
                {(item) => (
                  <button
                    type="button"
                    data-slot="inbox-row"
                    data-kind={item.kind}
                    data-status={item.status}
                    data-unread={inbox.unread(item) ? "" : undefined}
                    data-selected={selected() === item.key ? "" : undefined}
                    aria-current={selected() === item.key ? "true" : undefined}
                    class="group flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-start hover:bg-v2-overlay-simple-overlay-hover data-[selected]:bg-v2-background-bg-layer-02"
                    onClick={() => open(item)}
                  >
                    <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center text-v2-icon-icon-muted">
                      <Icon name={KIND_ICONS[item.kind]} />
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span class="flex min-w-0 items-center gap-1.5">
                        <span class="min-w-0 truncate text-[13px] leading-[var(--line-height-compact)] font-medium">
                          {item.title}
                        </span>
                        <Show when={inbox.unread(item)}>
                          <span
                            data-slot="inbox-unread"
                            class="size-1.5 shrink-0 rounded-full bg-v2-text-text-accent"
                            aria-label={language.t("inbox.list.unread")}
                          />
                        </Show>
                      </span>
                      <span class="min-w-0 truncate text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                        {item.summary}
                      </span>
                      <span class="flex min-w-0 items-center gap-1.5 text-[11px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                        <span class={`size-1.5 shrink-0 rounded-full ${STATUS_DOTS[item.status]}`} aria-hidden="true" />
                        <span class="min-w-0 truncate">{item.source.name ?? item.source.id}</span>
                        <span class="shrink-0">{getRelativeTime(new Date(item.createdAt).toISOString(), language.t)}</span>
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </aside>
        </Show>

        <Show
          when={current()}
          fallback={
            <section
              data-slot="inbox-detail"
              class="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
            >
              <p class="text-[13px] leading-[var(--line-height-compact)] font-medium">
                {language.t("inbox.detail.select.title")}
              </p>
              <p class="max-w-80 text-[12px] leading-[var(--line-height-base)] text-v2-text-text-muted">
                {language.t("inbox.detail.select.description")}
              </p>
            </section>
          }
        >
          {(item) => (
            <section data-slot="inbox-detail" class="flex min-w-0 flex-1 flex-col overflow-hidden">
              <InboxDetail
                item={item()}
                inbox={inbox}
                onOpen={() => follow(item())}
                onBack={mobile() ? () => setSelected(undefined) : undefined}
              />
            </section>
          )}
        </Show>
      </div>
    </PagePanel>
  )
}
