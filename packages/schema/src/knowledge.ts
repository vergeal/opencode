export * as Knowledge from "./knowledge.js"

import { Schema } from "effect"
import { DateTimeUtcFromMillis, NonNegativeInt, optional } from "./schema.js"
import { ProjectID } from "./project-id.js"

/** A library the server can search. `stale` means the documents changed since the last index. */
export const Status = Schema.Literals(["empty", "indexing", "ready", "stale", "failed"]).annotate({
  identifier: "Knowledge.Status",
})
export type Status = typeof Status.Type

export const DocumentKind = Schema.Literals(["document", "spreadsheet", "text"]).annotate({
  identifier: "Knowledge.DocumentKind",
})
export type DocumentKind = typeof DocumentKind.Type

/** One file the desktop app read for the library. `text` is the converted Markdown body. */
export const Document = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  kind: DocumentKind,
  size: NonNegativeInt,
  text: Schema.String,
}).annotate({ identifier: "Knowledge.Document" })
export type Document = typeof Document.Type

export const Info = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String.pipe(optional),
  /** Model-written retrieval summary; absent until an index run succeeds. */
  summary: Schema.String.pipe(optional),
  keywords: Schema.Array(Schema.String),
  status: Status,
  /** The model that wrote the summary, when one was available. */
  model: Schema.String.pipe(optional),
  documentCount: NonNegativeInt,
  chunkCount: NonNegativeInt,
  indexedAt: DateTimeUtcFromMillis.pipe(optional),
  time: Schema.Struct({ created: DateTimeUtcFromMillis, updated: DateTimeUtcFromMillis }),
}).annotate({ identifier: "Knowledge.Info" })
export type Info = typeof Info.Type

export const SyncInput = Schema.Struct({
  name: Schema.String,
  description: Schema.String.pipe(optional),
  documents: Schema.Array(Document),
}).annotate({ identifier: "Knowledge.SyncInput" })
export type SyncInput = typeof SyncInput.Type

export const SearchInput = Schema.Struct({
  query: Schema.String,
  limit: Schema.Number.pipe(optional),
}).annotate({ identifier: "Knowledge.SearchInput" })
export type SearchInput = typeof SearchInput.Type

export const SearchHit = Schema.Struct({
  libraryID: Schema.String,
  libraryName: Schema.String,
  path: Schema.String,
  name: Schema.String,
  ordinal: NonNegativeInt,
  text: Schema.String,
  score: Schema.Number,
}).annotate({ identifier: "Knowledge.SearchHit" })
export type SearchHit = typeof SearchHit.Type

export const Assigned = Schema.Struct({
  projectID: ProjectID,
  libraryID: Schema.String,
  time: DateTimeUtcFromMillis,
}).annotate({ identifier: "Knowledge.Assigned" })
export type Assigned = typeof Assigned.Type
