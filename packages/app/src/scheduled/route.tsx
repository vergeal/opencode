import { ClientError, type ScheduleInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { Option, Schema } from "effect"
import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { sessionHref } from "@/shell/routes/session"
import { PageHeader, PagePanel, PageToolbar } from "@/shell/page"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { describeOutcome, describeStatus, describeWhen, formatTime, taskName } from "./describe"
import { tasksOf, transition, type TaskEvent, type TaskState } from "./machine"
import { NewScheduledTaskDialog, type NewTaskInput } from "./new-dialog"
import "./scheduled.css"

type Filter = "all" | "active" | "paused" | "failed"

const FILTERS: ReadonlyArray<Filter> = ["all", "active", "paused", "failed"]

const FILTER_LABELS: Record<Filter, string> = {
  all: "scheduled.filter.all",
  active: "scheduled.filter.active",
  paused: "scheduled.filter.paused",
  failed: "scheduled.filter.failed",
}

/** The API answers 403 when experimental.schedules is off where the Session lives. */
function isDisabled(error: ClientError) {
  if (error.reason !== "UnexpectedStatus") return false

  const status = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.Number }))(error.cause)

  return Option.match(status, { onNone: () => false, onSome: (cause) => cause.status === 403 })
}

/** A failed outcome is the one filter that reads the result rather than the lifecycle status. */
function matches(task: ScheduleInfo, filter: Filter) {
  if (filter === "all") return true

  if (filter === "failed") return task.lastOutcome === "failed"

  return task.status === filter
}

function promptOf(task: ScheduleInfo) {
  return task.action.type === "prompt" ? task.action.prompt : ""
}

export function ScheduledScreen() {
  const language = useLanguage()
  const servers = useServers()
  const global = useGlobal()
  const dialog = useDialog()

  const connection = () => servers.list[0]

  const context = () => {
    const conn = connection()

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  }

  const api = () => context()?.sdk.api

  const [state, setState] = createSignal<TaskState>({ status: "loading" })
  const dispatch = (event: TaskEvent) => setState((current) => transition(current, event))

  const [query, setQuery] = createSignal("")
  const [filter, setFilter] = createSignal<Filter>("all")
  const [selected, setSelected] = createSignal<string>()
  const [busy, setBusy] = createSignal<string>()

  const tasks = () => tasksOf(state())

  const load = async () => {
    const client = api()

    if (!client) return

    dispatch({ type: "load.started" })

    try {
      dispatch({ type: "load.succeeded", tasks: await client.experimental.schedule.list({}) })
    } catch (error) {
      dispatch({ type: "load.failed", message: errorMessage(error, language.t("common.requestFailed")) })
    }
  }

  createEffect(
    on(
      () => Boolean(api()),
      (ready) => {
        if (ready) void load()
      },
    ),
  )

  const visible = createMemo(() => {
    const needle = query().trim().toLocaleLowerCase()
    const current = filter()

    return tasks()
      .filter((task) => matches(task, current))
      .filter((task) => {
        if (!needle) return true

        return `${task.name ?? ""}\n${promptOf(task)}`.toLocaleLowerCase().includes(needle)
      })
      .toSorted((a, b) => {
        if (a.status !== b.status) return a.status === "active" ? -1 : b.status === "active" ? 1 : 0

        return (a.nextDueAt ?? Infinity) - (b.nextDueAt ?? Infinity)
      })
  })

  const counts = createMemo(() =>
    Object.fromEntries(FILTERS.map((key) => [key, tasks().filter((task) => matches(task, key)).length])),
  )

  const current = createMemo(() => visible().find((task) => task.id === selected()))

  createEffect(
    on(
      () => visible(),
      (items) => {
        const id = selected()

        if (id && items.some((task) => task.id === id)) return

        setSelected(items[0]?.id)
      },
    ),
  )

  const replace = (task: ScheduleInfo) => dispatch({ type: "task.upserted", task })

  const setStatus = async (task: ScheduleInfo, action: "pause" | "resume") => {
    const client = api()

    if (!client || busy()) return

    setBusy(task.id)

    try {
      const updated =
        action === "pause"
          ? await client.experimental.schedule.pause({ scheduleID: task.id })
          : await client.experimental.schedule.resume({ scheduleID: task.id })

      replace(updated)
    } catch (error) {
      const failure = error instanceof ClientError ? error : undefined

      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description:
          failure && isDisabled(failure)
            ? language.t("scheduled.disabled.description")
            : errorMessage(error, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const remove = async (task: ScheduleInfo) => {
    const client = api()

    if (!client || busy()) return

    setBusy(task.id)

    try {
      await client.experimental.schedule.delete({ scheduleID: task.id })
      dispatch({ type: "task.removed", id: task.id })

      if (selected() === task.id) setSelected(undefined)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: errorMessage(error, language.t("common.requestFailed")),
      })
    } finally {
      setBusy(undefined)
    }
  }

  const create = async (input: NewTaskInput) => {
    const client = api()

    if (!client) return false

    try {
      const session = await client.session.create({ location: { directory: input.directory }, title: input.name })

      const schedule = await client.experimental.schedule.create({
        sessionID: session.id,
        name: input.name,
        prompt: input.prompt,
        when: input.when,
      })

      replace(schedule)
      setSelected(schedule.id)
      setFilter("all")
      setQuery("")

      // A create that lands before the first listing finished still has to appear.
      if (state().status === "loading") void load()

      return true
    } catch (error) {
      const failure = error instanceof ClientError ? error : undefined
      const disabled = failure !== undefined && isDisabled(failure)

      showToast({
        variant: "error",
        title: disabled ? language.t("scheduled.disabled.title") : language.t("scheduled.create.failed"),
        description: disabled
          ? language.t("scheduled.disabled.description")
          : errorMessage(error, language.t("common.requestFailed")),
      })

      return false
    }
  }

  const error = createMemo(() => {
    const current = state()

    return current.status === "error" ? current.message : undefined
  })

  const openNew = () => {
    const directory = context()?.data.session.list()[0]?.location.directory ?? ""

    void dialog.show(() => <NewScheduledTaskDialog directory={directory} onCreate={create} />)
  }

  const confirmRemove = (task: ScheduleInfo) =>
    dialog.show(() => (
      <DeleteDialog
        name={taskName(task, language)}
        onConfirm={() => {
          dialog.close()
          void remove(task)
        }}
      />
    ))

  return (
    <PagePanel>
      <PageHeader
        title={language.t("scheduled.title")}
        description={language.t("scheduled.description")}
        actions={
          <Button variant="contrast" size="small" icon="plus" onClick={openNew}>
            {language.t("scheduled.new")}
          </Button>
        }
      />

      <PageToolbar>
        <div class="scheduled-filters" role="group" aria-label={language.t("scheduled.filter.all")}>
          <For each={FILTERS}>
            {(key) => (
              <Button
                size="small"
                variant={filter() === key ? "contrast" : "ghost-muted"}
                aria-pressed={filter() === key}
                onClick={() => setFilter(key)}
              >
                {language.t(FILTER_LABELS[key])}
                <span class="scheduled-filter-count">{counts()[key] ?? 0}</span>
              </Button>
            )}
          </For>
        </div>
        <div class="scheduled-search">
          <TextInput
            value={query()}
            placeholder={language.t("scheduled.search.placeholder")}
            aria-label={language.t("scheduled.search.placeholder")}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <Show when={state().status === "refreshing"}>
          <Loader class="size-4 shrink-0" />
        </Show>
      </PageToolbar>

      <div class="scheduled-body">
        <aside
          class="scheduled-list"
          data-scrollable
          onKeyDown={(event) => {
            const keys = ["ArrowDown", "ArrowUp", "Home", "End"]

            if (!keys.includes(event.key)) return

            const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button.scheduled-row")]
            const index = rows.findIndex((row) => row === document.activeElement)

            if (index === -1) return
            event.preventDefault()

            const last = rows.length - 1

            const go = (to: number) => {
              const row = rows[to]

              if (!row) return

              row.focus()
              const task = visible()[to]

              if (task) setSelected(task.id)
            }

            if (event.key === "Home") return go(0)

            if (event.key === "End") return go(last)

            go(index + (event.key === "ArrowUp" ? -1 : 1))
          }}
        >
          <Show
            when={state().status !== "loading"}
            fallback={
              <div class="scheduled-list-loading">
                <Loader />
              </div>
            }
          >
            <Show
              when={visible().length > 0}
              fallback={
                <div class="scheduled-empty-state">
                  <p class="scheduled-empty">
                    {tasks().length === 0 ? language.t("scheduled.empty") : language.t("scheduled.empty.noMatch")}
                  </p>
                  <Button size="small" variant="neutral" onClick={openNew}>
                    {language.t("scheduled.new")}
                  </Button>
                </div>
              }
            >
              <For each={visible()}>
                {(task) => (
                  <button
                    type="button"
                    class="scheduled-row"
                    data-selected={selected() === task.id ? "" : undefined}
                    onClick={() => setSelected(task.id)}
                  >
                    <span class="scheduled-row-head">
                      <span class="scheduled-row-name">{taskName(task, language)}</span>
                      <span class="scheduled-row-time">{formatTime(task.nextDueAt)}</span>
                    </span>
                    <span class="scheduled-row-when">{describeWhen(task, language)}</span>
                    <span class="scheduled-row-meta">
                      <span class="scheduled-dot" data-status={task.status} data-outcome={task.lastOutcome} />
                      <span>{describeStatus(task.status, language)}</span>
                      <span class="scheduled-sep" />
                      <span>
                        {language.t("scheduled.detail.runs")} {task.runCount}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </aside>

        <section class="scheduled-detail" data-scrollable>
          <Show when={error()}>
            {(message) => (
              <div class="scheduled-error" role="alert">
                <span class="scheduled-error-message">
                  {language.t("scheduled.error.title")} · {message()}
                </span>
                <Button size="small" variant="neutral" onClick={() => void load()}>
                  {language.t("scheduled.retry")}
                </Button>
              </div>
            )}
          </Show>

          <Show
            when={current()}
            fallback={
              <Show
                when={state().status === "loading"}
                fallback={
                  <div class="scheduled-placeholder">
                    <p class="scheduled-placeholder-title">{language.t("scheduled.detail.select.title")}</p>
                    <p class="scheduled-placeholder-description">
                      {language.t("scheduled.detail.select.description")}
                    </p>
                  </div>
                }
              >
                <div class="scheduled-placeholder">
                  <Loader />
                </div>
              </Show>
            }
          >
            {(task) => (
              <>
                  <div class="scheduled-detail-head">
                    <div class="scheduled-detail-heading">
                      <h2>{taskName(task(), language)}</h2>
                      <p>
                        {describeWhen(task(), language)}
                        <span class="scheduled-sep" />
                        {task().tz}
                      </p>
                    </div>
                    <div class="scheduled-detail-actions">
                      <Show when={task().status !== "done"}>
                        <Button
                          size="small"
                          variant="neutral"
                          disabled={busy() === task().id}
                          onClick={() => void setStatus(task(), task().status === "paused" ? "resume" : "pause")}
                        >
                          {language.t(
                            task().status === "paused" ? "scheduled.detail.resume" : "scheduled.detail.pause",
                          )}
                        </Button>
                      </Show>
                      <Button
                        size="small"
                        variant="ghost-danger"
                        icon="outline-trash"
                        disabled={busy() === task().id}
                        onClick={() => void confirmRemove(task())}
                      >
                        {language.t("scheduled.detail.delete")}
                      </Button>
                    </div>
                  </div>

                  <div class="scheduled-status-line">
                    <span class="scheduled-status" data-status={task().status}>
                      {language.t(`scheduled.status.${task().status}`)}
                    </span>
                  </div>

                  <dl class="scheduled-facts">
                    <div>
                      <dt>{language.t("scheduled.detail.next")}</dt>
                      <dd>{formatTime(task().nextDueAt)}</dd>
                    </div>
                    <div>
                      <dt>{language.t("scheduled.detail.runs")}</dt>
                      <dd>{task().runCount}</dd>
                    </div>
                    <div>
                      <dt>{language.t("scheduled.detail.last")}</dt>
                      <dd>{task().lastOutcome ? describeOutcome(task().lastOutcome, language) : "—"}</dd>
                    </div>
                    <div>
                      <dt>{language.t("scheduled.detail.timezone")}</dt>
                      <dd>{task().tz}</dd>
                    </div>
                  </dl>

                  <div class="scheduled-section">
                    <span class="scheduled-section-label">{language.t("scheduled.detail.recent")}</span>
                    <Show
                      when={task().lastFiredAt}
                      fallback={
                        <p class="scheduled-placeholder-description">{language.t("scheduled.detail.recent.empty")}</p>
                      }
                    >
                      {(firedAt) => (
                        <div class="scheduled-run-row">
                          <span class="scheduled-dot" data-status={task().status} data-outcome={task().lastOutcome} />
                          <span class="scheduled-run-time">{formatTime(firedAt())}</span>
                          <span class="scheduled-run-outcome">
                            {task().lastOutcome ? describeOutcome(task().lastOutcome, language) : "—"}
                          </span>
                        </div>
                      )}
                    </Show>
                  </div>

                  <div class="scheduled-section">
                    <span class="scheduled-section-label">{language.t("scheduled.detail.prompt")}</span>
                    <pre class="scheduled-prompt">{promptOf(task())}</pre>
                  </div>

                  <Show when={task().lastOutput?.trim()}>
                    {(output) => (
                      <div class="scheduled-section">
                        <span class="scheduled-section-label">{language.t("scheduled.detail.output")}</span>
                        <pre class="scheduled-output">{output()}</pre>
                      </div>
                    )}
                  </Show>

                  <Show when={task().sessionID}>
                    {(sessionID) => (
                      <div class="scheduled-section">
                        <span class="scheduled-section-label">{language.t("scheduled.detail.session")}</span>
                        <a
                          class="scheduled-session-link"
                          // SAFETY: AppLayout renders this route only when at least one server is connected.
                          href={sessionHref(ServerConnection.key(connection()!), sessionID())}
                        >
                          {language.t("scheduled.detail.openSession")}
                          <Icon name="arrow-up-right" size="small" />
                        </a>
                      </div>
                    )}
                  </Show>
                </>
              )}
            </Show>
        </section>
      </div>
    </PagePanel>
  )
}

function DeleteDialog(props: { name: string; onConfirm: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("scheduled.detail.delete.title")}
          description={language.t("scheduled.detail.delete.description", { name: props.name })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="neutral" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" onClick={props.onConfirm}>
          {language.t("scheduled.detail.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
