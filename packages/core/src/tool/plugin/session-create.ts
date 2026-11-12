export * as SessionCreateTool from "./session-create.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import { SessionSchema } from "../../session/schema.js"

export const name = "session.create"

export const description = [
  "Create a new session in this project and return its id.",
  "Use it when the work should continue in a fresh context instead of this session: a long task that would fill this one, or a task for a different agent.",
  "Pass `prompt` to start the new session immediately with the first message; omit it to leave the session idle and deliver to it later.",
  "Creating a session only makes the session. This session does not see what happens inside it.",
].join("\n")

export const Input = Schema.Struct({
  title: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "The session title. Defaults to the title the server picks.",
  })),
  prompt: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1)).annotate({
    description:
      "The first message for the new session. Write it as a complete, self-contained request: the new session cannot see this one's history.",
  })),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
})

export const Plugin = {
  id: "opencode.tool.session-create",
  effect: Effect.fn("SessionCreateTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission
                .assert({
                  action: name,
                  resources: ["*"],
                  save: ["*"],
                  ...Permission.invocation(context),
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: "Creating a session was not allowed", error }),
                  ),
                )

              const created = yield* ctx.session
                .create({ title: input.title })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: "Failed to create a session", error })))

              if (input.prompt) {
                yield* ctx.session
                  .prompt({ sessionID: created.id, text: input.prompt, delivery: "queue", resume: true })
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new ToolFailure({
                          message: `Created session ${created.id}, but its first message could not be delivered`,
                          error,
                        }),
                    ),
                  )
              }

              const title = created.title ?? created.id

              return {
                output: { sessionID: created.id },
                content: [
                  `Created session @${title} (${created.id}).`,
                  input.prompt ? "It starts on the message you passed." : "It is idle until something is delivered to it.",
                  `Address it later with deliver({ to: "${created.id}", text: "..." }).`,
                ].join("\n"),
                metadata: { sessionID: created.id },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
