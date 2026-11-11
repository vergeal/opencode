import { ClientError, type ScheduleInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { getFilename } from "@opencode/util/path"
import { Option, Schema } from "effect"
import { createEffect, createMemo, createSignal, on } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { SCHEDULED_FILTERS, useLayout, type ScheduledFilter } from "@/shell/state/layout"
import { parseSchedule, schedulePrompt } from "./cron"
import { taskName } from "./describe"

import { tasksOf, transition, type TaskEvent, type TaskState } from "./machine"
import { NewScheduledTaskDialog, type NewTaskInput } from "./new-dialog"
import { mergeRecurrence, recurrenceOfCron, whenOf } from "./recurrence"

export { SCHEDULED_FILTERS }
export type Filter = ScheduledFilter

export const FILTER_LABELS: Record<Filter, string> = {
  all: "scheduled.filter.all",
  active: "scheduled.filter.active",
  paused: "scheduled.filter.paused",
  failed: "scheduled.filter.failed",
}

type RunLog = { id: string; at: number; text: string }

type Logs = { status: "idle" } | { status: "loading" } | { status: "ready"; entries: RunLog[] } | { status: "failed" }

/** The API answers 403 when experimental.schedules is off where the Session lives. */
function isDisabled(error: ClientError) {
  if (error.reason !== "UnexpectedStatus") return false

  const status = Schema.decodeUnknownOption(Schema.Struct({ status: Schema.Number }))(error.cause)

  return Option.match(status, { onNone: () => false, onSome: (cause) => cause.status === 403 })
}

/** A failed outcome is the one filter that reads the result rather than the lifecycle status. */
export function matches(task: ScheduleInfo, filter: Filter) {
  if (filter === "all") return true

  if (filter === "failed") return task.lastOutcome === "failed"

  return task.status === filter
}

export function promptOf(task: ScheduleInfo) {
  return task.action.type === "prompt" ? task.action.prompt : ""
}

/** A failed last run outranks the lifecycle status, so a task that just broke never reads as healthy. */
export function toneOf(task: ScheduleInfo): "success" | "danger" | "neutral" {
  if (task.lastOutcome === "failed") return "danger"

  return task.status === "active" ? "success" : "neutral"
}

/** The first line of the last output, so a run row stays one line. */
export function outputPreview(task: ScheduleInfo) {
  return task.lastOutput
    ?.split("\n")
    .find((line) => line.trim())
    ?.trim()
}

/**
 * The scheduled-task model: the task list, the open task and its execution log. The navigation column and the
 * detail surface share one instance so pausing or deleting a task reads the same everywhere.
 */
export function createScheduled() {
  const language = useLanguage()
  const servers = useServers()
  const global = useGlobal()
  const dialog = useDialog()
  const layout = useLayout()

  const connection = () => servers.list[0]

  const context = () => {
    const conn = connection()

    return conn ? global.serverCtx(ServerConnection.key(conn)) : undefined
  }

  const api = () => context()?.sdk.api

  const [state, setState] = createSignal<TaskState>({ status: "loading" })
  const dispatch = (event: TaskEvent) => setState((current) => transition(current, event))

  const [query, setQuery] = createSignal("")
  const [busy, setBusy] = createSignal<string>()

  const filter = () => layout.destination.scheduled.filter()
  const setFilter = (next: Filter) => layout.destination.scheduled.setFilter(next)
  const selected = () => layout.destination.scheduled.selected()
  const setSelected = (id: string | undefined) => layout.destination.scheduled.setSelected(id)

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
    Object.fromEntries(SCHEDULED_FILTERS.map((key) => [key, tasks().filter((task) => matches(task, key)).length])),
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
      // Reading the prompt belongs to saving: the dialog only collected the cadence and the details the user
      // cares about, and everything else about the time comes from the prompt here. Hourly and custom already
      // describe their own time, so they do not need a model call.
      const timed = input.recurrence.kind !== "hourly" && input.recurrence.kind !== "cron"
      const inferred = timed ? await infer(input.prompt) : undefined
      const recurrence = mergeRecurrence(input.recurrence, inferred ? recurrenceOfCron(inferred.cron) : undefined)
      const tz = readTimeZone(inferred?.timezone) ?? input.tz

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
          when: whenOf(recurrence, tz),
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
      <NewScheduledTaskDialog projects={projectOptions()} directory={directory} onCreate={create} />
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

  return {
    state,
    tasks,
    visible,
    counts,
    current,
    logs,
    logEntries,
    busy,
    error,
    query,
    setQuery,
    filter,
    setFilter,
    selected,
    setSelected,
    load,
    loadLogs,
    projectOf,
    setStatus,
    remove,
    openNew,
    confirmRemove,
  }
}

export type Scheduled = ReturnType<typeof createScheduled>

/** The model replies with an IANA zone; anything else falls back to the zone the dialog already showed. */
function readTimeZone(value: string | undefined) {
  if (!value) return undefined

  try {
    new Intl.DateTimeFormat("en", { timeZone: value })

    return value
  } catch {
    return undefined
  }
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
