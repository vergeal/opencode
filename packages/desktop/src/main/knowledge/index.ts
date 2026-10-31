export * as DesktopKnowledge from "./index"

import { DatabaseSync } from "node:sqlite"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { KnowledgeDiscard, KnowledgeFileEntry } from "../../shared/ipc-rpc/knowledge"
import { selectNewDocuments, type KnownDocument } from "./dedupe"
import { scanFiles } from "./scan"
import { identify } from "./similarity"

/** Converted text is capped when read back; storage keeps whatever the conversion produced. */
const MAX_READ_LENGTH = 200_000

/** Enough opening text to describe a library without shipping whole documents around. */
const MAX_EXCERPTS = 40

const EXCERPT_LENGTH = 240

export type KnowledgeFileExcerpt = { path: string; excerpt: string }

type FileEntry = Schema.Schema.Type<typeof KnowledgeFileEntry>

type Discard = Schema.Schema.Type<typeof KnowledgeDiscard>

export type ImportProgress = {
  stage: "scan" | "convert" | "dedupe" | "done"
  /** Folder being walked, or the document being read. */
  current: string
  processed: number
  total: number
  kept: number
  duplicates: number
  similar: number
  skipped: number
}

export type ImportRequest = {
  libraryID: string
  /** Folders and files chosen in any mix; they are read, never written to. */
  paths: ReadonlyArray<string>
}

export type Interface = ReturnType<typeof make>

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopKnowledge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const db = openDatabase(path.join(app.getPath("userData"), "knowledge.db"))

    return Service.of(make(fs, path, db))
  }),
)

/**
 * The library owns its content: every imported document is stored as text in this database, so
 * reading a library file never depends on the folder it came from and deleting a library file never
 * touches the original. The table is rebuilt when an older index is found, because that index only
 * pointed at the source folder.
 */
function openDatabase(file: string) {
  const db = new DatabaseSync(file)
  const columns = db
    .prepare("SELECT name FROM pragma_table_info('knowledge_file')")
    .all()
    .map((row) => (row as { name: string }).name)

  if (columns.length > 0 && !columns.includes("hash")) db.exec("DROP TABLE knowledge_file")

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_file (
      library_id TEXT NOT NULL,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL,
      root TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      hash TEXT NOT NULL,
      signature TEXT NOT NULL,
      length INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (library_id, path)
    )
  `)

  return db
}

function make(fs: FileSystem.FileSystem, path: Path.Path, db: DatabaseSync) {
  const insertFile = db.prepare(`
    INSERT OR REPLACE INTO knowledge_file
      (library_id, path, name, size, kind, root, source, content, hash, signature, length, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const deleteFile = db.prepare("DELETE FROM knowledge_file WHERE library_id = ? AND path = ?")
  const selectFile = db.prepare("SELECT content FROM knowledge_file WHERE library_id = ? AND path = ?")
  const selectLibrary = db.prepare("SELECT content FROM knowledge_file WHERE library_id = ? ORDER BY path")
  const selectIdentities = db.prepare("SELECT path, hash, signature, length FROM knowledge_file WHERE library_id = ?")
  const selectEntries = db.prepare(
    "SELECT path, name, size, kind, root, source FROM knowledge_file WHERE library_id = ? ORDER BY path",
  )

  /** Imports run in this process, so a library can report one that outlived the window that started it. */
  const running = new Map<string, ImportProgress>()

  return {
    /**
     * Imports folders and files into a library: documents are converted to Markdown, stored in the
     * library itself, and skipped when the library already holds the same content — exactly or as a
     * near-duplicate of an earlier document. Importing again adds only what is new.
     */
    importPaths: (request: ImportRequest, onProgress?: (progress: ImportProgress) => Effect.Effect<void>) => {
      // Progress is tracked in this process, not only streamed to the window that asked: the user may
      // leave the workspace while the import keeps running and come back to watch it finish.
      const report = (progress: ImportProgress) => {
        running.set(request.libraryID, progress)

        return onProgress ? onProgress(progress) : Effect.void
      }

      return Effect.gen(function* () {
        const stats = { scanned: 0, kept: 0, duplicates: 0, similar: 0, skipped: 0 }
        const known: Array<KnownDocument> = yield* Effect.sync(() =>
          (
            selectIdentities.all(request.libraryID) as Array<{
              path: string
              hash: string
              signature: string
              length: number
            }>
          ).map((row) => ({ path: row.path, hash: row.hash, signature: row.signature, length: Number(row.length) })),
        )

        yield* report({ stage: "scan", current: "", processed: 0, total: 0, ...stats })

        const scanned = yield* scanFiles(request, {
          onProgress: (progress) =>
            report({
              stage: progress.stage === "scan" ? "scan" : "convert",
              current: progress.current,
              processed: progress.processed,
              total: progress.total,
              kept: stats.kept,
              duplicates: stats.duplicates,
              similar: stats.similar,
              skipped: stats.skipped,
            }),
        })

        stats.scanned = scanned.stats.scanned
        stats.skipped = scanned.stats.skipped

        yield* report({
          stage: "dedupe",
          current: "",
          processed: scanned.documents.length,
          total: scanned.documents.length,
          ...stats,
        })

        const selection = selectNewDocuments(scanned.documents, known)
        stats.duplicates = selection.duplicates.length
        stats.similar = selection.similar.length
        stats.kept = selection.kept.length

        // Everything the import left out, with enough detail to explain each decision.
        const discards: Array<Discard> = [
          ...scanned.skipped.map((file) => ({ reason: file.reason, path: file.path, name: file.name })),
          ...selection.duplicates.map((file) => ({
            reason: "duplicate" as const,
            path: file.source,
            name: file.name,
            matched: file.matched,
          })),
          ...selection.similar.map((file) => ({
            reason: "similar" as const,
            path: file.source,
            name: file.name,
            matched: file.matched,
          })),
        ]

        const kept: Array<{ entry: FileEntry; content: string }> = selection.kept.map((document) => ({
          entry: {
            path: document.path,
            name: document.name,
            size: document.size,
            kind: document.kind,
            root: document.root,
            source: document.source,
          },
          content: document.content,
        }))
        const excerpts: Array<KnowledgeFileExcerpt> = kept
          .slice(0, MAX_EXCERPTS)
          .map((file) => ({ path: file.entry.path, excerpt: excerptOf(file.content) }))

        yield* Effect.sync(() => {
          db.exec("BEGIN")

          try {
            const now = Date.now()
            for (const file of kept) {
              const identity = identify(file.content)
              insertFile.run(
                request.libraryID,
                file.entry.path,
                file.entry.name,
                file.entry.size,
                file.entry.kind,
                file.entry.root,
                file.entry.source,
                file.content,
                identity.hash,
                identity.signature,
                identity.length,
                now,
              )
            }
            db.exec("COMMIT")
          } catch (error) {
            db.exec("ROLLBACK")
            throw error
          }
        })

        yield* report({
          stage: "done",
          current: "",
          processed: scanned.documents.length,
          total: scanned.documents.length,
          ...stats,
        })

        return { files: kept.map((file) => file.entry), stats, excerpts, discards }
      }).pipe(Effect.ensuring(Effect.sync(() => running.delete(request.libraryID))))
    },
    /** Reads one stored document. The imported folder is not consulted. */
    read: (libraryID: string, file: string) =>
      Effect.sync(() => {
        const row = selectFile.get(libraryID, file) as { content: string } | undefined

        return { text: row?.content.slice(0, MAX_READ_LENGTH) ?? "" }
      }),
    /** Drops library entries. The imported folder keeps every file it had. */
    deleteFiles: (libraryID: string, paths: ReadonlyArray<string>) =>
      Effect.sync(() => {
        db.exec("BEGIN")

        try {
          for (const file of paths) deleteFile.run(libraryID, file)
          db.exec("COMMIT")
        } catch (error) {
          db.exec("ROLLBACK")
          throw error
        }

        return {}
      }),
    /** Everything a library holds, used to rebuild its index after a restart. */
    list: (libraryID: string) =>
      Effect.sync(() => (selectLibrary.all(libraryID) as Array<{ content: string }>).map((row) => row.content)),
    /** Library entries without their text, so a reopened workspace can show what is already stored. */
    entries: (libraryID: string) => Effect.sync(() => selectEntries.all(libraryID) as Array<FileEntry>),
    /** The import still running for a library, or null once it finished. */
    status: (libraryID: string) =>
      Effect.sync(() => {
        const progress = running.get(libraryID)

        return progress ? { ...progress, libraryID } : null
      }),
  }
}

function excerptOf(text: string) {
  return text
    .replace(/[#>*_`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, EXCERPT_LENGTH)
}
