import type {
  KnowledgeDiscard,
  KnowledgeFileEntry,
  KnowledgeImportStats,
  KnowledgeFileExcerpt,
  Platform,
} from "@/runtime/platform/platform"
import type { KnowledgeFile } from "./store"

const EMPTY_STATS: KnowledgeImportStats = { scanned: 0, kept: 0, duplicates: 0, similar: 0, skipped: 0 }

/**
 * Opens the desktop picker, which accepts folders and files in one panel and several at a time.
 * The web build has no filesystem access, so it returns nothing and the UI explains why.
 */
export async function pickKnowledgeSources(platform: Platform) {
  const picked = await platform.pickKnowledgeSources?.()

  return picked?.paths ?? []
}

/**
 * Hands the chosen paths to the desktop main process. The library keeps its own copy of the
 * converted text: the folders are only read, never written to, and content already present is
 * skipped. The main process decides which paths are folders and which are files.
 */
export async function importKnowledge(input: {
  platform: Platform
  libraryID: string
  paths: ReadonlyArray<string>
}): Promise<
  | {
      files: KnowledgeFile[]
      stats: KnowledgeImportStats
      excerpts: ReadonlyArray<KnowledgeFileExcerpt>
      discards: ReadonlyArray<KnowledgeDiscard>
    }
  | undefined
> {
  if (input.platform.platform !== "desktop") return undefined

  const imported = await input.platform.importKnowledgePaths?.({
    libraryID: input.libraryID,
    paths: [...input.paths],
  })
  if (!imported) return undefined

  return {
    files: imported.files.map(toFile),
    stats: imported.stats ?? EMPTY_STATS,
    excerpts: imported.excerpts,
    discards: imported.discards ?? [],
  }
}

function toFile(entry: KnowledgeFileEntry): KnowledgeFile {
  return {
    path: entry.path,
    name: entry.name,
    size: entry.size,
    kind: entry.kind,
    root: entry.root,
    source: entry.source,
  }
}
