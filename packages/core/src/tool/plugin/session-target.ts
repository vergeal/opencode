export * as SessionTarget from "./session-target.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import { parseSessionMention } from "@opencode/util/session-mention"
import { Effect } from "effect"
import { SessionSchema } from "../../session/schema.js"

/**
 * Resolves a session address the way `deliver` does: a session ID, an `@session:` mention, or an exact
 * title that matches exactly one session in this project. Anything ambiguous fails with the candidates so
 * the caller can ask instead of guessing.
 */
export const resolve = (ctx: Context, to: string) =>
  Effect.gen(function* () {
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

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The session that delivered a pending inbox item, read from the `delivery` envelope `deliver` and
 * `redirect` write into `metadata`. Undefined for a message the user typed, another plugin published,
 * or a delivery whose envelope was stripped, so ownership is never inferred from a missing field.
 */
export function deliveredBy(item: SessionInbox.Info) {
  if (item.type !== "user") return undefined

  const delivery = item.payload.metadata?.["delivery"]
  if (!record(delivery)) return undefined

  const from = delivery["from"]
  if (!record(from)) return undefined

  const sessionID = from["sessionID"]
  return typeof sessionID === "string" ? sessionID : undefined
}
