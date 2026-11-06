import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useNavigate } from "@solidjs/router"
import { createSignal, For } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { PageHeader, PagePanel, PageToolbar } from "@/shell/page"

const FILTERS = ["all", "pending", "failed", "done"] as const

const FILTER_LABELS = {
  all: "inbox.filter.all",
  pending: "inbox.filter.pending",
  failed: "inbox.filter.failed",
  done: "inbox.filter.done",
} as const

/**
 * The inbox is where scheduled runs land when they need a decision: an output to accept, a failure
 * to look at, a permission request to answer. The left column is the directory and the right column
 * explains the page whenever nothing is selected, so a producer can fill the list without moving the
 * frame again.
 */
export function InboxScreen() {
  const language = useLanguage()
  const navigate = useNavigate()
  const [filter, setFilter] = createSignal<(typeof FILTERS)[number]>("all")

  return (
    <PagePanel>
      <PageHeader title={language.t("inbox.title")} description={language.t("inbox.description")} />

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
              </Button>
            )}
          </For>
        </div>
      </PageToolbar>

      <div class="flex min-h-0 flex-1">
        <aside
          data-slot="inbox-list"
          data-scrollable
          class="flex w-80 shrink-0 flex-col overflow-y-auto border-e-[0.5px] border-v2-border-border-muted p-2"
        >
          <div role="status" class="my-auto flex flex-col items-center gap-3 px-4 py-10 text-center">
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
        </aside>

        <section
          data-slot="inbox-detail"
          data-scrollable
          class="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-6 text-center"
        >
          <p class="text-[13px] leading-[var(--line-height-compact)] font-medium">
            {language.t("inbox.detail.select.title")}
          </p>
          <p class="max-w-80 text-[12px] leading-[var(--line-height-base)] text-v2-text-text-muted">
            {language.t("inbox.detail.select.description")}
          </p>
        </section>
      </div>
    </PagePanel>
  )
}
