import { describe, expect } from "bun:test"
import { PROTOCOL_SHORT } from "@aicraft/memory"
import { SystemMessage, UserMessage } from "@aicraft/ai/effect"
import { Agent } from "@aicraft/core/agent"
import { Plugin } from "@aicraft/core/plugin"
import { PluginHooks } from "@aicraft/core/plugin/hooks"
import { PluginHost } from "@aicraft/core/plugin/host"
import { MemoryPlugin } from "@aicraft/core/plugin/memory"
import { Location } from "@aicraft/core/location"
import { MemoryService } from "@aicraft/core/memory/service"
import { MemoryLogTable } from "@aicraft/core/memory/sql"
import { Database } from "@aicraft/core/database/database"
import { Provider } from "@aicraft/core/provider"
import { Rpc } from "@aicraft/core/rpc"
import { Session } from "@aicraft/core/session"
import { SessionMessage } from "@aicraft/core/session/message"
import { Skill } from "@aicraft/core/skill"
import { Tool } from "@aicraft/core/tool"
import { Model } from "@aicraft/schema/model"
import type { SessionHooks } from "@aicraft/aix/effect/session"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const activate = Effect.gen(function* () {
  const plugins = yield* Plugin.Service
  yield* MemoryPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))
})

describe("memory plugin", () => {
  it.live("registers the memory tools and skill", () =>
    Effect.gen(function* () {
      yield* activate
      const tools = yield* Tool.Service
      const names = (yield* tools.list()).map((tool) => tool.id)
      for (const name of ["memory_save", "memory_list", "memory_search", "memory_update", "memory_forget"])
        expect(names).toContain(name)

      const skills = yield* Skill.Service
      expect((yield* skills.list()).map((skill) => String(skill.id))).toContain("memory")
    }),
  )

  it.live("serves the settings RPC over the same storage", () =>
    Effect.gen(function* () {
      yield* activate
      const rpc = yield* Rpc.Service

      const saved = (yield* rpc.call("aicraft.memory", "save", {
        scope: "global",
        projectID: null,
        text: "回复用中文",
        tags: ["偏好"],
      })) as { entry: { id: string }; duplicate: boolean }
      expect(saved.duplicate).toBe(false)

      const listed = (yield* rpc.call("aicraft.memory", "list", { projectID: null })) as {
        global: ReadonlyArray<{ text: string }>
      }
      expect(listed.global.map((entry) => entry.text)).toEqual(["回复用中文"])

      const updated = (yield* rpc.call("aicraft.memory", "update", {
        scope: "global",
        projectID: null,
        id: saved.entry.id,
        text: "回复尽量用中文",
        tags: [],
      })) as { entry: { text: string } | null }
      expect(updated.entry?.text).toBe("回复尽量用中文")

      yield* rpc.call("aicraft.memory", "remove", {
        scope: "global",
        projectID: null,
        id: saved.entry.id,
      })
      const after = (yield* rpc.call("aicraft.memory", "list", { projectID: null })) as {
        global: ReadonlyArray<unknown>
      }
      expect(after.global).toHaveLength(0)
    }),
  )
})

describe("memory plugin injection", () => {
  const injectedTail = (event: SessionHooks["context"], messageID: string) => {
    const target = event.messages.find((message) => message.role === "user" && message.id === messageID)
    if (target?.role !== "user") return ""
    return target.content.filter((part) => part.type === "text").map((part) => part.text).slice(1).join("\n")
  }

  const context = (sessionID: Session.ID, messageID: string, text: string): SessionHooks["context"] => ({
    sessionID,
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("m1") }),
    system: [],
    messages: [
      new SystemMessage({ role: "system", content: [] }),
      new UserMessage({ id: messageID, role: "user", content: [{ type: "text", text }] }),
    ],
    tools: {},
    options: {},
  })

  it.effect("lands the turn block at the tail of the prompt message, stable across steps", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const session = yield* sessions.create({ location: { directory: location.directory } })
      const hooks = yield* PluginHooks.Service
      yield* activate

      const rpc = yield* Rpc.Service
      yield* rpc.call("aicraft.memory", "save", {
        scope: "global",
        projectID: null,
        text: "分支命名规范：用短横线分隔，禁止斜杠和类型前缀",
        tags: ["git"],
      })
      const service = yield* MemoryService.Service
      // Gate: the turn pipeline is retrieval-index-driven, not a recency window, and the block
      // stays far below the legacy 4000-char per-step cost. Measured on this exact pair.
      const turn = yield* Effect.promise(() => service.subsystem.onTurn({ query: "分支命名规范", scopes: ["global"] }))
      expect(turn.injectBlock).toContain("用短横线分隔")
      expect(turn.injectBlock.length).toBeLessThanOrEqual(400)
      expect(turn.decision.channels.trigger).toBe("ran")
      expect(turn.decision.channels.lexical).toBe("ran")
      const miss = yield* Effect.promise(() => service.subsystem.onTurn({ query: "今天天气怎么样", scopes: ["global"] }))
      expect(miss.entries).toHaveLength(0)

      const admit = (messageID: string, text: string) =>
        hooks.trigger("session", "prompt", {
          sessionID: session.id,
          messageID: SessionMessage.ID.make(messageID),
          prompt: { text },
          delivery: "steer",
        })
      yield* admit("msg_branch", "分支命名规范")

      // Step one of the turn: the block reaches the request tail, never the system section; the
      // system carries only the byte-stable save-rules protocol (channel ①).
      const first = context(session.id, "msg_branch", "分支命名规范")
      yield* hooks.trigger("session", "context", first)
      const block = injectedTail(first, "msg_branch")
      expect(block).toContain("用短横线分隔")
      expect(block).toContain("Relevant memory")
      expect(first.system.map((part) => part.text)).toEqual([PROTOCOL_SHORT])
      // The block is reported as a Step-injected source, so the timeline shows one injection row.
      // `memory/protocol` rides the L1 prefix and is reported through `injected` for the audit; the
      // turn's retrieval block is the L6 entry beside it.
      expect(first.injected).toEqual([
        { key: "memory/protocol", layer: "L1", text: PROTOCOL_SHORT },
        { key: "memory", layer: "L6", text: block, items: first.injected?.find((entry) => entry.key === "memory")?.items },
      ])

      // An instructions synthetic joins history with role "user" after the prompt. It must not
      // hijack the retrieval query (its prose carries trigger words — a live `memory_log` case),
      // re-run the lookup, or steal the block's tail.
      const withSynthetic = context(session.id, "msg_branch", "分支命名规范")
      withSynthetic.messages.push(
        new UserMessage({
          id: "msg_instructions",
          role: "user",
          content: [{ type: "text", text: "Instructions from: AGENTS.md\npp 的含义是提交并推送" }],
        }),
      )
      yield* hooks.trigger("session", "context", withSynthetic)
      expect(withSynthetic.injected?.find((entry) => entry.key === "memory")?.text).toBe(block)
      expect(injectedTail(withSynthetic, "msg_branch")).toBe(block)
      expect(injectedTail(withSynthetic, "msg_instructions")).toBe("")

      // Step two reuses the turn result: identical bytes, so the provider cache prefix holds.
      const second = context(session.id, "msg_branch", "分支命名规范")
      yield* hooks.trigger("session", "context", second)
      expect(injectedTail(second, "msg_branch")).toBe(block)
      expect(second.system).toHaveLength(1)
      expect(second.injected?.find((entry) => entry.key === "memory")?.text).toBe(block)

      // memory_log records the one real retrieval — the cached steps and the synthetic add no
      // rows — and its query is the raw prompt, never the injected instruction text.
      const { db } = yield* Database.Service
      const rows = yield* db
        .select({ injected: MemoryLogTable.injected, mode: MemoryLogTable.mode, query: MemoryLogTable.query })
        .from(MemoryLogTable)
        .all()
      expect(rows.length).toBe(1)
      expect(rows[0]!.injected.length).toBeGreaterThan(0)
      expect(rows[0]!.mode).toBe("trigger+vector")
      expect(rows[0]!.query).toBe("分支命名规范")

      // An unrelated turn with no index hit injects nothing rather than a recency window.
      yield* admit("msg_weather", "今天天气怎么样")
      const quiet = context(session.id, "msg_weather", "今天天气怎么样")
      yield* hooks.trigger("session", "context", quiet)
      expect(injectedTail(quiet, "msg_weather")).toBe("")
      expect(quiet.injected?.some((entry) => entry.key === "memory")).toBe(false)
    }),
  )

  it.effect("sends a memory once, resends it changed, and never invents a removal", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const session = yield* sessions.create({ location: { directory: location.directory } })
      const hooks = yield* PluginHooks.Service
      yield* activate
      const rpc = yield* Rpc.Service
      const admit = (messageID: string, text: string) =>
        hooks.trigger("session", "prompt", {
          sessionID: session.id,
          messageID: SessionMessage.ID.make(messageID),
          prompt: { text },
          delivery: "steer",
        })

      const saved = (yield* rpc.call("aicraft.memory", "save", {
        scope: "global",
        projectID: null,
        text: "分支命名规范：用短横线分隔",
        tags: ["git"],
      })) as { entry: { id: string } }

      // Turn one: unseen, so the retrieval's own block rides with its header.
      yield* admit("msg_t1", "分支命名规范")
      const first = context(session.id, "msg_t1", "分支命名规范")
      yield* hooks.trigger("session", "context", first)
      const memoryOf = (event: SessionHooks["context"]) => event.injected?.find((entry) => entry.key === "memory")
      expect(memoryOf(first)?.text).toContain("Relevant memory")
      expect(memoryOf(first)?.text).toContain("用短横线分隔")

      // Turn two, same retrieval: already read, so nothing is re-sent. This is the settlement — the old
      // behaviour repeated the whole block on every turn of the conversation.
      yield* admit("msg_t2", "分支命名规范")
      const second = context(session.id, "msg_t2", "分支命名规范")
      yield* hooks.trigger("session", "context", second)
      expect(memoryOf(second)).toBeUndefined()
      expect(injectedTail(second, "msg_t2")).toBe("")

      // Turn three: the memory changed, so it is re-sent under the update marker.
      yield* rpc.call("aicraft.memory", "update", {
        scope: "global",
        projectID: null,
        id: saved.entry.id,
        text: "分支命名规范：用短横线分隔，禁止斜杠",
        tags: ["git"],
      })
      yield* admit("msg_t3", "分支命名规范")
      const third = context(session.id, "msg_t3", "分支命名规范")
      yield* hooks.trigger("session", "context", third)
      expect(memoryOf(third)?.text).toContain("(updated)")
      expect(memoryOf(third)?.text).toContain("禁止斜杠")

      // Turn four: a different topic retrieves different memories, and the ones missing from this result
      // must NOT be announced as removed. Retrieval is a relevance query — a turn about something else
      // simply does not return them, and calling that a deletion told the model two live memories were
      // gone. This assertion is the regression: it failed with "has been removed" against live entries.
      yield* admit("msg_t4", "今天天气怎么样")
      const fourth = context(session.id, "msg_t4", "今天天气怎么样")
      yield* hooks.trigger("session", "context", fourth)
      const fourthText = memoryOf(fourth)?.text ?? ""
      expect(fourthText).not.toContain("has been removed")
      expect(fourthText).not.toContain("no longer available")
    }),
  )

  it.effect("a turn that never came from a user prompt retrieves nothing", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const session = yield* sessions.create({ location: { directory: location.directory } })
      const hooks = yield* PluginHooks.Service
      yield* activate

      const rpc = yield* Rpc.Service
      yield* rpc.call("aicraft.memory", "save", {
        scope: "global",
        projectID: null,
        text: "分支命名规范：用短横线分隔，禁止斜杠和类型前缀",
        tags: ["git"],
      })
      // A bare synthetic — a restart note, a shell result, an instruction load — must not
      // become the query source even when its text would retrieve perfectly.
      const synthetic = context(session.id, "msg_synthetic", "分支命名规范")
      yield* hooks.trigger("session", "context", synthetic)
      expect(synthetic.injected?.some((entry) => entry.key === "memory")).toBe(false)
      expect(injectedTail(synthetic, "msg_synthetic")).toBe("")
    }),
  )
})
