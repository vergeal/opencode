import { ClientError, type ScheduleInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { getFilename } from "@opencode/util/path"
import { Option, Schema } from "effect"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { PageHeader, PagePanel, PageToolbar } from "@/shell/page"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { parseSchedule, schedulePrompt } from "./cron"
import { describeOutcome, describeStatus, describeWhen, formatTime, taskName } from "./describe"
import { tasksOf, transition, type TaskEvent, type TaskState } from "./machine"
import { NewScheduledTaskDialog, type NewTaskInput } from "./new-dialog"
import "./scheduled.css"

type Filter = "all" | "active" | "paused" | "failed"

type RunLog = { id: string; at: number; text: string }

type Logs = { status: "idle" } | { status: "loading" } | { status: "ready"; entries: RunLog[] } | { status: "failed" }

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

/** A failed last run outranks the lifecycle status, so a task that just broke never reads as healthy. */
function toneOf(task: ScheduleInfo): "success" | "danger" | "neutral" {
  if (task.lastOutcome === "failed") return "danger"

  return task.status === "active" ? "success" : "neutral"
}

/** The first line of the last output, so a run row stays one line. */
function outputPreview(task: ScheduleInfo) {
  return task.lastOutput
    ?.split("\n")
    .find((line) => line.trim())
    ?.trim()
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

  /** A task only stores its session, so the project name comes from that session's directory. */
  const projects = createMemo(() => {
    const sessions = context()?.data.session.list() ?? []

    return new Map(sessions.map((session) => [session.id, session.location.directory] as const))
  })

  const directoryOf = (task: ScheduleInfo) => (task.sessionID ? projects().get(task.sessionID) : undefined)

  /** The projects a task can run in: the known worktrees, with the current session's folder when it is not one yet. */
  const projectOptions = createMemo(() => {
    const options = (context()?.projects.unique() ?? []).map((project) => ({
      directory: project.worktree,
      name: project.name || getFilename(project.worktree),
    }))
    const current = context()?.data.session.list()[0]?.location.directory

    if (current && !options.some((option) => option.directory === current))
      options.unshift({ directory: current, name: getFilename(current) })

    return options
  })

  const projectOf = (task: ScheduleInfo) => {
    const directory = directoryOf(task)

    if (!directory) return undefined

    return projectOptions().find((option) => option.directory === directory)?.name ?? getFilename(directory)
  }

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

  const [logs, setLogs] = createSignal<Logs>({ status: "idle" })

  /** Every scheduled run leaves one assistant message in its backing session; that is the execution log. */
  const loadLogs = async (task: ScheduleInfo) => {
    const client = api()
    const sessionID = task.sessionID

    if (!client || !sessionID) {
      setLogs({ status: "ready", entries: [] })

      return
    }

    const taskID = task.id
    setLogs({ status: "loading" })

    try {
      const result = await client.message.list({ sessionID, order: "desc", limit: 30 })

      if (selected() !== taskID) return

      setLogs({
        status: "ready",
        entries: result.data.flatMap((message) => {
          if (message.type !== "assistant") return []

          const text = message.content
            .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []))
            .join("\n\n")

          return text ? [{ id: message.id, at: message.time.created, text }] : []
        }),
      })
    } catch {
      if (selected() === taskID) setLogs({ status: "failed" })
    }
  }

  createEffect(
    on(
      () => [selected(), state().status === "ready"] as const,
      ([id, ready]) => {
        if (!ready) return

        const task = tasks().find((item) => item.id === id)

        if (!task) {
          setLogs({ status: "idle" })

          return
        }

        void loadLogs(task)
      },
    ),
  )

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

  const logEntries = () => {
    const value = logs()

    return value.status === "ready" ? value.entries : undefined
  }

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

      // The backing session only exists for this task, so it goes with it instead of staying archived forever.
      if (task.sessionID) await client.session.remove({ sessionID: task.sessionID }).catch(() => {})

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

  const infer = async (prompt: string) => {
    const client = api()

    if (!client) return

    try {
      const generated = await client.experimental.generate.text({ prompt: schedulePrompt(prompt) })

      return parseSchedule(generated.text)
    } catch {
      return
    }
  }

  const create = async (input: NewTaskInput) => {
    const client = api()

    if (!client) return false

    try {
      // The dialog already parsed the prompt, so a successful parse here is reused instead of generated again.
      const schedule = input.schedule ?? (await infer(input.prompt))

      // Without a schedule there is nothing to create, so keep the dialog open and explain what was missing.
      if (!schedule) {
        showToast({
          variant: "error",
          title: language.t("scheduled.create.parseFailed"),
          description: language.t("scheduled.create.parseFailed.description"),
        })

        return false
      }

      const session = await client.session.create({
        location: { directory: input.directory },
        title: input.name,
        permissions: input.permissions,
      })

      try {
        const created = await client.experimental.schedule.create({
          sessionID: session.id,
          name: input.name,
          prompt: input.prompt,
          when: { cron: schedule.cron, tz: schedule.timezone },
        })

        // New tasks start paused; the user enables one from the task list once it looks right.
        const saved = await client.experimental.schedule.pause({ scheduleID: created.id }).catch(() => created)

        // The task owns this session as its execution unit. Archiving keeps it out of conversations and tabs;
        // its assistant messages are the execution log shown in the task detail.
        await client.session.update({ sessionID: session.id, archived: true }).catch(() => {})

        replace(saved)
        setSelected(saved.id)
        setFilter("all")
        setQuery("")

        // A create that lands before the first listing finished still has to appear.
        if (state().status === "loading") void load()

        return true
      } catch (error) {
        // A task that never saved must not leave a visible empty session behind.
        await client.session.remove({ sessionID: session.id }).catch(() => {})

        throw error
      }
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
    const directory = projectOptions()[0]?.directory ?? ""

    void dialog.show(() => (
      <NewScheduledTaskDialog projects={projectOptions()} directory={directory} onCreate={create} onInfer={infer} />
    ))
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
    <PagePanel class="scheduled-page">
      <PageHeader
        title={language.t("scheduled.title")}
        description={language.t("scheduled.description")}
        actions={
          <button type="button" class="scheduled-primary" onClick={openNew}>
            <Icon name="plus" size="small" />
            {language.t("scheduled.new")}
          </button>
        }
      />

      <PageToolbar>
        <div class="scheduled-filters" role="group" aria-label={language.t("scheduled.filter.all")}>
          <For each={FILTERS}>
            {(key) => (
              <button
                type="button"
                class="scheduled-chip"
                data-selected={filter() === key ? "" : undefined}
                aria-pressed={filter() === key}
                onClick={() => setFilter(key)}
              >
                {language.t(FILTER_LABELS[key])}
                <span class="scheduled-chip-count">{counts()[key] ?? 0}</span>
              </button>
            )}
          </For>
        </div>
        <div class="scheduled-search">
          <TextInput
            appearance="base"
            surface="layer-1"
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
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
                    <span class="scheduled-row-icon" aria-hidden="true">
                      <Icon name="refresh" size="small" />
                    </span>
                    <span class="scheduled-row-body">
                      <span class="scheduled-row-top">
                        <span class="scheduled-row-name">{taskName(task, language)}</span>
                        <span class="scheduled-dot" data-status={task.status} data-outcome={task.lastOutcome} />
                      </span>
                      <span class="scheduled-row-sub">
                        <span>{describeWhen(task, language)}</span>
                        <Show when={projectOf(task)}>
                          {(project) => (
                            <>
                              <span class="scheduled-sep" />
                              <span>{project()}</span>
                            </>
                          )}
                        </Show>
                      </span>
                      <span class="scheduled-row-meta">
                        <Show
                          when={task.lastOutcome === "failed" || task.status !== "active"}
                          fallback={
                            <>
                              <span>
                                {language.t("scheduled.detail.next")} {formatTime(task.nextDueAt)}
                              </span>
                              <span class="scheduled-sep" />
                              <span>
                                {language.t("scheduled.detail.runs")} {task.runCount}
                              </span>
                            </>
                          }
                        >
                          <span class="scheduled-badge" data-tone={toneOf(task)}>
                            {task.lastOutcome === "failed"
                              ? describeOutcome("failed", language)
                              : describeStatus(task.status, language)}
                          </span>
                        </Show>
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
                    <p class="scheduled-placeholder-description">{language.t("scheduled.detail.select.description")}</p>
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
                    <div class="scheduled-detail-title-row">
                      <h2>{taskName(task(), language)}</h2>
                      <span class="scheduled-badge" data-tone={task().status === "active" ? "success" : "neutral"}>
                        {describeStatus(task().status, language)}
                      </span>
                      <Show when={task().lastOutcome === "failed"}>
                        <span class="scheduled-badge" data-tone="danger">
                          {describeOutcome("failed", language)}
                        </span>
                      </Show>
                    </div>
                    <p class="scheduled-detail-sub">
                      {describeWhen(task(), language)}
                      <span class="scheduled-sep" />
                      {task().tz}
                      <Show when={projectOf(task())}>
                        {(project) => (
                          <>
                            <span class="scheduled-sep" />
                            {project()}
                          </>
                        )}
                      </Show>
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
                        {language.t(task().status === "paused" ? "scheduled.detail.resume" : "scheduled.detail.pause")}
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

                <div class="scheduled-stats">
                  <div class="scheduled-stat">
                    <div class="scheduled-stat-key">{language.t("scheduled.detail.next")}</div>
                    <div class="scheduled-stat-value">{formatTime(task().nextDueAt)}</div>
                  </div>
                  <div class="scheduled-stat">
                    <div class="scheduled-stat-key">{language.t("scheduled.detail.directory")}</div>
                    <div class="scheduled-stat-value scheduled-stat-path">{projectOf(task()) ?? "—"}</div>
                  </div>
                  <div class="scheduled-stat">
                    <div class="scheduled-stat-key">{language.t("scheduled.detail.runs")}</div>
                    <div class="scheduled-stat-value">{task().runCount}</div>
                  </div>
                  <div class="scheduled-stat">
                    <div class="scheduled-stat-key">{language.t("scheduled.detail.last")}</div>
                    <div class="scheduled-stat-value scheduled-stat-path">
                      {task().lastOutcome ? describeOutcome(task().lastOutcome, language) : "—"}
                    </div>
                  </div>
                </div>

                <div class="scheduled-section">
                  <span class="scheduled-section-label">{language.t("scheduled.detail.recent")}</span>
                  <Show
                    when={task().lastFiredAt}
                    fallback={
                      <div class="scheduled-run">
                        <span class="scheduled-run-out">{language.t("scheduled.detail.recent.empty")}</span>
                      </div>
                    }
                  >
                    {(firedAt) => (
                      <div class="scheduled-run">
                        <span class="scheduled-dot" data-status={task().status} data-outcome={task().lastOutcome} />
                        <span class="scheduled-run-when">{formatTime(firedAt())}</span>
                        <span class="scheduled-run-out">
                          {outputPreview(task()) ??
                            (task().lastOutcome ? describeOutcome(task().lastOutcome, language) : "—")}
                        </span>
                        <span class="scheduled-run-right">
                          <Show when={task().lastOutcome}>
                            {(outcome) => (
                              <span class="scheduled-badge" data-tone={toneOf(task())}>
                                {describeOutcome(outcome(), language)}
                              </span>
                            )}
                          </Show>
                        </span>
                      </div>
                    )}
                  </Show>
                </div>

                <div class="scheduled-section">
                  <span class="scheduled-section-label">{language.t("scheduled.detail.prompt")}</span>
                  <pre class="scheduled-prompt">{promptOf(task())}</pre>
                </div>

                <div class="scheduled-section">
                  <span class="scheduled-section-label">{language.t("scheduled.detail.logs")}</span>
                  <Switch>
                    <Match when={logs().status === "loading"}>
                      <p class="scheduled-log-status" role="status">
                        <Loader class="size-3.5" />
                        {language.t("scheduled.detail.logs.loading")}
                      </p>
                    </Match>
                    <Match when={logs().status === "failed"}>
                      <div class="scheduled-log-status">
                        <span>{language.t("scheduled.detail.logs.failed")}</span>
                        <Button
                          size="small"
                          variant="neutral"
                          onClick={() => {
                            const value = current()

                            if (value) void loadLogs(value)
                          }}
                        >
                          {language.t("scheduled.retry")}
                        </Button>
                      </div>
                    </Match>
                    <Match when={logs().status === "ready"}>
                      <Show
                        when={logEntries()?.length}
                        fallback={<p class="scheduled-log-status">{language.t("scheduled.detail.logs.empty")}</p>}
                      >
                        <div class="scheduled-logs">
                          <For each={logEntries()}>
                            {(entry) => (
                              <article class="scheduled-log">
                                <time class="scheduled-log-time">{formatTime(entry.at)}</time>
                                <pre class="scheduled-log-text">{entry.text}</pre>
                              </article>
                            )}
                          </For>
                        </div>
                      </Show>
                    </Match>
                  </Switch>
                </div>

                <Show when={task().lastOutput?.trim()}>
                  {(output) => (
                    <div class="scheduled-section">
                      <span class="scheduled-section-label">{language.t("scheduled.detail.output")}</span>
                      <pre class="scheduled-output">{output()}</pre>
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
