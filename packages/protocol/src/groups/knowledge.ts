import { Knowledge } from "@opencode/schema/knowledge"
import { Project } from "@opencode/schema/project"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"

const root = "/api/experimental/knowledge"
const EXPERIMENTAL = "Experimental: may change without compatibility guarantees."
const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.knowledge.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    // The routes share the `server.experimental` group with the persistent PTY prototype; tag them on their own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

const libraryParams = { libraryID: Schema.String }
const assignedParams = { projectID: Project.ID, libraryID: Schema.String }

/**
 * The server copy of each knowledge library. The desktop app owns the documents and pushes their text here; indexing
 * and retrieval stay on the server. Reads and writes are Location-scoped so the index session can reuse the
 * Project's model.
 */
export const KnowledgeGroup = HttpApiGroup.make("server.knowledge")
  .add(
    HttpApiEndpoint.get("knowledge.list", root, {
      success: Schema.Array(Knowledge.Info),
    })
      .annotateMerge(
      annotations(
        "list",
        "List knowledge libraries",
        "List every knowledge library this server has a copy of, with its index status and the model that indexed it.",
      ),
    ),
  )
  .add(
    HttpApiEndpoint.put("knowledge.sync", `${root}/:libraryID`, {
      params: libraryParams,
      payload: Knowledge.SyncInput,
      success: Knowledge.Info,
    })
      .annotateMerge(
      annotations(
        "sync",
        "Sync knowledge library",
        "Replace a library's stored documents with the text the desktop app just read. Unchanged content keeps the current index; changed content rebuilds it in the background.",
      ),
    ),
  )
  .add(
    HttpApiEndpoint.delete("knowledge.remove", `${root}/:libraryID`, {
      params: libraryParams,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
      annotations(
        "remove",
        "Remove knowledge library",
        "Delete the server copy of a library, including its documents, chunks, and assignments.",
      ),
    ),
  )
  .add(
    HttpApiEndpoint.get("knowledge.assigned", `${root}/assigned/:projectID`, {
      params: { projectID: Project.ID },
      success: Schema.Array(Knowledge.Info),
    })
      .annotateMerge(
      annotations(
        "assigned",
        "List assigned knowledge libraries",
        "List the knowledge libraries a Project's sessions may search.",
      ),
    ),
  )
  .add(
    HttpApiEndpoint.put("knowledge.assign", `${root}/assigned/:projectID/:libraryID`, {
      params: assignedParams,
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError],
    })
      .annotateMerge(
      annotations(
        "assign",
        "Assign knowledge library",
        "Let a Project search a library. The first assignment indexes the library with the Project's free model.",
      ),
    ),
  )
  .add(
    HttpApiEndpoint.delete("knowledge.unassign", `${root}/assigned/:projectID/:libraryID`, {
      params: assignedParams,
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError],
    })
      .annotateMerge(
      annotations(
        "unassign",
        "Unassign knowledge library",
        "Stop a Project from searching a library. The server copy and its index stay.",
      ),
    ),
  )
