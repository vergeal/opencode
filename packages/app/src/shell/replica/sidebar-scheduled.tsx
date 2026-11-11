import { For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useScheduled } from "@/scheduled/context"
import { taskName } from "@/scheduled/describe"
import { FILTER_LABELS, SCHEDULED_FILTERS } from "@/scheduled/model"
import { FILTER, HEADER, LIST, PRIMARY, ROW, SEARCH, TITLE } from "./sidebar-tokens"

const DOT: Record<string, string> = {
  active: "bg-[var(--v2-state-fg-success)]",
  paused: "bg-[var(--color-text-faint)]",
  done: "bg-[var(--color-text-faint)]",
  failed: "bg-[var(--v2-state-fg-danger)]",
}

const dot = (task: { status: string; lastOutcome?: string }) =>
  task.lastOutcome === "failed" ? DOT.failed : (DOT[task.status] ?? DOT.paused)

/** The scheduled-task navigation column: the task list and its filters lead into the open task's detail. */
export function ScheduledNav() {
  const language = useLanguage()
  const layout = useLayout()
  const scheduled = useScheduled()

  const tasks = () => scheduled.visible()

  const select = (id: string) => layout.destination.scheduled.setSelected(id)

  return (
    <>
      <div data-slot="replica-sidebar-header" data-ui="sidebar-header" class={HEADER}>
        <h1 data-slot="replica-sidebar-title" class={TITLE}>
          {language.t("replica.nav.title.scheduled")}
        </h1>
        <Show when={scheduled.state().status === "loading" || scheduled.state().status === "refreshing"}>
          <Loader class="ms-auto shrink-0 text-[var(--color-icon-secondary)]" />
        </Show>
      </div>

      <button type="button" data-replica-control data-slot="replica-new-chat" class={PRIMARY} onClick={scheduled.openNew}>
        <Icon name="plus" class="shrink-0 text-[var(--color-icon-secondary)]" />
        <span class="min-w-0 truncate">{language.t("replica.nav.newTask")}</span>
      </button>

      <div class="mt-2 flex flex-wrap gap-1 px-2">
        <For each={SCHEDULED_FILTERS}>
          {(key) => (
            <button
              type="button"
              data-replica-control
              class={FILTER}
              data-selected={scheduled.filter() === key ? "" : undefined}
              aria-pressed={scheduled.filter() === key}
              onClick={() => scheduled.setFilter(key)}
            >
              <span class="min-w-0 truncate">{language.t(FILTER_LABELS[key])}</span>
              <span class="ms-1 tabular-nums opacity-60">{scheduled.counts()[key] ?? 0}</span>
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
          placeholder={language.t("scheduled.search.placeholder")}
          aria-label={language.t("scheduled.search.placeholder")}
          value={scheduled.query()}
          onInput={(event) => scheduled.setQuery(event.currentTarget.value)}
        />
      </label>

      <div
        data-slot="replica-sidebar-scroll"
        class="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        onKeyDown={(event) => {
          const keys = ["ArrowDown", "ArrowUp", "Home", "End"]

          if (!keys.includes(event.key)) return

          const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-ui="scheduled-row"]')]
          const index = rows.findIndex((row) => row === document.activeElement)

          if (index === -1) return
          event.preventDefault()

          const go = (to: number) => {
            const row = rows[to]

            if (!row) return

            row.focus()
            const next = tasks()[to]

            if (next) select(next.id)
          }

          if (event.key === "Home") return go(0)

          if (event.key === "End") return go(rows.length - 1)

          go(index + (event.key === "ArrowUp" ? -1 : 1))
        }}
      >
        <Show
          when={tasks().length > 0}
          fallback={
            <p class="px-2 py-6 text-center text-[12px] leading-[var(--line-height-compact)] text-[var(--color-text-secondary)]">
              {language.t(scheduled.tasks().length === 0 ? "scheduled.empty" : "scheduled.empty.noMatch")}
            </p>
          }
        >
          <div class={LIST}>
            <For each={tasks()}>
              {(task) => (
                <button
                  type="button"
                  data-slot="replica-row"
                  data-ui="scheduled-row"
                  data-status={task.status}
                  data-outcome={task.lastOutcome}
                  data-state={scheduled.selected() === task.id ? "pressed" : undefined}
                  class={ROW}
                  onClick={() => select(task.id)}
                >
                  <Icon name="refresh" class="size-4 shrink-0 text-[var(--color-icon-secondary)]" />
                  <span class="min-w-0 flex-1 truncate">{taskName(task, language)}</span>
                  <span class={`size-[6px] shrink-0 rounded-full ${dot(task)}`} aria-hidden="true" />
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}
