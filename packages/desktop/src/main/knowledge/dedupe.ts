/**
 * Decides which scanned documents a library should take. A document is skipped when the library
 * already holds the same content, exactly or as a near-duplicate, so importing the same folder
 * twice adds nothing and a re-exported copy of an existing document does not duplicate it.
 */

import type { ScannedDocument } from "./scan"
import { identify, sameContent, type ContentIdentity } from "./similarity"

export type KnownDocument = ContentIdentity & { path: string }

export type RejectedDocument = {
  /** Library path the document would have taken. */
  path: string
  /** Absolute path of the original file. */
  source: string
  name: string
  /** Library path of the document whose content it matched. */
  matched: string
}

export type Selection = {
  kept: ReadonlyArray<ScannedDocument>
  duplicates: ReadonlyArray<RejectedDocument>
  similar: ReadonlyArray<RejectedDocument>
}

export function selectNewDocuments(
  documents: ReadonlyArray<ScannedDocument>,
  known: ReadonlyArray<KnownDocument>,
): Selection {
  const seen: Array<KnownDocument> = [...known]
  const kept: Array<ScannedDocument> = []
  const duplicates: Array<RejectedDocument> = []
  const similar: Array<RejectedDocument> = []

  for (const document of documents) {
    const identity = identify(document.content)
    const duplicate = seen.find((entry) => entry.hash === identity.hash)
    const near = duplicate ?? seen.find((entry) => sameContent(entry, identity))

    if (near) {
      const rejected = { path: document.path, source: document.source, name: document.name, matched: near.path }
      if (duplicate) duplicates.push(rejected)
      else similar.push(rejected)
      continue
    }

    seen.push({ ...identity, path: document.path })
    kept.push(document)
  }

  return { kept, duplicates, similar }
}
