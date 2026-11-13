export * as RedirectTool from "./redirect.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { getFilename } from "@opencode/util/path"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { SessionSchema } from "../../session/schema.js"
import { SessionTarget } from "./session-target.js"

export const name = "redirect"

export const description = [
  "Send a target session a new plan that replaces every earlier instruction this session gave it, so a session that went down the wrong path starts over from the new plan.",
  "This is not a cancellation: pending messages this session already delivered stay in the target's queue only if you leave them there. The result reports how many are still pending and `undo` withdraws them.",
  "The message reaches the target the way a person typing in that session would, so it does not interrupt by default. Pass `interrupt: true` to stop the target's current step first; if that interruption fails nothing is delivered.",
  "`to` is a session address: `ses_xxx`, `@session:ses_xxx`, or an exact title of a session in this project. If a title matches more than one session the call fails with the candidates.",
].join("\n")

export const Input = Schema.Struct({
  to: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "The target session: ses_xxx, @session:ses_xxx, or an exact session title in this project.",
  }),
  text: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "The new plan. State what replaced the earlier instructions so the target stops following them.",
  }),
  interrupt: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Whether to stop the target's current step before delivering. Defaults to false.",
  }),
  delivery: Schema.optionalKey(SessionInbox.Delivery).annotate({
    description: 'How the message enters the target queue. "queue" (default) waits for its current step; "steer" delivers at the next step boundary.',
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
  status: Schema.Literal("queued"),
  interrupted: Schema.Boolean,
  /** Deliveries from this session still pending in the target, which `undo` can withdraw. */
  pendingFromHere: Schema.Int,
})

/**
 * Interrupts the target only when asked. A false `interrupt` must not touch the target at all, so the
 * decision is a value rather than a skipped side effect buried in the caller.
 */
export const interruptFirst = <E>(input: {
  readonly interrupt: boolean
  readonly target: () => Effect.Effect<boolean, E>
}): Effect.Effect<{ interrupted: boolean }, E> =>
  input.interrupt
    ? input.target().pipe(Effect.map((interrupted) => ({ interrupted })))
    : Effect.succeed({ interrupted: false })

export const Plugin = {
  id: "opencode.tool.redirect",
  effect: Effect.fn("RedirectTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service

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
              const target = yield* SessionTarget.resolve(ctx, input.to)

              if (target.id === from.id)
                return yield* new ToolFailure({ message: "Cannot redirect the current session." })

              yield* permission
                .assert({
                  action: name,
                  resources: [target.id],
                  save: [target.id],
                  ...Permission.invocation(context),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Redirect to ${target.id} was not allowed`, error }),
                  ),
                )

              // Interruption is a separate decision from delivery: a failed interruption sends nothing.
              const { interrupted } = yield* interruptFirst({
                interrupt: input.interrupt ?? false,
                target: () =>
                  ctx.session
                    .interrupt({ sessionID: target.id })
                    .pipe(
                      Effect.map((result) => result.interrupted),
                      Effect.mapError(
                        (error) =>
                          new ToolFailure({
                            message: `Could not interrupt ${target.id}; nothing was delivered`,
                            error,
                          }),
                      ),
                    ),
              })

              const pending = yield* ctx.session.inbox.list({ sessionID: target.id }).pipe(
                Effect.mapError(
                  (error) => new ToolFailure({ message: `Could not read the queue of ${target.id}`, error }),
                ),
              )
              const pendingFromHere = pending.filter((item) => SessionTarget.deliveredBy(item) === from.id).length

              const messageID = SessionMessage.ID.create()
              const envelope = {
                kind: "session.redirect",
                id: messageID,
                from: {
                  sessionID: from.id,
                  title: from.title,
                  directory: from.location.directory,
                  agent: from.agent,
                },
                to: target.id,
                supersedes: true,
                replacesPending: pendingFromHere,
              }
              const title = target.title ?? target.id
              const text = [
                "⟦cross-session redirect⟧",
                `from: @${from.title ?? from.id} (${from.id})${from.agent ? ` · ${from.agent}` : ""}`,
                `project: ${from.location.directory}`,
                "supersedes: every earlier instruction from this session",
                `pending_from_sender: ${pendingFromHere}${pendingFromHere > 0 ? " (still queued; the sender may withdraw them with undo)" : ""}`,
                "⟦message⟧",
                input.text,
              ].join("\n")
              const sessionLink = (session: { id: string; title?: string; agent?: string }) => {
                const title = session.title ?? session.id
                const suffix = session.agent ? ` · ${session.agent}` : ""
                const text = `${title}`.replace(/([\\[\]])/g, "\\$1")
                const tooltip = `@${title} (${session.id})${suffix}`.replace(/([\\"])/g, "\\$1")

                return `[@${text}${suffix}](@session:${session.id} "${tooltip}")`
              }
              const displayText = [
                `from: ${sessionLink(from)}\\`,
                `to: ${sessionLink(target)}\\`,
                `project: [${getFilename(from.location.directory)}](@project:${from.location.directory})`,
                "",
                "**此前收到的需求作废，以本条为准。**",
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
                  metadata: { delivery: envelope, displayText, comments: [], attachments: [] },
                  delivery: input.delivery ?? "queue",
                  resume: true,
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to redirect ${target.id}`, error }),
                  ),
                )

              return {
                output: {
                  sessionID: target.id,
                  messageID: admitted.id,
                  status: "queued" as const,
                  interrupted,
                  pendingFromHere,
                },
                content: [
                  `Redirected @${title} (${target.id}) to the new plan.`,
                  `messageID: ${admitted.id}`,
                  describeInterruption(input.interrupt ?? false, interrupted),
                  pendingFromHere > 0
                    ? `${pendingFromHere} earlier delivery from this session is still pending in the target. It was left in place; call undo with this target to withdraw it if the old plan must not run.`
                    : "No earlier delivery from this session is pending in the target.",
                ].join("\n"),
                metadata: { sessionID: target.id, messageID: admitted.id },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

const describeInterruption = (requested: boolean, interrupted: boolean) => {
  if (!requested) return "The target was not interrupted; the new plan waits for its current step."
  return interrupted
    ? "The target's current step was interrupted before delivery."
    : "The target had no running step to interrupt; the new plan is queued."
}
