export * as ForkTool from "./fork.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionFork } from "@opencode/schema/session-fork"
import { SessionMessage } from "@opencode/schema/session-message"
import { DateTime, Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { SessionSchema } from "../../session/schema.js"
import { ForkEmptyError, MessageNotFoundError, NotFoundError } from "../../session/error.js"
import { SessionTarget } from "./session-target.js"

export const name = "fork"

export const description = [
  "Copy a session's history into a new session that has not started, so a different approach can be tried without losing the original.",
  "This copies only: nothing is delivered, the new session is not woken, the current session is not switched and the source session is not interrupted. Give the copy work with `deliver` or `redirect` afterwards.",
  "`to` is the session to copy: ses_xxx, @session:ses_xxx, or an exact title of a session in this project. Omit it to fork the current session. Forking another session copies its whole history; that is reported, not confirmed.",
  "`before` copies the history up to but excluding that message. Omit it to copy through the newest message.",
  "The source session is unchanged either way. The result is a separate session with its own id.",
].join("\n")

export const Input = Schema.Struct({
  to: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))).annotate({
    description: "The session to copy. Omit to fork the current session.",
  }),
  before: Schema.optionalKey(SessionMessage.ID).annotate({
    description: "Copy the history before this message. Omit to copy through the newest message.",
  }),
})

export const Output = Schema.Struct({
  id: SessionSchema.ID,
  title: Schema.optional(Schema.String),
  parentID: Schema.optional(SessionSchema.ID),
  directory: Schema.String,
  boundary: SessionFork.Boundary,
  created: Schema.String,
})

export const Plugin = {
  id: "opencode.tool.fork",
  effect: Effect.fn("ForkTool.Plugin")(function* (ctx: Context) {
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
              // Omitting `to` forks the caller, which is the common case: branch from here without naming it.
              const target = input.to === undefined ? from : yield* SessionTarget.resolve(ctx, input.to)

              yield* permission
                .assert({
                  action: name,
                  resources: [target.id],
                  save: [target.id],
                  ...Permission.invocation(context),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Fork of ${target.id} was not allowed`, error }),
                  ),
                )

              const forked = yield* ctx.session
                .fork({
                  sessionID: target.id,
                  ...(input.before === undefined ? {} : { before: input.before }),
                })
                .pipe(
                  Effect.catch((error) => {
                    // A wrapped error's own message wins over this one, so the curated text stays unwrapped.
                    if (error instanceof ForkEmptyError)
                      return Effect.fail(
                        new ToolFailure({
                          message: `Cannot fork ${target.id}: that session has no messages yet, so there is no history to copy.`,
                        }),
                      )
                    if (error instanceof MessageNotFoundError)
                      return Effect.fail(
                        new ToolFailure({
                          message: `Message ${input.before} is not in ${target.id}, so there is nothing to fork before it.`,
                        }),
                      )
                    if (error instanceof NotFoundError)
                      return Effect.fail(new ToolFailure({ message: `Session not found: ${target.id}` }))

                    return Effect.fail(new ToolFailure({ message: `Could not fork ${target.id}`, error }))
                  }),
                )

              const boundary = forked.fork?.boundary
              if (!boundary)
                return yield* new ToolFailure({
                  message: `Forked session ${forked.id} did not record its boundary, so the copy point is unknown.`,
                })

              return {
                output: {
                  id: forked.id,
                  title: forked.title,
                  parentID: forked.parentID,
                  directory: forked.location.directory,
                  boundary,
                  created: DateTime.formatIso(forked.time.created),
                },
                content: [
                  `Forked @${target.title ?? target.id} (${target.id}) into @${forked.title ?? forked.id} (${forked.id}).`,
                  `The copy holds the history ${boundary.type === "before" ? "before" : "through"} message ${boundary.messageID}.`,
                  "It is a copy only: nothing was delivered, no step was started, and the source session is unchanged.",
                  "Use deliver or redirect to give the new session work when you are ready.",
                ].join("\n"),
                metadata: { sessionID: forked.id, source: target.id },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
