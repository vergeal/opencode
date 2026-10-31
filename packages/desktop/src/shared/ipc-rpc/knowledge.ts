import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export const KnowledgeFileKind = Schema.Literals(["document", "spreadsheet", "text"])

export const KnowledgeFileEntry = Schema.Struct({
  /** Path inside the library. Converted documents carry a `.md` name. */
  path: Schema.String,
  name: Schema.String,
  size: Schema.Number,
  kind: KnowledgeFileKind,
  /** Folder the document was imported from; empty for a file imported on its own. */
  root: Schema.String,
  /** Absolute path of the original document, kept to show where it came from. */
  source: Schema.String,
})

/** What one import looked at, kept and dropped. */
export const KnowledgeImportStats = Schema.Struct({
  scanned: Schema.Number,
  kept: Schema.Number,
  /** Files whose content already existed in the library. */
  duplicates: Schema.Number,
  /** Files whose content nearly matched an existing document. */
  similar: Schema.Number,
  /** Non-documents, empty files and documents whose text could not be read. */
  skipped: Schema.Number,
})

/** Why one file was left out of a library. */
export const KnowledgeDiscardReason = Schema.Literals([
  "duplicate",
  "similar",
  "unsupported",
  "noise",
  "tooLarge",
  "empty",
])

/** One file an import left out, with enough detail to explain the decision. */
export const KnowledgeDiscard = Schema.Struct({
  reason: KnowledgeDiscardReason,
  /** Absolute path of the original file, or the library path for a duplicate. */
  path: Schema.String,
  name: Schema.String,
  /** Library path of the document this one duplicated or nearly matched. */
  matched: Schema.optional(Schema.String),
})

/** Opening text of one kept document, used to describe the library without reading every file. */
export const KnowledgeFileExcerpt = Schema.Struct({
  path: Schema.String,
  excerpt: Schema.String,
})

/** Opens one picker that accepts both files and folders, several at a time. */
export const KnowledgePickSources = Rpc.make("KnowledgePickSources", {
  success: Schema.Struct({ paths: Schema.Array(Schema.String) }),
})

/** Imports folders and files, keeping only knowledge documents the library does not already hold. */
export const KnowledgeImportPaths = Rpc.make("KnowledgeImportPaths", {
  payload: { libraryID: Schema.String, paths: Schema.Array(Schema.String) },
  success: Schema.Struct({
    files: Schema.Array(KnowledgeFileEntry),
    stats: KnowledgeImportStats,
    excerpts: Schema.Array(KnowledgeFileExcerpt),
    discards: Schema.Array(KnowledgeDiscard),
  }),
})

/** Reads one stored file. Library content lives in desktop storage, not in the imported folder. */
export const KnowledgeReadFile = Rpc.make("KnowledgeReadFile", {
  payload: { libraryID: Schema.String, path: Schema.String },
  success: Schema.Struct({ text: Schema.String }),
})

/** Drops files from a library. The imported folder is never touched. */
export const KnowledgeDeleteFiles = Rpc.make("KnowledgeDeleteFiles", {
  payload: { libraryID: Schema.String, paths: Schema.Array(Schema.String) },
  success: Schema.Struct({}),
})

export const KnowledgeRpcs = RpcGroup.make(
  KnowledgePickSources,
  KnowledgeImportPaths,
  KnowledgeReadFile,
  KnowledgeDeleteFiles,
)
