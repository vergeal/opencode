import { describe, expect } from "bun:test"
import { DateTime, Effect, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { SessionSchema } from "@opencode/core/session/schema"
import { Tool } from "@opencode/core/tool"
import { DeliverTool } from "@opencode/core/tool/plugin/deliver"
import { AbsolutePath } from "@opencode/core/schema"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { testEffect } from "./lib/effect"
import { imagePassthrough } from "./lib/image"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const id = (suffix: string) => Session.ID.make(`ses_${suffix.padEnd(26, "0")}`)
const selfID = id("self")
const targetID = id("target")
const duplicateID = id("duplicate")
const uniqueID = id("unique")
const deliveredID = SessionMessage.ID.make("msg_deliver_sent")
const at = DateTime.makeUnsafe(0)

const it = testEffect(
  AppNodeBuilder.build(Tool.node, [Image.node.replace(imagePassthrough), Permission.node.replace(permissionLayer())]),
)

const session = (id: Session.ID, title: string, directory = "/project") =>
  SessionSchema.Info.make({
    id,
    projectID: Project.ID.make("prj_deliver"),
    cost: Money.USD.zero,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: at, updated: at },
    title,
    location: { directory: AbsolutePath.make(directory) },
  })

const setup = () =>
  Effect.gen(function* () {
    const prompts: Array<{
      id?: SessionMessage.ID
      sessionID: Session.ID
      text: string
      metadata?: Record<string, unknown>
      delivery?: SessionInbox.Delivery
      resume?: boolean
    }> = []
    const asserts: unknown[] = []
    const sessions = [session(targetID, "Reviewer"), session(duplicateID, "Reviewer"), session(uniqueID, "Docs")]
    const self = session(selfID, "Build")

    yield* registerToolPlugin(DeliverTool.Plugin, {
      event: { subscribe: () => Stream.empty },
      session: {
        get: ({ sessionID }) =>
          sessionID === self.id
            ? Effect.succeed(self)
            : Effect.succeed(sessions.find((session) => session.id === sessionID)).pipe(
                Effect.flatMap((session) =>
                  session ? Effect.succeed(session) : Effect.fail(new Error(`Session not found: ${sessionID}`)),
                ),
              ),
        list: (input) =>
          Effect.succeed({
            data: sessions.filter((session) => !input?.search || session.title === input.search),
            cursor: {},
          }),
        prompt: (input) =>
          Effect.sync(() => {
            prompts.push(input)
            return SessionInbox.User.make({
              id: input.id ?? deliveredID,
              sessionID: input.sessionID,
              payload: { text: input.text, metadata: input.metadata },
              delivery: input.delivery ?? "steer",
              time: { created: at },
            })
          }),
      },
    }).pipe(
      Effect.provide(
        permissionLayer({
          assert: (input) =>
            Effect.sync(() => {
              asserts.push(input)
            }),
        }),
      ),
    )

    return { registry: yield* Tool.Service, prompts, asserts }
  })

const call = (registry: Tool.Interface, input: unknown, sessionID = selfID) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: "call-deliver", name: "deliver", input },
  })

describe("DeliverTool", () => {
  it.effect("delivers to a session ID with a readable envelope", () =>
    Effect.gen(function* () {
      const { registry, prompts, asserts } = yield* setup()

      const result = yield* call(registry, { to: targetID, text: "Check the failing build." })

      expect(result.status).toBe("completed")
      expect(result.output).toMatchObject({ sessionID: targetID, status: "queued" })
      const messageID = result.output?.messageID
      expect(messageID).toBeString()
      expect(messageID).toBe(prompts[0]?.id ?? "")
      expect(asserts).toMatchObject([{ action: "deliver", resources: [targetID] }])
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toMatchObject({ sessionID: targetID, delivery: "queue", resume: true })
      const text = prompts[0]?.text ?? ""
      expect(text).toContain("⟦cross-session delivery⟧")
      expect(text).toContain(`from: @Build (${selfID})`)
      expect(text).toContain("intent: request")
      expect(text).toContain(`reply_to: none`)
      expect(text).toContain("expects_reply: yes")
      expect(text).toContain(`messageID: "${messageID}"`)
      expect(text).toContain("⟦message⟧")
      expect(text).toContain("Check the failing build.")
      expect(prompts[0]?.metadata).toMatchObject({
        delivery: { from: { sessionID: selfID }, to: targetID, intent: "request" },
      })
    }),
  )

  it.effect("resolves a unique title and accepts @session mentions", () =>
    Effect.gen(function* () {
      const { registry, prompts } = yield* setup()

      expect(yield* call(registry, { to: "Docs", text: "Read the design." })).toMatchObject({
        status: "completed",
        output: { sessionID: uniqueID },
      })
      expect(yield* call(registry, { to: `@session:${targetID}`, text: "Read the design." })).toMatchObject({
        status: "completed",
        output: { sessionID: targetID },
      })
      expect(prompts).toHaveLength(2)
    }),
  )

  it.effect("refuses the current session, ambiguous titles, and replies without replyTo", () =>
    Effect.gen(function* () {
      const { registry, prompts } = yield* setup()

      expect(yield* call(registry, { to: selfID, text: "Loop." })).toMatchObject({ status: "error" })
      const ambiguous = yield* call(registry, { to: "Reviewer", text: "Which one?" })
      expect(ambiguous.status).toBe("error")
      expect(ambiguous.error?.message).toContain(targetID)
      expect(ambiguous.error?.message).toContain(duplicateID)
      expect(yield* call(registry, { to: targetID, intent: "reply", text: "Done." })).toMatchObject({
        status: "error",
      })
      expect(prompts).toHaveLength(0)
    }),
  )

  it.effect("answers with replyTo and can steer instead of queueing", () =>
    Effect.gen(function* () {
      const { registry, prompts } = yield* setup()

      yield* call(registry, {
        to: targetID,
        intent: "reply",
        replyTo: { sessionID: targetID, messageID: deliveredID },
        text: "Finished.",
        delivery: "steer",
      })

      expect(prompts[0]).toMatchObject({ sessionID: targetID, delivery: "steer" })
      const text = prompts[0]?.text ?? ""
      expect(text).toContain("intent: reply")
      expect(text).toContain(`reply_to: ${targetID}/${deliveredID}`)
      expect(text).toContain("expects_reply: no")
    }),
  )
})
