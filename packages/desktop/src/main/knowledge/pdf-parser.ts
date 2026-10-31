/**
 * Portable PDF text extraction. The document is read as raw objects: every stream is inflated and
 * the text operators inside are decoded through the document's ToUnicode CMaps, which is what turns
 * embedded CID codes back into readable Chinese and Latin text.
 *
 * This is a plain parser rather than a full PDF implementation, used where the platform has no
 * native PDF text layer (macOS uses PDFKit through `pdf.ts`). It returns "" for anything it cannot
 * decode, so the caller skips the file instead of storing mojibake.
 */

import { inflateSync } from "node:zlib"

const MAX_TEXT = 200_000

/** Below this share of readable characters a PDF is treated as undecodable. */
const MIN_READABLE = 0.6

export function parsePdfText(bytes: Uint8Array) {
  const source = Buffer.from(bytes).toString("latin1")
  const objects = readObjects(source)
  const streams = objects.flatMap((object) => (object.stream ? [decodeStream(object)] : [])).filter(Boolean)
  const cmap = buildCMap(streams)
  const parts: Array<string> = []

  for (const stream of streams) {
    // Only pages carry text operators; fonts, images and metadata streams never do.
    if (!/\bT[jJ]\b/.test(stream)) continue
    const text = extractText(stream, cmap)
    if (text) parts.push(text)
  }

  const cleaned = cleanText(parts.join("\n\n"))
  if (!cleaned || readableShare(cleaned) < MIN_READABLE) return ""

  return cleaned.slice(0, MAX_TEXT)
}

type PdfObject = { dict: string; stream?: Uint8Array }

function readObjects(source: string) {
  const objects: Array<PdfObject> = []
  const pattern = /(\d+)\s+\d+\s+obj\b/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source))) {
    const start = match.index + match[0].length
    const end = source.indexOf("endobj", start)
    if (end === -1) continue
    const body = source.slice(start, end)
    const streamAt = body.indexOf("stream")

    if (streamAt === -1) {
      objects.push({ dict: body })
      continue
    }

    let dataStart = streamAt + "stream".length
    // A stream's data starts after the end-of-line that follows the `stream` keyword.
    if (body[dataStart] === "\r") dataStart++
    if (body[dataStart] === "\n") dataStart++
    const dataEnd = body.lastIndexOf("endstream")
    const raw = Buffer.from(body.slice(dataStart, dataEnd === -1 ? body.length : dataEnd), "latin1")

    objects.push({ dict: body.slice(0, streamAt), stream: new Uint8Array(raw) })
  }

  return objects
}

/** Inflates a Flate-compressed stream; other filters are left unread. */
function decodeStream(object: PdfObject) {
  const filter = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(object.dict)?.[1] ?? ""
  if (!/FlateDecode/.test(filter)) return ""

  try {
    return inflateSync(object.stream!).toString("latin1")
  } catch {
    return ""
  }
}

/**
 * Collects every ToUnicode CMap in the document into one table. Documents from one source share a
 * CID encoding, so a single table reads the whole file; conflicting definitions keep the first.
 */
function buildCMap(streams: ReadonlyArray<string>) {
  const map = new Map<number, string>()

  for (const stream of streams) {
    if (!stream.includes("beginbfchar") && !stream.includes("beginbfrange")) continue

    for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        const code = Number.parseInt(pair[1]!, 16)
        if (!map.has(code)) map.set(code, unicodeOf(pair[2]!))
      }
    }

    for (const block of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const range of block[1]!.matchAll(
        /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g,
      )) {
        const start = Number.parseInt(range[1]!, 16)
        const end = Number.parseInt(range[2]!, 16)
        if (end < start || end - start > 0xffff) continue

        if (range[3]) {
          const base = Number.parseInt(range[3], 16)
          for (let code = start; code <= end; code++) {
            if (!map.has(code)) map.set(code, String.fromCodePoint(base + code - start))
          }
          continue
        }

        const values = [...range[4]!.matchAll(/<([0-9a-fA-F]+)>/g)]
        for (const [index, value] of values.entries()) {
          if (!map.has(start + index)) map.set(start + index, unicodeOf(value[1]!))
        }
      }
    }
  }

  return map
}

/** Reads text show operators out of one content stream. */
function extractText(content: string, cmap: Map<number, string>) {
  const wide = usesWideCodes(cmap)
  const tokens = content.matchAll(
    /\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|\bBT\b|\bET\b|\bTd\b|\bTD\b|\bT\*\b|\bTj\b|\bTJ\b|'|"|-?\d+(?:\.\d+)?/g,
  )
  let text = ""
  let bytes: Array<number> = []
  let inArray = false

  for (const token of tokens) {
    const value = token[0]

    if (value.startsWith("(")) {
      bytes.push(...literalBytes(value))
      continue
    }
    if (value.startsWith("<") && !value.startsWith("<<")) {
      bytes.push(...hexBytes(value))
      continue
    }
    if (value === "[") {
      inArray = true
      continue
    }
    if (value === "]") {
      inArray = false
      continue
    }
    if (value === "Tj" || value === "'" || value === '"') {
      text += decodeBytes(bytes, cmap, wide)
      if (value !== "Tj") text += "\n"
      bytes = []
      continue
    }
    if (value === "TJ") {
      text += decodeBytes(bytes, cmap, wide)
      bytes = []
      continue
    }
    if (value === "Td" || value === "TD" || value === "T*" || value === "ET") {
      text += "\n"
      continue
    }
    // A large negative adjustment inside a TJ array is where a word space belongs.
    if (inArray && value.startsWith("-") && Number(value) <= -100) bytes.push(0x20)
  }

  return collapseLines(text)
}

function usesWideCodes(cmap: Map<number, string>) {
  if (cmap.size === 0) return false

  let wide = 0
  for (const code of cmap.keys()) if (code > 0xff) wide++

  return wide * 2 > cmap.size
}

function decodeBytes(bytes: ReadonlyArray<number>, cmap: Map<number, string>, wide: boolean) {
  if (!bytes.length) return ""

  if (!wide) {
    return bytes
      .map((byte) => cmap.get(byte) ?? (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ""))
      .join("")
  }

  let text = ""
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = (bytes[index]! << 8) | bytes[index + 1]!
    text += cmap.get(code) ?? ""
  }

  return text
}

/** Parses a literal string token, resolving its PDF escapes. */
function literalBytes(token: string) {
  const body = token.slice(1, -1)
  const bytes: Array<number> = []

  for (let index = 0; index < body.length; index++) {
    const character = body[index]!
    if (character !== "\\") {
      bytes.push(body.charCodeAt(index) & 0xff)
      continue
    }

    const next = body[++index]
    if (next === undefined) break
    if (next === "\n") continue
    if (next === "\r") {
      if (body[index + 1] === "\n") index++
      continue
    }
    if (/[0-7]/.test(next)) {
      let octal = next
      while (octal.length < 3 && /[0-7]/.test(body[index + 1] ?? "")) octal += body[++index]
      bytes.push(Number.parseInt(octal, 8) & 0xff)
      continue
    }
    const escaped: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 }
    bytes.push(escaped[next] ?? next.charCodeAt(0) & 0xff)
  }

  return bytes
}

function hexBytes(token: string) {
  const digits = token.slice(1, -1).replace(/\s+/g, "")
  const bytes: Array<number> = []

  for (let index = 0; index + 1 < digits.length; index += 2)
    bytes.push(Number.parseInt(digits.slice(index, index + 2), 16))

  return bytes
}

function unicodeOf(hex: string) {
  let text = ""

  for (let index = 0; index + 4 <= hex.length; index += 4) {
    const code = Number.parseInt(hex.slice(index, index + 4), 16)
    if (code > 0) text += String.fromCharCode(code)
  }

  return text
}

function collapseLines(text: string) {
  return text
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || lines[index - 1]?.length)
    .join("\n")
}

function cleanText(text: string) {
  return text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Share of characters that look like intended text rather than undecoded glyph codes. */
function readableShare(text: string) {
  const characters = [...text.replace(/\s+/g, "")]
  if (!characters.length) return 0

  const readable = characters.filter((character) => /[\p{L}\p{N}\p{P}\p{Sc}]/u.test(character)).length

  return readable / characters.length
}
