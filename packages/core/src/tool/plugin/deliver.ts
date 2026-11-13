export * as DeliverTool from "./deliver.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { getFilename } from "@opencode/util/path"
import { parseSessionMention } from "@opencode/util/session-mention"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { SessionSchema } from "../../session/schema.js"

export const name = "deliver"

export const description = [
  "Deliver a message from this session to another session (another agent) and put it in that session's task queue.",
  "Use this only when the user explicitly wants information or a task handed to another session: telling it about a change, asking it to do something, asking for its result or progress, or handing a task over.",
  "Do not use it when the user only mentions, cites, or compares another session, when this session can finish the work itself, or when the target is unclear or there is nothing to deliver.",
  "",
  "`to` is a session address: `ses_xxx`, `@session:ses_xxx`, or the exact title of a session in this project. If a title matches more than one session the call fails with the candidates; ask the user instead of guessing.",
  '`intent` defaults to "request", which asks the target to do the work and answer with `intent: "reply"`. Use "note" for background information, "reply" to answer a delivery you received, and "handoff" to transfer ownership of the task.',
  "A reply needs `replyTo` with the `sessionID` and `messageID` returned by the delivery. Envelopes in the target session also show it.",
  'Delivery is queued by default so it does not interrupt the target\'s current step. Pass delivery: "steer" only when the user needs it to interrupt.',
].join("\n")

export const Input = Schema.Struct({
  to: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "The target session: ses_xxx, @session:ses_xxx, or an exact session title in this project.",
  }),
  text: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "The message to deliver. Write what the target needs to act on; it cannot see this session's history.",
  }),
  intent: Schema.optionalKey(Schema.Literals(["request", "reply", "note", "handoff"])).annotate({
    description:
      'What the target should do with the message. Defaults to "request". Use "reply" with replyTo to answer a delivery.',
  }),
  replyTo: Schema.optionalKey(
    Schema.Struct({
      sessionID: SessionSchema.ID,
      messageID: SessionMessage.ID,
    }),
  ).annotate({
    description: "The delivery being answered. Required for intent: reply.",
  }),
  expectsReply: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Whether the target should answer with a reply. Defaults to true for request and handoff.",
  }),
  deadline: Schema.optionalKey(Schema.String).annotate({
    description: "When the reply is expected, as an ISO date or a short human description.",
  }),
  delivery: Schema.optionalKey(SessionInbox.Delivery).annotate({
    description:
      'How the message enters the target queue. "queue" (default) waits for the target\'s current step; "steer" interrupts it.',
  }),
  resume: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Whether an idle target should start working immediately. Defaults to true.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
  status: Schema.Literal("queued"),
})

export const Plugin = {
  id: "opencode.tool.deliver",
  effect: Effect.fn("DeliverTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service

    const resolveTarget = Effect.fn("DeliverTool.resolveTarget")(function* (to: string) {
      const mention = parseSessionMention(to)
      if (mention)
        return yield* ctx.session
          .get({ sessionID: SessionSchema.ID.make(mention.id) })
          .pipe(Effect.mapError((error) => new ToolFailure({ message: `Session not found: ${mention.id}`, error })))

      const found = yield* ctx.session
        .list({ search: to, limit: 5 })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: `Could not search sessions for "${to}"`, error })))

      const [first, second] = found.data
      if (first && !second) return first
      if (!first)
        return yield* new ToolFailure({
          message: `No session matches "${to}". Use the exact session ID (ses_xxx) if the title is wrong or the session is in another project.`,
        })
      return yield* new ToolFailure({
        message: [
          `More than one session matches "${to}":`,
          ...found.data.map((session) => `- ${session.title ?? "Untitled"} (${session.id})`),
          "Ask the user which one to use, then pass its session ID.",
        ].join("\n"),
      })
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const from = yield* ctx.session
                .get({ sessionID: context.sessionID })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Current session not found: ${context.sessionID}`, error }),
                  ),
                )
              const target = yield* resolveTarget(input.to)

              if (target.id === from.id)
                return yield* new ToolFailure({ message: "Cannot deliver a message to the current session." })

              const intent = input.intent ?? "request"
              if (intent === "reply" && input.replyTo === undefined)
                return yield* new ToolFailure({
                  message: 'intent "reply" needs replyTo with the sessionID and messageID of the delivery it answers.',
                })

              yield* permission
                .assert({
                  action: name,
                  resources: [target.id],
                  save: [target.id],
                  ...Permission.invocation(context),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Delivery to ${target.id} was not allowed`, error }),
                  ),
                )

              const expectsReply = input.expectsReply ?? (intent === "request" || intent === "handoff")
              const replyTo =
                input.replyTo === undefined ? "none" : `${input.replyTo.sessionID}/${input.replyTo.messageID}`
              const messageID = SessionMessage.ID.create()
              const envelope = {
                kind: "session.delivery",
                id: messageID,
                from: {
                  sessionID: from.id,
                  title: from.title,
                  directory: from.location.directory,
                  agent: from.agent,
                },
                to: target.id,
                intent,
                replyTo: input.replyTo,
                expectsReply,
                deadline: input.deadline,
              }
              const title = target.title ?? target.id
              const text = [
                "⟦cross-session delivery⟧",
                `from: @${from.title ?? from.id} (${from.id})${from.agent ? ` · ${from.agent}` : ""}`,
                `project: ${from.location.directory}`,
                `intent: ${intent}`,
                `reply_to: ${replyTo}`,
                `expects_reply: ${expectsReply ? "yes" : "no"}${input.deadline ? ` (by ${input.deadline})` : ""}`,
                ...(expectsReply
                  ? [
                      `reply_with: deliver({ to: "${from.id}", intent: "reply", replyTo: { sessionID: "${from.id}", messageID: "${messageID}" }, text: "..." })`,
                    ]
                  : []),
                "⟦message⟧",
                input.text,
              ].join("\n")
              // What a person reads in place of the header above: a mail header. A session link shows the
              // title and agent while its tooltip carries the full address, and the project path renders as
              // its folder name through the Markdown local-path decoration.
              const sessionLink = (session: { id: string; title?: string; agent?: string }) => {
                const title = session.title ?? session.id
                // A fresh session has no agent yet, so naming one would invent a choice the user never made.
                const suffix = session.agent ? ` · ${session.agent}` : ""
                // A title is arbitrary text, so it must not close the link or its quoted tooltip early.
                const text = `${title}`.replace(/([\\[\]])/g, "\\$1")
                const tooltip = `@${title} (${session.id})${suffix}`.replace(/([\\"])/g, "\\$1")

                return `[@${text}${suffix}](@session:${session.id} "${tooltip}")`
              }
              const displayText = [
                // Each mail-header line ends with a backslash so Markdown keeps its own line instead of
                // folding the block into one paragraph.
                `from: ${sessionLink(from)}\\`,
                `to: ${sessionLink(target)}\\`,
                `project: [${getFilename(from.location.directory)}](@project:${from.location.directory})\\`,
                `intent: ${intent}\\`,
                `expects_reply: ${expectsReply ? "yes" : "no"}${input.deadline ? `, by ${input.deadline}` : ""}`,
                "",
                "---",
                "",
                input.text,
              ].join("\n")

              const admitted = yield* ctx.session
                .prompt({
                  id: messageID,
                  sessionID: target.id,
                  text,
                  // Presentation needs all three fields; a missing one drops the whole record and shows `text`.
                  metadata: { delivery: envelope, displayText, comments: [], attachments: [] },
                  delivery: input.delivery ?? "queue",
                  resume: input.resume ?? true,
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to deliver a message to ${target.id}`, error }),
                  ),
                )

              return {
                output: { sessionID: target.id, messageID: admitted.id, status: "queued" as const },
                content: [
                  `Delivered to @${title} (${target.id}) as ${intent}, ${
                    (input.delivery ?? "queue") === "steer"
                      ? "steering into its current step"
                      : "queued after its current step"
                  }.`,
                  `messageID: ${admitted.id}`,
                  expectsReply
                    ? `The target is expected to reply. Answer any delivery you receive with intent: "reply" and replyTo: { sessionID, messageID }.`
                    : "No reply is expected.",
                ].join("\n"),
                metadata: { sessionID: target.id, messageID: admitted.id, intent },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
