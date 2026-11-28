export * as InstructionBuiltIns from "./builtins.js"

import { makeLocationNode } from "@aicraft/util/effect/app-node"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Global } from "@aicraft/util/global"
import { Location } from "../location.js"
import { Instructions } from "./index.js"

export interface Interface {
  readonly load: () => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@aicraft/InstructionBuiltIns") {}

/**
 * Stated as a fact about the reader rather than a rule about the writer: the user gets a headache from
 * English, which is a reason to comply instead of a preference to weigh. Covers everything the model writes
 * — replies, labels, buttons, empty states, error messages, comments — and leaves code, identifiers, paths
 * and command names untouched, because those are code and not English.
 */
export const languageInstruction =
  "Always reply and think in Chinese; the user gets a headache when they see replies or thinking in English. That covers everything you write: replies, labels, buttons, empty states, error messages and comments. Code, identifiers, file paths and command names stay as they are: that is code, not English."

/**
 * Cost discipline, not capability: every tool call re-sends the whole history, so the step count dominates
 * spend. Static text, so it stays in the epoch baseline and never invalidates the prompt cache.
 */
export const toolEconomyInstruction =
  "Every tool call re-sends the full history, so the number of steps costs more than the size of any single result. Fire independent calls in the same step: reading several files, listing several directories, and running unrelated commands do not need to wait on each other. Merge unrelated probes into one command instead of a run of steps. Read a file in one pass rather than paging through it; when a file is large, locate the relevant region first. Do not re-run a command just to confirm an earlier edit landed — fold that check into the step that made the edit. Serialize only when one call's result decides how to ask for the next."

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const location = yield* Location.Service
    return Service.of({
      load: () =>
        Effect.succeed(
          Instructions.combine([
            Instructions.make({
              key: Instructions.Key.make("core/language"),
              // L1: static harness text that never changes at runtime; the §5 static-registration
              // face — an edit lands on version advance, not as a turn supply.
              layer: "L1",
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.succeed("zh"),
              render: {
                initial: () => languageInstruction,
                changed: () => languageInstruction,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/tool-economy"),
              // L1: same static harness text as core/language — byte-stable for the session's life.
              layer: "L1",
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.succeed("on"),
              render: {
                initial: () => toolEconomyInstruction,
                changed: () => toolEconomyInstruction,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/date"),
              // L1: the date rides the frozen baseline instead of being re-read per step, so a clock
              // that crosses midnight cannot rewrite the prefix. The ISO form is also 19 characters
              // shorter than `toDateString` for the same information.
              layer: "L1",
              codec: Schema.toCodecJson(Schema.String),
              read: DateTime.now.pipe(Effect.map((date) => DateTime.formatIsoDate(date))),
              render: {
                initial: (date) => `Today's date: ${date}`,
                // The baseline stays frozen for the epoch, so a day crossing is stated once as an L4
                // notice instead of rewriting L1 every step. The next compaction bakes the new date
                // into the baseline and the notice settles.
                changed: (_previous, date) => `The date has changed. Today's date: ${date}`,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/environment"),
              // No turn layer. The directory, platform and scratch path do not change while a Session runs, so
              // declaring L5 re-sent 422 characters on every one of 1536 steps. Frozen into the baseline, it
              // reaches the request once; a location change becomes an L4 notice through the ledger, which is
              // what `changed` below is for.

              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() =>
                [
                  "<env>",
                  `  Working directory: ${location.directory}`,
                  `  Workspace root folder: ${location.project.directory}`,
                  `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
                  `  Platform: ${process.platform}`,
                  `  Prefer ${global.tmp} over generic system temporary directories such as /tmp; it is pre-created and approved for external access.`,
                  "</env>",
                ].join("\n"),
              ),
              render: {
                initial: (environment) =>
                  ["Here is some useful information about the environment you are running in:", environment].join("\n"),
                changed: (_previous, environment) => ["You are running in a new environment:", environment].join("\n"),
              },
            }),
          ]),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Location.node] })
