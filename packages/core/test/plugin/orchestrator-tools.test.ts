import { describe, expect, it as plain } from "bun:test"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionSchema } from "@opencode/core/session/schema"
import { ForkEmptyError, MessageNotFoundError, NotFoundError } from "@opencode/core/session/error"
import { parseDivergence, parseStatusPorcelain } from "@opencode/core/git"
import { ForkTool } from "@opencode/core/tool/plugin/fork"
import { RedirectTool } from "@opencode/core/tool/plugin/redirect"
import { SessionsTool } from "@opencode/core/tool/plugin/sessions"
import { UndoTool, planUndo, run as runUndo } from "@opencode/core/tool/plugin/undo"
import { Tool } from "@opencode/core/tool"
import { Money } from "@opencode/schema/money"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { DateTime, Effect, Schema } from "effect"
import { executeTool, registerToolPlugin, toolIdentity } from "../lib/tool"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const effectIt = testEffect(PluginTestLayer)

const sessionID = (suffix: string) => Session.ID.make(`ses_${suffix.repeat(26)}`)
const TARGET = sessionID("t")
const MINE = sessionID("m")
const OTHER = sessionID("o")

const info = (
  id: Session.ID,
  overrides: { title?: string; busy?: number; idle?: number; directory?: string; updated?: number } = {},
) =>
  Session.Info.make({
    id,
    projectID: Project.ID.global,
    title: overrides.title ?? id,
    cost: Money.USD.zero,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: DateTime.makeUnsafe(overrides.updated ?? 0),
      updated: DateTime.makeUnsafe(overrides.updated ?? 0),
      ...(overrides.busy === undefined ? {} : { busy: DateTime.makeUnsafe(overrides.busy) }),
      ...(overrides.idle === undefined ? {} : { idle: DateTime.makeUnsafe(overrides.idle) }),
    },
    location: { directory: AbsolutePath.make(overrides.directory ?? "/workspace") },
  })

const inboxItem = (id: string, from?: Session.ID) =>
  Schema.decodeUnknownSync(SessionInbox.Info)({
    type: "user",
    id,
    sessionID: TARGET,
    time: { created: 0 },
    delivery: "queue",
    payload: { text: "instruction", ...(from ? { metadata: { delivery: { from: { sessionID: from } } } } : {}) },
  })

const admitted = (id: SessionMessage.ID) =>
  Schema.decodeUnknownSync(SessionInbox.User)({
    type: "user",
    id,
    sessionID: TARGET,
    time: { created: 0 },
    delivery: "queue",
    payload: { text: "instruction" },
  })

const call = (name: string, input: unknown) => ({
  sessionID: MINE,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call-${name}`, name, input },
})

/** Fails with the tool error instead of a confusing `undefined` from a missing output. */
const completed = <T>(result: { status: string; output?: unknown; error?: unknown }) => {
  if (result.status !== "completed") throw new Error(JSON.stringify(result.error))

  return result.output as T
}

describe("worktree status parsing", () => {
  plain("reads ahead and behind from the left-right count", () => {
    expect(parseDivergence("3\t7\n")).toEqual({ ahead: 7, behind: 3 })
    expect(parseDivergence("0\t0")).toEqual({ ahead: 0, behind: 0 })
  })

  plain("treats any porcelain line, tracked or untracked, as dirty", () => {
    expect(parseStatusPorcelain(" M packages/core/src/git.ts\n?? note.md\n")).toBe(true)
    expect(parseStatusPorcelain("?? note.md\n")).toBe(true)
    expect(parseStatusPorcelain("")).toBe(false)
    expect(parseStatusPorcelain("\n")).toBe(false)
  })
})

describe("session time", () => {
  const time = (busy?: number, idle?: number) => ({
    created: DateTime.makeUnsafe(0),
    updated: DateTime.makeUnsafe(0),
    ...(busy === undefined ? {} : { busy: DateTime.makeUnsafe(busy) }),
    ...(idle === undefined ? {} : { idle: DateTime.makeUnsafe(idle) }),
  })

  plain("is running only while the last start is newer than the last end", () => {
    // Neither timestamp: the session has never run.
    expect(SessionSchema.sessionStatus(time())).toBe("idle")
    // Only idle: a completed run.
    expect(SessionSchema.sessionStatus(time(undefined, 5))).toBe("idle")
    // Only busy: a live run that has not ended yet.
    expect(SessionSchema.sessionStatus(time(9))).toBe("running")
    // A start after the last end is live; a start the end already covers is over.
    expect(SessionSchema.sessionStatus(time(9, 4))).toBe("running")
    expect(SessionSchema.sessionStatus(time(4, 9))).toBe("idle")
  })
})

describe("undo planning", () => {
  plain("withdraws only deliveries from this session and leaves the rest pending", () => {
    const pending = [inboxItem("msg_mine", MINE), inboxItem("msg_user"), inboxItem("msg_other", OTHER)]

    expect(planUndo({ pending, from: MINE })).toEqual({ cancel: ["msg_mine"], failed: [] })
  })

  plain("reports a delivered id and a foreign pending id instead of dropping them", () => {
    const plan = planUndo({
      pending: [inboxItem("msg_mine", MINE), inboxItem("msg_other", OTHER)],
      from: MINE,
      ids: ["msg_mine", "msg_delivered", "msg_other"],
    })

    expect(plan.cancel).toEqual(["msg_mine"])
    expect(plan.failed.map((failure) => failure.id)).toEqual(["msg_delivered", "msg_other"])
    expect(plan.failed[0].reason).toContain("already delivered")
    expect(plan.failed[1].reason).toContain("not delivered by this session")
  })

  effectIt.effect("keeps the real reason when cancelling a pending item fails", () =>
    Effect.gen(function* () {
      const result = yield* runUndo({
        pending: [inboxItem("msg_mine", MINE)],
        from: MINE,
        ids: ["msg_mine"],
        cancel: () => Effect.fail(new Error("inbox conflict")),
      })

      expect(result.cancelled).toEqual([])
      expect(result.failed).toEqual([{ id: "msg_mine", reason: "inbox conflict" }])
    }))
})

describe("fork", () => {
  const forkedInfo = (boundary: { type: "before" | "through"; messageID: SessionMessage.ID }) =>
    Session.Info.make({
      id: sessionID("f"),
      projectID: Project.ID.global,
      title: "copy",
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(1), updated: DateTime.makeUnsafe(1) },
      location: { directory: AbsolutePath.make("/workspace") },
      fork: { sessionID: MINE, boundary },
    })

  effectIt.live("forks the current session and copies through the newest message by default", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const calls: Array<{ sessionID: string; before?: string }> = []
      // Any delivery or interruption here would break the copy-only guarantee.
      const forbidden = () => Effect.die("fork must not run the session")
      yield* registerToolPlugin(ForkTool.Plugin, {
        session: {
          get: (input) => Effect.succeed(info(input.sessionID)),
          fork: (input) => {
            calls.push(input)

            return Effect.succeed(forkedInfo({ type: "through", messageID: SessionMessage.ID.make("msg_newest") }))
          },
          prompt: forbidden,
          interrupt: forbidden,
          inbox: { list: forbidden, cancel: forbidden, update: forbidden },
        },
      })

      const result = yield* executeTool(registry, call("fork", {}))
      const output = completed<{ id: string; boundary: { type: string; messageID: string } }>(result)

      expect(calls).toEqual([{ sessionID: MINE }])
      expect(output.id).toBe(sessionID("f"))
      expect(output.boundary).toEqual({ type: "through", messageID: "msg_newest" })
    }),
  )

  effectIt.live("forks another session before the given message", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const calls: Array<{ sessionID: string; before?: string }> = []
      yield* registerToolPlugin(ForkTool.Plugin, {
        session: {
          get: (input) => Effect.succeed(info(input.sessionID)),
          fork: (input) => {
            calls.push(input)

            return Effect.succeed(forkedInfo({ type: "before", messageID: SessionMessage.ID.make("msg_cut") }))
          },
        },
      })

      yield* executeTool(registry, call("fork", { to: TARGET, before: "msg_cut" }))

      expect(calls).toEqual([{ sessionID: TARGET, before: "msg_cut" }])
    }),
  )

  effectIt.live("reports an empty source session on its own", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      yield* registerToolPlugin(ForkTool.Plugin, {
        session: {
          get: (input) => Effect.succeed(info(input.sessionID)),
          fork: (input) => Effect.fail(new ForkEmptyError({ sessionID: input.sessionID })),
        },
      })

      const result = yield* executeTool(registry, call("fork", { to: TARGET }))

      expect(result.status).toBe("error")
      expect(JSON.stringify(result.error)).toContain("no messages yet")
    }),
  )

  effectIt.live("reports a message that is not in the session on its own", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      yield* registerToolPlugin(ForkTool.Plugin, {
        session: {
          get: (input) => Effect.succeed(info(input.sessionID)),
          fork: () =>
            Effect.fail(
              new MessageNotFoundError({
                sessionID: TARGET,
                messageID: SessionMessage.ID.make("msg_absent"),
              }),
            ),
        },
      })

      const result = yield* executeTool(registry, call("fork", { to: TARGET, before: "msg_absent" }))

      expect(result.status).toBe("error")
      expect(JSON.stringify(result.error)).toContain("is not in")
    }),
  )

  effectIt.live("reports a missing session on its own", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      yield* registerToolPlugin(ForkTool.Plugin, {
        session: {
          get: (input) => Effect.succeed(info(input.sessionID)),
          fork: (input) => Effect.fail(new NotFoundError({ sessionID: input.sessionID })),
        },
      })

      const result = yield* executeTool(registry, call("fork", { to: TARGET }))

      expect(result.status).toBe("error")
      expect(JSON.stringify(result.error)).toContain("Session not found")
    }),
  )
})

describe("built-in orchestrator tools", () => {
  effectIt.live("sessions truncates to the limit and keeps the order the server returned", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const listed = [
        info(sessionID("a"), { title: "newest", updated: 3 }),
        info(sessionID("b"), { title: "middle", updated: 2 }),
        info(sessionID("c"), { title: "oldest", updated: 1 }),
      ]
      yield* registerToolPlugin(SessionsTool.Plugin, {
        session: { list: () => Effect.succeed({ data: listed, cursor: {} }) },
      })

      const result = yield* executeTool(registry, call("sessions", { limit: 2 }))
      const rows = completed<{ sessions: ReadonlyArray<{ id: string; title: string; worktree: unknown }> }>(
        result,
      ).sessions

      expect(result.status).toBe("completed")
      expect(rows.map((row) => row.title)).toEqual(["newest", "middle"])
      // /workspace is not a repository here, so the row says so instead of inventing a branch.
      expect(rows[0].worktree).toBeNull()
    }),
  )

  effectIt.live("undo withdraws this session's pending deliveries and touches nothing else", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const cancelled: string[] = []
      yield* registerToolPlugin(UndoTool.Plugin, {
        session: {
          get: (input) => Effect.succeed(info(input.sessionID)),
          inbox: {
            list: () =>
              Effect.succeed([inboxItem("msg_mine", MINE), inboxItem("msg_user"), inboxItem("msg_other", OTHER)]),
            cancel: (input) =>
              Effect.sync(() => {
                cancelled.push(input.inboxID)
              }),
            update: () => Effect.void,
          },
        },
      })

      const result = yield* executeTool(registry, call("undo", { to: TARGET }))

      expect(result.status).toBe("completed")
      expect(cancelled).toEqual(["msg_mine"])
      expect(result.output).toEqual({ cancelled: ["msg_mine"], failed: [] })
    }),
  )

  effectIt.live("undo fails loudly on a delivered message", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      const cancelled: string[] = []
      yield* registerToolPlugin(UndoTool.Plugin, {
        session: {
          get: (input) => Effect.succeed(info(input.sessionID)),
          inbox: {
            list: () => Effect.succeed([inboxItem("msg_mine", MINE)]),
            cancel: (input) =>
              Effect.sync(() => {
                cancelled.push(input.inboxID)
              }),
            update: () => Effect.void,
          },
        },
      })

      const result = yield* executeTool(registry, call("undo", { to: TARGET, ids: ["msg_delivered"] }))

      expect(cancelled).toEqual([])
      expect(result.output.cancelled).toEqual([])
      expect(result.output.failed).toEqual([
        {
          id: "msg_delivered",
          reason: "Not pending: already delivered or unknown. Use redirect to send a corrected message.",
        },
      ])
    }),
  )

  effectIt.live("redirect leaves the target alone unless interruption is asked for", () =>
    Effect.gen(function* () {
      const registry = yield* Tool.Service
      let interrupted = false
      let delivered = 0
      yield* registerToolPlugin(RedirectTool.Plugin, {
        session: {
          get: (input) => Effect.succeed(info(input.sessionID)),
          interrupt: () =>
            Effect.sync(() => {
              interrupted = true

              return { interrupted: true }
            }),
          prompt: (input) =>
            Effect.sync(() => {
              delivered++

              return admitted(input.id ?? SessionMessage.ID.make("msg_redirect"))
            }),
          inbox: {
            list: () => Effect.succeed([inboxItem("msg_mine", MINE), inboxItem("msg_user")]),
            cancel: () => Effect.void,
            update: () => Effect.void,
          },
        },
      })

      const result = yield* executeTool(registry, call("redirect", { to: TARGET, text: "start over" }))

      expect(result.status).toBe("completed")
      expect(interrupted).toBe(false)
      expect(delivered).toBe(1)
      expect(result.output.interrupted).toBe(false)
      // The earlier delivery is left pending but reported, so the caller can decide to undo it.
      expect(result.output.pendingFromHere).toBe(1)
    }),
  )
})
