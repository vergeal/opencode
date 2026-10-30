import { Effect } from "effect"
import { KnowledgeRpcs } from "../../shared/ipc-rpc"
import { DesktopKnowledge } from "../knowledge"

export const knowledgeHandlers = KnowledgeRpcs.toLayer(
  Effect.gen(function* () {
    const knowledge = yield* DesktopKnowledge.Service

    return KnowledgeRpcs.of({
      KnowledgeScanDirectory: ({ path }) => knowledge.scan(path).pipe(Effect.orDie),
      KnowledgeReadFile: ({ root, path }) => knowledge.read(root, path).pipe(Effect.orDie),
    })
  }),
)
