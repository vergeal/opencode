import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export const KnowledgeFileKind = Schema.Literals(["document", "spreadsheet", "text"])

export const KnowledgeFileEntry = Schema.Struct({
  /** Path relative to the library root, using forward slashes. */
  path: Schema.String,
  name: Schema.String,
  size: Schema.Number,
  kind: KnowledgeFileKind,
})

/** Lists the readable files under a local directory so the renderer can build a library index. */
export const KnowledgeScanDirectory = Rpc.make("KnowledgeScanDirectory", {
  payload: { path: Schema.String },
  success: Schema.Struct({ files: Schema.Array(KnowledgeFileEntry) }),
})

/** Reads one indexed file as plain text, refusing paths that escape the library root. */
export const KnowledgeReadFile = Rpc.make("KnowledgeReadFile", {
  payload: { root: Schema.String, path: Schema.String },
  success: Schema.Struct({ text: Schema.String }),
})

export const KnowledgeRpcs = RpcGroup.make(KnowledgeScanDirectory, KnowledgeReadFile)
