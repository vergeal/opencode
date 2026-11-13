import type { FormAnswer, FormInfo, KnowledgeInfo, PermissionRequest, PluginInboxRecord, ScheduleInfo } from "@opencode/client/promise"
import { useQueries, useQueryClient } from "@tanstack/solid-query"
import { Schema } from "effect"
import { createMemo } from "solid-js"
import { produce } from "solid-js/store"
import { canUseServer } from "@/runtime/server/health-machine"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { createSessionInbox } from "@/shell/titlebar/inbox-model"

export type InboxKind = "question" | "approval" | "failure" | "output" | "result"

export type InboxStatus = "pending" | "done" | "failed"

export type InboxAction =
  | { type: "permission"; sessionID: string; requestID: string }
  | { type: "form"; sessionID: string; formID: string }
  | { type: "open-session"; sessionID: string }
  | { type: "open-schedule"; scheduleID: string }
  | { type: "open-knowledge"; libraryID: string }
  | { type: "plugin"; server: string; pluginID: string; inboxID: string }

/**
 * How a person closed an item. History keeps the decision itself, so a Done row says what was decided instead of
 * only that something was handled.
 */
export type InboxResolution = {
  decision: "once" | "always" | "reject" | "answered" | "dismissed"
  at: number
  /** The labels and values a person submitted. Only an answered question carries entries. */
  answers?: Array<{ label: string; value: string }>
}

export type InboxItem = {
  /** Stable across polls: server, kind and the request or record it came from. */
  key: string
  kind: InboxKind
  status: InboxStatus
  title: string
  summary: string
  source: { type: "session" | "schedule" | "knowledge" | "plugin"; id: string; name?: string }
  projectID?: string
  createdAt: number
  expiresAt?: number
  action: InboxAction
  resolution?: InboxResolution
}

/** The text a source needs while it maps a record; the caller passes the app's translator. */
export type InboxText = (
  key:
    | "inbox.item.untitled"
    | "inbox.item.approval.title"
    | "inbox.item.question.title"
    | "inbox.item.failure.title"
    | "inbox.item.session.failure.summary"
    | "inbox.item.schedule.failed.summary"
    | "inbox.item.schedule.expired.summary"
    | "inbox.item.output.title"
    | "inbox.item.knowledge.title"
    | "inbox.item.knowledge.failure.title"
    | "inbox.item.knowledge.summary"
    | "inbox.item.knowledge.failure.summary",
  params?: Record<string, string | number | boolean>,
) => string

/** How much of a schedule's output the list and the detail summary carry. */
const OUTPUT_PREVIEW = 280

/**
 * Maps one waiting permission request. The session name identifies where the request came from, and the action
 * names what the agent wants to do, so the approval can be read without opening the session.
 */
export function permissionItem(input: {
  server: string
  session: { id: string; title?: string; projectID?: string }
  request: PermissionRequest
  createdAt: number
  text: InboxText
}): InboxItem {
  const name = input.session.title || input.text("inbox.item.untitled")

  return {
    key: `${input.server}\0approval\0${input.request.id}`,
    kind: "approval",
    status: "pending",
    title: input.text("inbox.item.approval.title", { action: input.request.action }),
    summary: name,
    source: { type: "session", id: input.session.id, name },
    projectID: input.session.projectID,
    createdAt: input.createdAt,
    action: { type: "permission", sessionID: input.session.id, requestID: input.request.id },
  }
}

/** Maps one unanswered session form. The form's own title says what it asks for. */
export function questionItem(input: {
  server: string
  session: { id: string; title?: string; projectID?: string }
  form: FormInfo
  createdAt: number
  text: InboxText
}): InboxItem {
  const name = input.session.title || input.text("inbox.item.untitled")

  return {
    key: `${input.server}\0question\0${input.form.id}`,
    kind: "question",
    status: "pending",
    title: input.text("inbox.item.question.title", { name }),
    summary: input.form.title,
    source: { type: "session", id: input.session.id, name },
    projectID: input.session.projectID,
    createdAt: input.createdAt,
    action: { type: "form", sessionID: input.session.id, formID: input.form.id },
  }
}

/** Maps a session whose last run failed. Another outcome, or a session still working, is not an inbox item. */
export function sessionFailureItem(input: {
  server: string
  session: { id: string; title?: string; projectID?: string }
  createdAt: number
  text: InboxText
}): InboxItem {
  const name = input.session.title || input.text("inbox.item.untitled")

  return {
    key: `${input.server}\0failure\0session\0${input.session.id}`,
    kind: "failure",
    status: "failed",
    title: input.text("inbox.item.failure.title", { name }),
    summary: input.text("inbox.item.session.failure.summary"),
    source: { type: "session", id: input.session.id, name },
    projectID: input.session.projectID,
    createdAt: input.createdAt,
    action: { type: "open-session", sessionID: input.session.id },
  }
}

/**
 * Maps a scheduled task. A failed or expired run is a failure; a fired run with output is something to accept;
 * a run that produced nothing, was skipped, or never fired is not an inbox item.
 */
export function scheduleItem(input: {
  server: string
  schedule: ScheduleInfo
  createdAt: number
  text: InboxText
}): InboxItem | undefined {
  const schedule = input.schedule
  const name = schedule.name || input.text("inbox.item.untitled")

  if (schedule.lastOutcome === "failed" || schedule.lastOutcome === "expired") {
    return {
      key: `${input.server}\0failure\0schedule\0${schedule.id}`,
      kind: "failure",
      status: "failed",
      title: input.text("inbox.item.failure.title", { name }),
      summary: input.text(
        schedule.lastOutcome === "failed" ? "inbox.item.schedule.failed.summary" : "inbox.item.schedule.expired.summary",
      ),
      source: { type: "schedule", id: schedule.id, name },
      createdAt: input.createdAt,
      action: { type: "open-schedule", scheduleID: schedule.id },
    }
  }

  if (schedule.lastOutcome !== "fired" || !schedule.lastOutput?.trim()) return

  return {
    key: `${input.server}\0output\0${schedule.id}`,
    kind: "output",
    status: "pending",
    title: input.text("inbox.item.output.title", { name }),
    summary: preview(schedule.lastOutput),
    source: { type: "schedule", id: schedule.id, name },
    createdAt: input.createdAt,
    action: { type: "open-schedule", scheduleID: schedule.id },
  }
}

/** Maps a knowledge library that finished indexing or failed. Empty, indexing and stale libraries stay out. */
export function knowledgeItem(input: {
  server: string
  library: KnowledgeInfo
  createdAt: number
  text: InboxText
}): InboxItem | undefined {
  const library = input.library

  if (library.status === "failed") {
    return {
      key: `${input.server}\0failure\0knowledge\0${library.id}`,
      kind: "failure",
      status: "failed",
      title: input.text("inbox.item.knowledge.failure.title", { name: library.name }),
      summary: input.text("inbox.item.knowledge.failure.summary"),
      source: { type: "knowledge", id: library.id, name: library.name },
      createdAt: input.createdAt,
      action: { type: "open-knowledge", libraryID: library.id },
    }
  }

  if (library.status !== "ready") return

  return {
    key: `${input.server}\0result\0${library.id}`,
    kind: "result",
    status: "done",
    title: input.text("inbox.item.knowledge.title"),
    summary: input.text("inbox.item.knowledge.summary", { count: library.documentCount }),
    source: { type: "knowledge", id: library.id, name: library.name },
    createdAt: input.createdAt,
    action: { type: "open-knowledge", libraryID: library.id },
  }
}

function preview(output: string) {
  const text = output.trim()

  return text.length > OUTPUT_PREVIEW ? `${text.slice(0, OUTPUT_PREVIEW - 1)}…` : text
}

/**
 * Maps one message a plugin published. The host owns the row, so `kind` only picks its icon; the plugin owns the
 * content page. `source.id` is the publishing plugin, which is what routes the message to that plugin's renderer.
 */
export function pluginItem(input: { server: string; record: PluginInboxRecord }): InboxItem {
  const record = input.record

  return {
    key: pluginItemKey(input.server, record.plugin, record.id),
    kind: record.status === "failed" ? "failure" : record.status === "done" ? "result" : "output",
    status: record.status,
    title: record.title,
    summary: record.summary,
    source: { type: "plugin", id: record.plugin, name: record.plugin },
    createdAt: record.createdAt,
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    action: { type: "plugin", server: input.server, pluginID: record.plugin, inboxID: record.id },
  }
}

/** Stable across polls, so an updated message keeps the row's selection and read state. */
export function pluginItemKey(server: string, plugin: string, id: string) {
  return `${server}\0plugin\0${plugin}\0${id}`
}

const Seen = Persistence.struct({ seen: Persistence.record(Schema.Finite) })

const StoredAnswer = Persistence.struct({ label: Schema.String, value: Schema.String })

const StoredResolution = Persistence.struct({
  decision: Schema.Literals(["once", "always", "reject", "answered", "dismissed"]),
  at: Schema.Finite,
  answers: Persistence.optional(Persistence.array(StoredAnswer)),
})

const StoredAction = Schema.Union([
  Persistence.struct({ type: Schema.Literal("permission"), sessionID: Schema.String, requestID: Schema.String }),
  Persistence.struct({ type: Schema.Literal("form"), sessionID: Schema.String, formID: Schema.String }),
  Persistence.struct({ type: Schema.Literal("open-session"), sessionID: Schema.String }),
  Persistence.struct({ type: Schema.Literal("open-schedule"), scheduleID: Schema.String }),
  Persistence.struct({ type: Schema.Literal("open-knowledge"), libraryID: Schema.String }),
  Persistence.struct({
    type: Schema.Literal("plugin"),
    server: Schema.String,
    pluginID: Schema.String,
    inboxID: Schema.String,
  }),
])

const StoredItem = Persistence.struct({
  key: Schema.String,
  kind: Schema.Literals(["question", "approval", "failure", "output", "result"]),
  status: Schema.Literals(["pending", "done", "failed"]),
  title: Schema.String,
  summary: Schema.String,
  source: Persistence.struct({
    type: Schema.Literals(["session", "schedule", "knowledge", "plugin"]),
    id: Schema.String,
    name: Persistence.optional(Schema.String),
  }),
  projectID: Persistence.optional(Schema.String),
  createdAt: Schema.Finite,
  expiresAt: Persistence.optional(Schema.Finite),
  action: StoredAction,
  resolution: Persistence.optional(StoredResolution),
})

const Resolved = Persistence.record(StoredItem)

/**
 * Aggregates the five kinds of inbox items across every visible server. Sessions come from `createSessionInbox`,
 * whose approval / input / failure states stay the single source of that judgement; schedules and knowledge
 * libraries are polled until P1 adds their events.
 */
export function createInbox() {
  const servers = useServers()
  const global = useGlobal()
  const language = useLanguage()
  const sessionInbox = createSessionInbox()
  const queryClient = useQueryClient()

  const connections = createMemo(() =>
    servers.visible.flatMap((conn) => {
      const ctx = global.serverCtx(ServerConnection.key(conn))

      return ctx && canUseServer(global.servers.health[ServerConnection.key(conn)]) ? [{ conn, ctx }] : []
    }),
  )

  const schedules = useQueries(() => ({
    queries: connections().map((item) => ({
      queryKey: ["inbox-schedules", item.conn],
      enabled: item.ctx.sdk.connection.status() === "connected",
      // An experimental switch that is off answers 403; that source is simply empty.
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return (await item.ctx.sdk.api.experimental.schedule.list({}, { signal })) ?? []
        } catch {
          return []
        }
      },
      retry: false,
      staleTime: 30_000,
      refetchInterval: 30_000,
      refetchOnMount: true,
    })),
  }))

  const knowledge = useQueries(() => ({
    queries: connections().map((item) => ({
      queryKey: ["inbox-knowledge", item.conn],
      enabled: item.ctx.sdk.connection.status() === "connected",
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return (await item.ctx.sdk.api.experimental["server.knowledge"].list({ signal })) ?? []
        } catch {
          return []
        }
      },
      retry: false,
      staleTime: 30_000,
      refetchInterval: (query: { state: { data?: KnowledgeInfo[] } }) =>
        query.state.data?.some((library) => library.status === "indexing") ? 3_000 : 30_000,
      refetchOnMount: true,
    })),
  }))

  // Plugin-published messages. The server owns the records, so every window and client reads the same list; a plugin
  // only sees its own through `ctx.inbox`. Read state is the record's `seen`, not this client's local store.
  const plugins = useQueries(() => ({
    queries: connections().map((item) => ({
      queryKey: ["inbox-plugins", item.conn],
      enabled: item.ctx.sdk.connection.status() === "connected",
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        try {
          return (await item.ctx.sdk.api.experimental.plugin.inbox.list({}, { signal })) ?? undefined
        } catch {
          return undefined
        }
      },
      retry: false,
      staleTime: 15_000,
      refetchInterval: 15_000,
      refetchOnMount: true,
    })),
  }))

  // Items this client finished. The source drops a request once it is answered, so the row would otherwise vanish
  // instead of moving to Done. The record keeps the decision and survives restarts; nothing but a person removes it.
  const [resolved, setResolved] = persisted(Persist.global("inbox.resolved"), Resolved, {})
  const [state, setState] = persisted(Persist.global("inbox.seen"), Seen, { seen: {} })

  const sessionItems = createMemo(() =>
    sessionInbox.entries().flatMap((entry): InboxItem[] => {
      const source = { id: entry.session.id, title: entry.session.title, projectID: entry.session.projectID }
      const createdAt = entry.since ?? entry.session.time.updated

      if (entry.status === "approval") {
        const request = sessionInbox.permission(entry)

        return request
          ? [
              permissionItem({
                server: entry.server,
                session: source,
                request,
                createdAt,
                text: language.t,
              }),
            ]
          : []
      }

      if (entry.status === "input") {
        const form = sessionInbox.form(entry)

        return form ? [questionItem({ server: entry.server, session: source, form, createdAt, text: language.t })] : []
      }

      if (entry.status === "failed")
        return [sessionFailureItem({ server: entry.server, session: source, createdAt, text: language.t })]

      return []
    }),
  )

  const scheduleItems = createMemo(() =>
    connections().flatMap((item, index) =>
      (schedules[index]?.data ?? []).flatMap((schedule: ScheduleInfo) => {
        const mapped = scheduleItem({
          server: ServerConnection.key(item.conn),
          schedule,
          createdAt: schedule.lastFiredAt ?? schedule.time.updated,
          text: language.t,
        })

        return mapped ? [mapped] : []
      }),
    ),
  )

  const knowledgeItems = createMemo(() =>
    connections().flatMap((item, index) =>
      (knowledge[index]?.data ?? []).flatMap((library: KnowledgeInfo) => {
        const mapped = knowledgeItem({
          server: ServerConnection.key(item.conn),
          library,
          createdAt: library.indexedAt ?? library.time.updated,
          text: language.t,
        })

        return mapped ? [mapped] : []
      }),
    ),
  )

  const pluginItems = createMemo(() =>
    connections().flatMap((item, index) =>
      (plugins[index]?.data?.data ?? []).map((record: PluginInboxRecord) =>
        pluginItem({ server: ServerConnection.key(item.conn), record }),
      ),
    ),
  )

  /** The server's read state for each plugin message, keyed like the row so `unread` reads the same record. */
  const pluginRecords = createMemo(() => {
    const records = new Map<string, PluginInboxRecord>()

    connections().forEach((item, index) => {
      for (const record of plugins[index]?.data?.data ?? []) {
        records.set(pluginItemKey(ServerConnection.key(item.conn), record.plugin, record.id), record)
      }
    })

    return records
  })

  const items = createMemo<InboxItem[]>(() => {
    const live = [...sessionItems(), ...scheduleItems(), ...knowledgeItems(), ...pluginItems()]
    const liveKeys = new Set(live.map((item) => item.key))
    const answered = Object.values(resolved).filter((item) => !liveKeys.has(item.key))

    return [...live, ...answered]
      .map((item) => {
        const record = resolved[item.key]

        return record ? { ...item, status: "done" as const, resolution: record.resolution } : item
      })
      .toSorted((a, b) => b.createdAt - a.createdAt)
  })

  /** Records the decision with the item, so Done history survives restarts and reads as what was decided. */
  const resolve = (item: InboxItem, decision: InboxResolution["decision"], answers?: InboxResolution["answers"]) =>
    setResolved(item.key, {
      ...item,
      status: "done",
      resolution: { decision, at: Date.now(), answers },
    })

  /**
   * Drops one row. Nothing prunes Done on its own; only a person removes a record. A plugin message lives on the
   * server, so removing it asks the host to delete the record for every window.
   */
  const remove = (item: InboxItem) => {
    const action = item.action
    if (action.type === "plugin") {
      const target = connections().find((candidate) => ServerConnection.key(candidate.conn) === action.server)
      if (!target) return
      void target.ctx.sdk.api.experimental.plugin.inbox
        .delete({ id: action.inboxID })
        .catch(() => undefined)
        .finally(() => void queryClient.invalidateQueries({ queryKey: ["inbox-plugins"] }))
      return
    }
    setResolved(
      produce((records) => {
        delete records[item.key]
      }),
    )
    setState(
      "seen",
      produce((seen) => {
        delete seen[item.key]
      }),
    )
  }

  /** Whether this item is a retained record, so only history can offer to forget it. */
  const history = (item: InboxItem) => item.source.type !== "plugin" && !!resolved[item.key]

  const unread = (item: InboxItem) =>
    item.source.type === "plugin" ? !pluginRecords().get(item.key)?.seen : !state.seen[item.key]

  const markSeen = (item: InboxItem) => {
    const action = item.action
    if (action.type === "plugin") {
      if (!unread(item)) return
      const target = connections().find((candidate) => ServerConnection.key(candidate.conn) === action.server)
      if (!target) return
      // The record lives on the server, so the next list read reflects it for every window.
      void target.ctx.sdk.api.experimental.plugin.inbox
        .mark({ id: action.inboxID })
        .catch(() => undefined)
        .finally(() => void queryClient.invalidateQueries({ queryKey: ["inbox-plugins"] }))
      return
    }
    if (state.seen[item.key]) return
    setState("seen", item.key, Date.now())
  }

  /** Marks a whole filtered list read at once; the sidebar's "mark all read" action uses it. */
  const markAllSeen = (target: InboxItem[]) => {
    target.filter((item) => item.source.type === "plugin").forEach((item) => markSeen(item))
    const unreadItems = target.filter((item) => item.source.type !== "plugin" && !state.seen[item.key])

    if (unreadItems.length === 0) return
    setState("seen", (seen) => {
      const next = { ...seen }

      for (const item of unreadItems) next[item.key] = Date.now()

      return next
    })
  }

  // A request can belong to a child session, so match the root the item was mapped from.
  const entry = (item: InboxItem) => {
    if (item.source.type !== "session") return

    return sessionInbox.entries().find((candidate) => candidate.session.id === item.source.id)
  }

  const permission = (item: InboxItem) => {
    const target = entry(item)

    return target ? sessionInbox.permission(target) : undefined
  }

  const form = (item: InboxItem) => {
    const target = entry(item)

    return target ? sessionInbox.form(target) : undefined
  }

  const decide = async (item: InboxItem, decision: "once" | "always" | "reject") => {
    const target = entry(item)

    if (!target) return false
    const request = sessionInbox.permission(target)

    if (!request) return false

    const accepted = await target.ctx.data.session.permission
      .reply({ sessionID: request.sessionID, requestID: request.id, decision })
      .then(() => true, () => false)

    if (accepted) resolve(item, decision)

    return accepted
  }

  const answerForm = async (item: InboxItem, answer: FormAnswer, answers?: InboxResolution["answers"]) => {
    const target = entry(item)

    if (!target) return false
    const request = sessionInbox.form(target)

    if (!request) return false

    const accepted = await target.ctx.data.session.form
      .reply({ sessionID: request.sessionID, formID: request.id, answer }, target.session.location)
      .then(() => true, () => false)

    if (accepted) resolve(item, "answered", answers)

    return accepted
  }

  /** A plugin message's full record, once the server list has loaded it. */
  const pluginRecord = (item: InboxItem) =>
    item.action.type === "plugin" ? pluginRecords().get(item.key) : undefined

  /** Opens the record behind an item: its session, or the page that owns a schedule or library. */
  const openSession = (item: InboxItem) => {
    if (item.source.type !== "session") return
    const target = entry(item)

    if (target) sessionInbox.open(target)
  }

  const loading = () =>
    sessionInbox.loading() ||
    schedules.some((query) => query?.isLoading === true) ||
    knowledge.some((query) => query?.isLoading === true) ||
    plugins.some((query) => query?.isLoading === true)

  return {
    items,
    loading,
    count: (status: InboxStatus) => items().filter((item) => item.status === status).length,
    unread,
    markSeen,
    markAllSeen,
    resolve,
    remove,
    history,
    entry,
    pluginRecord,
    openSession,
    permission,
    form,
    decide,
    answerForm,
  }
}

export type Inbox = ReturnType<typeof createInbox>
