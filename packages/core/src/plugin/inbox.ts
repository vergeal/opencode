export * as PluginInbox from "./inbox.js"

import { randomUUID } from "node:crypto"
import type { InboxDomain, InboxMessage, InboxPatch } from "@opencode/plugin/effect/inbox"
import { Plugin } from "@opencode/schema/plugin"
import { Effect, Scope } from "effect"
import { KV } from "../kv.js"

/**
 * A plugin's inbox is plain KV state in the location's database, so every window and client reads the same records.
 * Keys carry the publisher, which is what keeps one plugin's `list`, `update`, `remove` and `markSeen` inside its own
 * messages: an id another plugin published is simply not there.
 *
 * Three keys per message: the record, an `externalID` index that makes a re-publish an update, and an owner index that
 * lets the app mark a message read without knowing which plugin published it. Writes are not transactional, so a crash
 * between them can leave an index without a record; reads treat a missing record as absent.
 */
const NAMESPACE = "plugin-inbox:"
const MESSAGES = `${NAMESPACE}msg:`

/** UTF-16 code units in fixed-width hex, so a key always has an unambiguous prefix and separator. */
const escape = (value: string) =>
  value
    .split("")
    .map((char) => char.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("")

const messageKey = (plugin: string, id: string) => `${MESSAGES}${escape(plugin)}:${id}`
const externalKey = (plugin: string, externalID: string) => `${NAMESPACE}ext:${escape(plugin)}:${escape(externalID)}`
const ownerKey = (id: string) => `${NAMESPACE}own:${id}`

interface Stored {
  readonly id: string
  readonly plugin: string
  readonly externalID: string
  readonly title: string
  readonly summary: string
  readonly status: Plugin.InboxStatus
  readonly createdAt: number
  readonly expiresAt?: number
  readonly payload?: unknown
  readonly seen: boolean
  readonly updatedAt: number
}

/** `payload` is opaque to the platform but must survive a JSON round trip, since KV stores JSON. */
const json = (value: unknown): KV.Value => JSON.parse(JSON.stringify(value ?? null)) as KV.Value

const read = (kv: KV.Interface, key: string) =>
  kv.get(key).pipe(Effect.map((value) => (value === undefined ? undefined : (value as unknown as Stored))))

const write = (kv: KV.Interface, key: string, record: Stored) => kv.set(key, record as unknown as KV.Value)

function scan(kv: KV.Interface, prefix: string) {
  return Effect.gen(function* () {
    const records: Stored[] = []
    let after: string | undefined

    for (;;) {
      const page = yield* kv.scan({ prefix, after, limit: 500 })
      records.push(...page.entries.map((entry) => entry.value as unknown as Stored))
      if (page.next === undefined) return records
      after = page.next
    }
  })
}

const toRecord = (stored: Stored) => ({
  id: stored.id,
  externalID: stored.externalID,
  title: stored.title,
  summary: stored.summary,
  status: stored.status,
  createdAt: stored.createdAt,
  ...(stored.expiresAt === undefined ? {} : { expiresAt: stored.expiresAt }),
  ...(stored.payload === undefined ? {} : { payload: stored.payload }),
  seen: stored.seen,
  updatedAt: stored.updatedAt,
})

/**
 * Every message every plugin published in this location, for the app's inbox. Newest first: the KV key order is by
 * plugin and id, which has nothing to do with when a message was published.
 */
export function list(kv: KV.Interface) {
  return scan(kv, MESSAGES).pipe(
    Effect.map((records) =>
      records
        .filter((record) => record !== undefined && record !== null && typeof record.id === "string")
        .map(
          (record): Plugin.InboxRecord => ({
            ...toRecord(record),
            plugin: Plugin.ID.make(record.plugin),
            status: record.status,
          }),
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    ),
  )
}

/**
 * Deletes one message on the user's behalf, whoever published it: the owner index names the publisher, so the host
 * does not need to know which plugin a row came from. An id no message owns is a no-op.
 *
 * This is the user's cleanup path, not a plugin API: `ctx.inbox.remove` stays bounded to the caller's own messages.
 */
export function remove(kv: KV.Interface, id: string) {
  return Effect.gen(function* () {
    const plugin = yield* kv.get(ownerKey(id))
    if (typeof plugin !== "string") return
    yield* removeMessage(kv, plugin, id)
  })
}

/** Removes the record and both indexes together; a record without its indexes would leak and revive on re-publish. */
const removeMessage = (kv: KV.Interface, plugin: string, id: string) =>
  Effect.gen(function* () {
    const previous = yield* read(kv, messageKey(plugin, id))
    if (!previous || previous.plugin !== plugin) return
    yield* kv.remove(messageKey(plugin, id))
    yield* kv.remove(externalKey(plugin, previous.externalID))
    yield* kv.remove(ownerKey(id))
  })

/**
 * Marks one message read on the user's behalf, whoever published it, and tells that publisher. An id that no message
 * owns is a no-op, so a stale row in another window changes nothing.
 */
export function mark(kv: KV.Interface, id: string) {
  return Effect.gen(function* () {
    const plugin = yield* kv.get(ownerKey(id))
    if (typeof plugin !== "string") return
    const previous = yield* read(kv, messageKey(plugin, id))
    if (!previous || previous.plugin !== plugin || previous.seen) return
    yield* write(kv, messageKey(plugin, id), { ...previous, seen: true, updatedAt: Date.now() })
    notify(kv, plugin, [id])
  })
}

const listeners = new WeakMap<KV.Interface, Map<string, Set<(ids: string[]) => void>>>()

function subscribe(kv: KV.Interface, plugin: string, callback: (ids: string[]) => void) {
  const plugins = listeners.get(kv) ?? new Map<string, Set<(ids: string[]) => void>>()
  listeners.set(kv, plugins)
  const callbacks = plugins.get(plugin) ?? new Set<(ids: string[]) => void>()
  plugins.set(plugin, callbacks)
  callbacks.add(callback)

  return () => {
    callbacks.delete(callback)
    if (callbacks.size === 0) plugins.delete(plugin)
  }
}

function notify(kv: KV.Interface, plugin: string, ids: string[]) {
  for (const callback of listeners.get(kv)?.get(plugin) ?? []) {
    // A plugin's listener is its own code: one that throws must not break the app request that marked the message.
    try {
      callback(ids)
    } catch (cause) {
      console.error(`[plugin] ${plugin} inbox.onSeen failed`, cause)
    }
  }
}

/** The `ctx.inbox` one plugin sees. Every method is bounded to messages this plugin published. */
export function make(
  kv: KV.Interface,
  plugin: string,
  options?: { readonly scope?: Scope.Scope },
): InboxDomain {
  const publish = (message: InboxMessage) =>
    Effect.gen(function* () {
      const now = Date.now()
      const known = yield* kv.get(externalKey(plugin, message.externalID))
      const id = typeof known === "string" ? known : randomUUID()
      const previous = typeof known === "string" ? yield* read(kv, messageKey(plugin, id)) : undefined
      const existing = previous?.plugin === plugin ? previous : undefined
      const record: Stored = {
        id,
        plugin,
        externalID: message.externalID,
        title: message.title,
        summary: message.summary,
        // The plugin owns `status` and the user owns `seen`: a re-publish never resets either.
        status: existing?.status ?? message.status ?? "pending",
        createdAt: existing?.createdAt ?? message.createdAt ?? now,
        seen: existing?.seen ?? false,
        updatedAt: now,
        ...(message.expiresAt === undefined
          ? existing?.expiresAt === undefined
            ? {}
            : { expiresAt: existing.expiresAt }
          : { expiresAt: message.expiresAt }),
        ...(message.payload === undefined
          ? existing?.payload === undefined
            ? {}
            : { payload: existing.payload }
          : { payload: json(message.payload) }),
      }

      yield* write(kv, messageKey(plugin, id), record)
      if (!existing) {
        yield* kv.set(externalKey(plugin, message.externalID), id)
        yield* kv.set(ownerKey(id), plugin)
      }

      return id
    })

  return {
    publish,
    publishMany: (messages) => Effect.forEach(messages, publish),
    list: () =>
      scan(kv, `${MESSAGES}${escape(plugin)}:`).pipe(
        Effect.map((records) => records.filter((record) => record.plugin === plugin).map(toRecord)),
      ),
    update: (id, patch: InboxPatch) =>
      Effect.gen(function* () {
        const previous = yield* read(kv, messageKey(plugin, id))
        if (!previous || previous.plugin !== plugin) return
        const expiresAt = patch.expiresAt === null ? undefined : (patch.expiresAt ?? previous.expiresAt)
        const payload = patch.payload === undefined ? previous.payload : json(patch.payload)
        yield* write(kv, messageKey(plugin, id), {
          id: previous.id,
          plugin: previous.plugin,
          externalID: previous.externalID,
          title: patch.title ?? previous.title,
          summary: patch.summary ?? previous.summary,
          status: patch.status ?? previous.status,
          createdAt: previous.createdAt,
          seen: previous.seen,
          updatedAt: Date.now(),
          ...(expiresAt === undefined ? {} : { expiresAt }),
          ...(payload === undefined ? {} : { payload }),
        })
      }),
    remove: (id) => removeMessage(kv, plugin, id),
    markSeen: (id) =>
      Effect.gen(function* () {
        const previous = yield* read(kv, messageKey(plugin, id))
        if (!previous || previous.plugin !== plugin || previous.seen) return
        // A plugin marking its own message read is not the user's action, so it does not notify the plugin back.
        yield* write(kv, messageKey(plugin, id), { ...previous, seen: true, updatedAt: Date.now() })
      }),
    onSeen: (callback) => {
      const unsubscribe = subscribe(kv, plugin, callback)
      // A listener lives with the plugin instance that registered it, like `ctx.config.onChange`.
      if (options?.scope) Effect.runSync(Scope.addFinalizer(options.scope, Effect.sync(unsubscribe)))
    },
  }
}
