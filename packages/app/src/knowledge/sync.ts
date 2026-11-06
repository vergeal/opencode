import type { Platform } from "@/runtime/platform/platform"
import type { ServerApi } from "@/runtime/server/api"
import type { KnowledgeLibrary } from "./store"

/**
 * The desktop app owns a library's documents, so the server can only index text the app reads and
 * uploads. One call replaces the server copy; unchanged hashes keep the existing index.
 */
export async function syncKnowledgeLibrary(input: {
  api: ServerApi
  platform: Platform
  library: KnowledgeLibrary
}) {
  const read = input.platform.readKnowledgeFile

  if (!read) throw new Error("Synchronizing a knowledge library needs the desktop app")

  const documents = []

  // Reading through IPC one file at a time keeps a large library from stalling the main process.
  for (const file of input.library.files) {
    const { text } = await read({ libraryID: input.library.id, path: file.path })
    documents.push({ path: file.path, name: file.name, kind: file.kind, size: file.size, text })
  }

  return input.api.experimental["server.knowledge"].sync({
    libraryID: input.library.id,
    name: input.library.name,
    description: input.library.description,
    documents,
  })
}

/** True when this server already keeps a copy, so page actions only refresh libraries already linked. */
export async function isKnowledgeLibraryOnServer(api: ServerApi, libraryID: string) {
  const libraries = await api.experimental["server.knowledge"].list()

  return libraries.some((library) => library.id === libraryID)
}

export async function removeKnowledgeLibraryFromServer(api: ServerApi, libraryID: string) {
  await api.experimental["server.knowledge"].remove({ libraryID })
}
