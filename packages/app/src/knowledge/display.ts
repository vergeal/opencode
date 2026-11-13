import type { KnowledgeDiscardReason } from "@/runtime/platform/platform"
import type { KnowledgeFile } from "./store"

export const FILE_ICONS: Record<KnowledgeFile["kind"], string> = {
  document: "file-document",
  spreadsheet: "review",
  text: "outline-text",
}

const DISCARD_GROUPS = ["duplicate", "similar", "ignored"] as const

/** The three reasons a library explains in one list each. */
export type DiscardGroup = (typeof DISCARD_GROUPS)[number]

export { DISCARD_GROUPS }

/** Duplicates and near-duplicates are explained one by one; everything else shares one list. */
export function discardGroup(reason: KnowledgeDiscardReason): DiscardGroup {
  if (reason === "duplicate" || reason === "similar") return reason

  return "ignored"
}

/** The source format a converted document came from, shown as a compact badge. */
export function sourceExtension(file: KnowledgeFile) {
  const dot = file.source.lastIndexOf(".")

  return dot === -1 ? "" : file.source.slice(dot + 1).toUpperCase()
}

/** Documents are stored as Markdown, so the preview can render them as a formatted page instead of plain text. */
export function isMarkdown(path: string | undefined) {
  return !!path && path.toLowerCase().endsWith(".md")
}

/** Converted documents are stored as Markdown, so their library name differs from the original. */
export function isConverted(file: KnowledgeFile) {
  const name = file.name.toLowerCase()
  const source = file.source.toLowerCase()

  return name.endsWith(".md") && !source.endsWith(".md")
}

/** The last folder in a library path: the imported root already names the library. */
export function groupLabel(directory: string) {
  return directory.split("/").filter(Boolean).pop() ?? directory
}
