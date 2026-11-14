import { Knowledge } from "@opencode/core/knowledge"
import { InvalidRequestError } from "@opencode/protocol/errors"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"

// A Project can only search a library the server has a copy of; the desktop app's stale assignment is a bad request.
const missingLibrary = (error: Knowledge.LibraryNotFoundError) =>
  Effect.fail(new InvalidRequestError({ message: error.message, kind: "knowledge" }))

export const KnowledgeHandler = HttpApiBuilder.group(Api, "server.knowledge", (handlers) =>
  handlers
    .handle("knowledge.list", () => Knowledge.Service.use((knowledge) => knowledge.list()))
    .handle("knowledge.sync", (ctx) =>
      Knowledge.Service.use((knowledge) => knowledge.sync(ctx.params.libraryID, ctx.payload)),
    )
    .handle("knowledge.remove", (ctx) =>
      Knowledge.Service.use((knowledge) => knowledge.remove(ctx.params.libraryID)),
    )
    .handle("knowledge.assigned", (ctx) =>
      Knowledge.Service.use((knowledge) => knowledge.assigned(ctx.params.projectID)),
    )
    .handle("knowledge.assign", (ctx) =>
      Knowledge.Service.use((knowledge) =>
        knowledge
          .assign({ projectID: ctx.params.projectID, libraryID: ctx.params.libraryID })
          .pipe(Effect.catchTag("Knowledge.LibraryNotFoundError", missingLibrary)),
      ),
    )
    .handle("knowledge.unassign", (ctx) =>
      Knowledge.Service.use((knowledge) =>
        knowledge
          .unassign({ projectID: ctx.params.projectID, libraryID: ctx.params.libraryID })
          .pipe(Effect.catchTag("Knowledge.LibraryNotFoundError", missingLibrary)),
      ),
    ),
)
