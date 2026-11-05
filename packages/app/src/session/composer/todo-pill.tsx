import { Popover } from "@kobalte/core/popover"
import { Badge } from "@opencode/ui/badge"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { createEffect, createMemo, For, Match, on, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { composerLanePlacement, useComposerLaneAlignment } from "./composer-lane"
import { currentTodo, type Todo, type TodoStatus } from "./todos"
import "./todo-pill.css"

// The agent's plan as one capsule in the composer lane, beside the background activity capsule: the todo in hand,
// opening a popover with the whole list.
export function SessionTodoPill(props: { todos: readonly Todo[]; defaultOpen?: boolean }) {
  const language = useLanguage()
  const alignment = useComposerLaneAlignment()
  const [state, setState] = createStore({ open: props.defaultOpen ?? false })

  const done = createMemo(() => props.todos.filter((todo) => todo.status === "completed").length)
  const current = createMemo(() => currentTodo(props.todos))
  // The pill names the first todo in progress and counts the others running beside it.
  const more = createMemo(() => Math.max(0, props.todos.filter((todo) => todo.status === "in_progress").length - 1))
  const label = () => language.plural("session.todo.label", props.todos.length, { done: String(done()) })

  return (
    // Sits beside the activity capsule, on the side away from the lane's aligned edge.
    <div
      data-component="session-todo-pill"
      class="flex min-w-0 shrink"
      classList={{ "-order-1": alignment() === "end", "order-1": alignment() !== "end" }}
    >
      <Popover
        open={state.open}
        onOpenChange={(open) => setState("open", open)}
        placement={composerLanePlacement(alignment())}
        gutter={8}
      >
        <Popover.Trigger
          as="button"
          type="button"
          data-slot="session-todo-pill"
          data-composer-pill
          aria-label={label()}
          class="pointer-events-auto flex h-7 min-w-0 max-w-full items-center gap-2 rounded-[12px] border-[0.5px] border-v2-border-border-muted bg-v2-background-bg-base ps-2.5 pe-2.5 text-[15px] font-[400] leading-text-compact tracking-[-0.04px] whitespace-nowrap text-v2-text-text-base shadow-[var(--v2-elevation-raised)] outline-none"
        >
          <Show when={current()}>
            {(todo) => (
              <>
                <TodoGlyph status={todo().status} />
                <span dir="auto" class="min-w-0 max-w-[260px] truncate">
                  {todo().content}
                </span>
              </>
            )}
          </Show>
          <Show when={more() > 0}>
            <Badge data-slot="session-todo-more" dir="ltr" class="shrink-0">
              {language.t("session.todo.moreInProgress", { count: String(more()) })}
            </Badge>
          </Show>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            data-slot="session-todo-panel"
            data-composer-pill-panel
            aria-label={label()}
            class="outline-none"
          >
            <div class="flex items-center gap-2 px-2 pt-1 pb-1.5">
              <span class="flex-1 text-[12px] font-[530] uppercase leading-[var(--line-height-tight)] tracking-[0.05px] text-v2-text-text-muted">
                {language.t("session.todo.title")}
              </span>
              <span class="text-[12px] tabular-nums leading-[var(--line-height-tight)] text-v2-text-text-faint">
                {language.t("session.todo.progress", { done: String(done()), total: String(props.todos.length) })}
              </span>
            </div>
            <TodoList todos={props.todos} />
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </div>
  )
}

function TodoList(props: { todos: readonly Todo[] }) {
  let list: HTMLDivElement | undefined

  // Keep the todo in progress in view as the plan advances.
  createEffect(
    on(
      () => props.todos.findIndex((todo) => todo.status === "in_progress"),
      (index) => {
        if (index < 0 || !list) return
        list.querySelectorAll('[data-slot="session-todo-row"]')[index]?.scrollIntoView({ block: "nearest" })
      },
    ),
  )

  return (
    <MenuScroll
      data-slot="session-todo-list"
      class="max-h-[232px]"
      viewportClass="p-1"
      viewportRef={(element) => (list = element)}
    >
      <For each={props.todos}>
        {(todo) => (
          <div
            data-slot="session-todo-row"
            data-status={todo.status}
            class="flex shrink-0 items-start gap-2 rounded-[4px] px-1.5 py-1"
          >
            <span class="flex h-5 shrink-0 items-center">
              <TodoGlyph status={todo.status} />
            </span>
            <span
              dir="auto"
              data-slot="session-todo-text"
              class="min-w-0 flex-1 text-[15px] leading-[var(--line-height-compact)]"
            >
              {todo.content}
            </span>
          </div>
        )}
      </For>
    </MenuScroll>
  )
}

function TodoGlyph(props: { status: TodoStatus }) {
  return (
    <svg
      data-slot="session-todo-glyph"
      data-status={props.status}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      class="shrink-0"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
      <Switch>
        <Match when={props.status === "in_progress"}>
          <path d="M8 4a4 4 0 0 0 0 8V4Z" fill="currentColor" />
        </Match>
        <Match when={props.status === "completed"}>
          <path d="M5 8 7.5 11 11 5.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
        </Match>
        <Match when={props.status === "cancelled"}>
          <path d="M3.5 12.5 12.5 3.5" stroke="currentColor" />
        </Match>
      </Switch>
    </svg>
  )
}
