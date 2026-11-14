import type { Platform } from "@/runtime/platform/platform"
import type { ServerApi } from "@/runtime/server/api"
import type { KnowledgeLibrary } from "./store"
import { syncKnowledgeLibrary } from "./sync"

/**
 * The server can only search a library whose text it already holds, so linking uploads the local
 * copy before assigning it to the project. A library without its text is not worth searching: either
 * step failing leaves nothing linked, and the original error reaches the caller.
 */
export async function linkKnowledgeLibrary(input: {
  api: ServerApi
  platform: Platform
  library: KnowledgeLibrary
  projectID: string
}) {
  const knowledge = input.api.experimental["server.knowledge"]
  const rollback = () =>
    knowledge.unassign({ projectID: input.projectID, libraryID: input.library.id }).catch(() => undefined)

  try {
    await syncKnowledgeLibrary({ api: input.api, platform: input.platform, library: input.library })
    await knowledge.assign({ projectID: input.projectID, libraryID: input.library.id })
  } catch (error) {
    await rollback()
    throw error
  }
}
