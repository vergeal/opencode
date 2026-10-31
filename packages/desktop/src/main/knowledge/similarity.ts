/**
 * Content identity. Two files are the same knowledge when their text matches after normalising
 * whitespace, and near-duplicates are caught with a SimHash fingerprint: a rewritten copy, a
 * re-exported document or a different file name still describes the same knowledge.
 */

import { createHash } from "node:crypto"

/** Character shingles work for Chinese, which has no word separators. */
const SHINGLE = 3

/** Fingerprints sampled beyond this many shingles lose detail without changing the verdict. */
const MAX_SHINGLES = 4000

/** Documents shorter than this are compared exactly only: a SimHash of a few shingles is noise. */
const MIN_SIMILAR_LENGTH = 160

/** Bit distance below which two SimHashes are the same knowledge. 64 bits is ~87% agreement. */
const SIMILAR_DISTANCE = 8

/** Documents of very different length are different knowledge even if their wording overlaps. */
const MIN_LENGTH_RATIO = 0.8

const POPCOUNT = Uint8Array.from({ length: 16 }, (_, value) => value.toString(2).replaceAll("0", "").length)

export type ContentIdentity = {
  /** Whitespace-insensitive digest of the text. */
  hash: string
  /** 64-bit SimHash as 16 hex characters. */
  signature: string
  /** Length of the normalised text, used to reject short fingerprints. */
  length: number
}

export function identify(text: string): ContentIdentity {
  const normalized = normalize(text)

  return {
    hash: createHash("sha256")
      .update(normalized.replace(/[^\p{L}\p{N}]/gu, ""))
      .digest("hex"),
    signature: simhash(normalized),
    length: normalized.length,
  }
}

/** True when both identities describe the same passage of knowledge. */
export function sameContent(left: ContentIdentity, right: ContentIdentity) {
  if (left.hash === right.hash) return true
  if (left.length < MIN_SIMILAR_LENGTH || right.length < MIN_SIMILAR_LENGTH) return false

  const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length)
  if (ratio < MIN_LENGTH_RATIO) return false

  return distance(left.signature, right.signature) <= SIMILAR_DISTANCE
}

export function normalize(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u00a0\u3000]+/g, " ")
    .trim()
}

/** Bit distance between two 16-hex SimHash values. */
export function distance(left: string, right: string) {
  let total = 0

  for (let index = 0; index < 16; index++)
    total += POPCOUNT[Number.parseInt(left[index] ?? "0", 16) ^ Number.parseInt(right[index] ?? "0", 16)]

  return total
}

/**
 * SimHash over character shingles of the letters and digits only, so formatting, punctuation and
 * page furniture do not move the fingerprint.
 */
function simhash(text: string) {
  const compact = text.replace(/[^\p{L}\p{N}]/gu, "")
  const vector = new Int32Array(64)
  if (compact.length < SHINGLE) return "0".repeat(16)

  const shingles = compact.length - SHINGLE + 1
  const step = Math.max(1, Math.floor(shingles / MAX_SHINGLES))

  for (let index = 0; index + SHINGLE <= compact.length; index += step) {
    const [first, second] = hash64(compact.slice(index, index + SHINGLE))

    for (let bit = 0; bit < 32; bit++) {
      vector[bit] += ((first >>> bit) & 1) === 1 ? 1 : -1
      vector[bit + 32] += ((second >>> bit) & 1) === 1 ? 1 : -1
    }
  }

  return [0, 1]
    .map((word) => {
      let value = 0
      for (let bit = 0; bit < 32; bit++) if (vector[word * 32 + bit]! > 0) value |= 1 << bit

      return (value >>> 0).toString(16).padStart(8, "0")
    })
    .join("")
}

/** Two independent 32-bit FNV-1a passes make a cheap 64-bit shingle hash. */
function hash64(value: string) {
  let first = 0x811c9dc5
  let second = 0x01000193

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193) >>> 0
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
  }

  return [first >>> 0, second >>> 0] as const
}
