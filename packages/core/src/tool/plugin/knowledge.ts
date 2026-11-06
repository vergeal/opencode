export * as KnowledgeTools from "./knowledge.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Knowledge } from "@opencode/schema/knowledge"
import { Effect, Schema } from "effect"
import { Knowledge as KnowledgeService } from "../../knowledge.js"

const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "What to look up in the project's knowledge libraries" }),
  limit: Schema.Number.pipe(Schema.optional).annotate({ description: "Maximum passages to return, 1-20. Defaults to 6." }),
})

const Output = Schema.Struct({
  hits: Schema.Array(Knowledge.SearchHit),
})

/**
 * Only the hidden knowledge agent may retrieve. Every other agent denies this action by default, so the tool is not
 * even listed for a main session: knowledge passages never reach the main conversation's context by accident.
 */
export const Plugin = {
  id: "opencode.tool.knowledge",
  effect: Effect.fn("KnowledgeTools.Plugin")(function* (ctx: Context) {
    const knowledge = yield* KnowledgeService.Service

    yield* ctx.tool.transform((editor) => {
      editor.add({
        name: "knowledge_search",
        description:
          "Search the knowledge libraries assigned to this Project and return the best matching passages with their document paths. Use it to ground an answer in project knowledge.",
        input: Input,
        output: Output,
        options: { namespace: "opencode", codemode: false },
        execute: (input, context) =>
          Effect.gen(function* () {
            if (context.agent !== "knowledge")
              return yield* new ToolFailure({ message: "knowledge_search is only available to the knowledge agent" })
            const hits = yield* knowledge.search({
              projectID: ctx.location.project.id,
              query: input.query,
              limit: input.limit,
            })
            return {
              output: { hits },
              content:
                hits.length === 0
                  ? "No matching knowledge passages."
                  : hits
                      .map(
                        (hit) =>
                          `[${hit.libraryName}] ${hit.path} (part ${hit.ordinal + 1})\n${hit.text}`,
                      )
                      .join("\n\n"),
            }
          }),
      })
    })
  }),
}
