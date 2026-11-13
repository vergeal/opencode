import { expect } from "bun:test"
import { KV } from "@opencode/core/kv"
import { PluginInbox } from "@opencode/core/plugin/inbox"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("keeps one plugin's messages out of another plugin's view", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const a = PluginInbox.make(kv, "test.inbox.a")
    const b = PluginInbox.make(kv, "test.inbox.b")
    const id = yield* a.publish({ externalID: "shared", title: "A", summary: "A" })

    expect(yield* b.list()).toEqual([])

    // Every write from the other plugin is a silent no-op, not an error and not a leak.
    yield* b.update(id, { title: "hijacked" })
    yield* b.markSeen(id)
    yield* b.remove(id)

    const [record] = yield* a.list()
    expect(record.title).toBe("A")
    expect(record.seen).toBe(false)
  }),
)

it.effect("updates one record per externalID and leaves status and seen alone", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const inbox = PluginInbox.make(kv, "test.inbox.a")
    const first = yield* inbox.publish({ externalID: "thread", title: "one", summary: "s", status: "done" })
    yield* inbox.markSeen(first)

    const second = yield* inbox.publish({ externalID: "thread", title: "two", summary: "s2", status: "failed" })

    expect(second).toBe(first)
    const records = yield* inbox.list()
    expect(records).toHaveLength(1)
    expect(records[0].title).toBe("two")
    expect(records[0].summary).toBe("s2")
    expect(records[0].status).toBe("done")
    expect(records[0].seen).toBe(true)
  }),
)

it.effect("applies a patch and clears a deadline only when asked", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const inbox = PluginInbox.make(kv, "test.inbox.a")
    const id = yield* inbox.publish({ externalID: "m", title: "one", summary: "s", expiresAt: 1_000 })

    yield* inbox.update(id, { summary: "changed" })

    const [patched] = yield* inbox.list()
    expect(patched.title).toBe("one")
    expect(patched.summary).toBe("changed")
    expect(patched.expiresAt).toBe(1_000)

    yield* inbox.update(id, { expiresAt: null })

    expect((yield* inbox.list())[0].expiresAt).toBeUndefined()
  }),
)

it.effect("deletes a removed message instead of hiding it", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const inbox = PluginInbox.make(kv, "test.inbox.a")
    const id = yield* inbox.publish({ externalID: "m", title: "one", summary: "s" })

    expect(yield* PluginInbox.list(kv)).toHaveLength(1)

    yield* inbox.remove(id)

    expect(yield* inbox.list()).toEqual([])
    expect(yield* PluginInbox.list(kv)).toEqual([])
    // The externalID index went with it, so publishing the same id again makes a new message, not a revival.
    expect(yield* inbox.publish({ externalID: "m", title: "again", summary: "s" })).not.toBe(id)
  }),
)

it.effect("lets the user delete any plugin's message, record and indexes together", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const a = PluginInbox.make(kv, "test.inbox.a")
    const b = PluginInbox.make(kv, "test.inbox.b")
    const id = yield* a.publish({ externalID: "m", title: "one", summary: "s" })
    yield* b.publish({ externalID: "other", title: "two", summary: "s" })

    // The host deletes by message id alone: it need not know which plugin published it.
    yield* PluginInbox.remove(kv, id)

    expect((yield* a.list()).map((record) => record.id)).toEqual([])
    expect(yield* PluginInbox.list(kv)).toHaveLength(1)
    // Record, externalID index and owner index all go: only the other plugin's three keys remain.
    const remaining = yield* kv.scan({ prefix: "plugin-inbox:", limit: 100 })
    expect(remaining.entries).toHaveLength(3)

    // The externalID index went with it, so publishing the same id again makes a new message.
    expect(yield* a.publish({ externalID: "m", title: "again", summary: "s" })).not.toBe(id)
    // Deleting an id no message owns is a no-op, not an error.
    yield* PluginInbox.remove(kv, id)
  }),
)

it.effect("returns the app's list newest first regardless of key order", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const inbox = PluginInbox.make(kv, "test.inbox.a")
    yield* inbox.publish({ externalID: "a", title: "a", summary: "s", createdAt: 200 })
    yield* inbox.publish({ externalID: "b", title: "b", summary: "s", createdAt: 300 })
    yield* inbox.publish({ externalID: "c", title: "c", summary: "s", createdAt: 100 })

    expect((yield* PluginInbox.list(kv)).map((record) => record.createdAt)).toEqual([300, 200, 100])
  }),
)

it.effect("persists messages outside the plugin instance that published them", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    yield* PluginInbox.make(kv, "test.inbox.a").publish({ externalID: "m", title: "one", summary: "s" })

    // Nothing prunes a message on its own: a fresh instance, as after a restart, still reads it.
    const records = yield* PluginInbox.make(kv, "test.inbox.a").list()
    expect(records).toHaveLength(1)
    expect(records[0].title).toBe("one")
  }),
)

it.effect("notifies the publisher when the user marks its message read", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const inbox = PluginInbox.make(kv, "test.inbox.a")
    const seen: string[][] = []
    inbox.onSeen((ids) => seen.push(ids))
    const id = yield* inbox.publish({ externalID: "m", title: "one", summary: "s" })

    yield* PluginInbox.mark(kv, id)

    expect(seen).toEqual([[id]])
    expect((yield* inbox.list())[0].seen).toBe(true)
    // A second open is not another user action.
    yield* PluginInbox.mark(kv, id)
    expect(seen).toHaveLength(1)
  }),
)

it.effect("ignores a mark for an id no message owns", () =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const inbox = PluginInbox.make(kv, "test.inbox.a")
    const seen: string[][] = []
    inbox.onSeen((ids) => seen.push(ids))
    yield* inbox.publish({ externalID: "m", title: "one", summary: "s" })

    yield* PluginInbox.mark(kv, "missing")

    expect(seen).toEqual([])
  }),
)
