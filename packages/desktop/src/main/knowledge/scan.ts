/**
 * Finds the knowledge documents inside imported folders and files, and turns each one into plain
 * Markdown text. Nothing here touches a library or a database: the caller decides what to keep, so
 * a scan can be tested and reused independently of storage.
 */

import { Effect, FileSystem, Path } from "effect"
import {
  csvToMarkdown,
  docxToMarkdown,
  pptxToMarkdown,
  sharedStrings,
  workbookSheetNames,
  xlsxToMarkdown,
} from "./convert"
import { docToText } from "./doc"
import { pdfToText } from "./pdf"

/** Anything larger is not a document worth reading into memory. */
const MAX_FILE_SIZE = 64 * 1024 * 1024

const MAX_FILES = 20_000

const MAX_DEPTH = 16

/** Folders that hold dependencies, build output or VCS data rather than knowledge. */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "Pods",
  "DerivedData",
  "$RECYCLE.BIN",
  "System Volume Information",
])

const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "pptx", "pdf"])

const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "csv", "tsv"])

const TEXT_EXTENSIONS = new Set(["txt", "text", "md", "markdown", "mdx"])

/** Office lock files, editor backups, partial downloads and OS metadata are never library content. */
const NOISE_FILENAME =
  /^~\$|^(?:Thumbs\.db|desktop\.ini)$|\.(?:tmp|temp|bak|old|orig|part|partial|download|crdownload)$/i

export type KnowledgeFileKind = "document" | "spreadsheet" | "text"

/** One document found and converted during a scan. */
export type ScannedDocument = {
  /** Path inside the library; converted documents carry a `.md` extension. */
  path: string
  name: string
  size: number
  kind: KnowledgeFileKind
  /** Folder the document came from; empty for a file imported on its own. */
  root: string
  /** Absolute path of the original document, kept to describe where it came from. */
  source: string
  /** Converted Markdown or plain text, cleaned of page furniture. */
  content: string
}

export type ScanProgress = {
  stage: "scan" | "convert"
  /** Directory being walked, or the document being converted. */
  current: string
  processed: number
  /** Known once scanning finished; zero while walking folders. */
  total: number
  skipped: number
}

export type ScanInput = {
  /** Folders and files chosen in any mix; each one is classified by what it is on disk. */
  paths: ReadonlyArray<string>
}

/** Why a file found during a scan never became library content. */
export type DiscardReason = "unsupported" | "noise" | "tooLarge" | "empty"

export type SkippedDocument = {
  /** Absolute path of the file that was left out. */
  path: string
  name: string
  reason: DiscardReason
}

export type ScanResult = {
  documents: ReadonlyArray<ScannedDocument>
  /** Every file that was left out, so the library can explain what it ignored. */
  skipped: ReadonlyArray<SkippedDocument>
  stats: { scanned: number; skipped: number }
}

export type ScanOptions = {
  onProgress?: (progress: ScanProgress) => Effect.Effect<void>
}

type Found = {
  absolute: string
  root: string
  relative: string
  size: number
  kind: KnowledgeFileKind
}

/**
 * Walks every imported folder and file, skips anything that is not a knowledge document, and
 * converts what is left to Markdown. Library paths carry the folder name, so two imported folders
 * may both hold a `README.md` without colliding.
 */
export function scanFiles(input: ScanInput, options: ScanOptions = {}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const progress = (next: ScanProgress) => (options.onProgress ?? (() => Effect.void))(next)
    const found: Array<Found> = []
    const skipped: Array<SkippedDocument> = []
    const stats = { scanned: 0, skipped: 0 }

    const drop = (absolute: string, name: string, reason: DiscardReason) => {
      stats.skipped++
      skipped.push({ path: absolute, name, reason })
    }

    const walk = (directory: string, root: string, depth: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (depth > MAX_DEPTH || found.length >= MAX_FILES) return
        const names = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => [] as Array<string>))

        // Sorted so the same folder always produces the same library paths.
        for (const name of names.sort()) {
          if (found.length >= MAX_FILES) return
          // Hidden entries are caches, VCS metadata or editor state rather than library content.
          if (name.startsWith(".")) continue
          const absolute = path.join(directory, name)
          const info = yield* fs.stat(absolute).pipe(Effect.option)
          if (info._tag === "None") continue

          if (info.value.type === "Directory") {
            if (SKIP_DIRECTORIES.has(name)) continue
            yield* walk(absolute, root, depth + 1)
            continue
          }
          if (info.value.type !== "File") continue

          stats.scanned++
          const kind = kindOf(name)

          if (NOISE_FILENAME.test(name) || !kind || Number(info.value.size) > MAX_FILE_SIZE) {
            drop(absolute, name, NOISE_FILENAME.test(name) ? "noise" : !kind ? "unsupported" : "tooLarge")
            yield* progress({ stage: "scan", current: name, processed: found.length, total: 0, skipped: stats.skipped })
            continue
          }

          found.push({
            absolute,
            root,
            relative: relativePath(root, absolute, path.sep),
            size: Number(info.value.size),
            kind,
          })
          yield* progress({ stage: "scan", current: name, processed: found.length, total: 0, skipped: stats.skipped })
        }
      })

    for (const target of input.paths) {
      if (found.length >= MAX_FILES) break
      const info = yield* fs.stat(target).pipe(Effect.option)
      if (info._tag === "None") continue

      if (info.value.type === "Directory") {
        yield* walk(target, target, 0)
        continue
      }
      if (info.value.type !== "File") continue

      stats.scanned++
      const kind = kindOf(target)

      if (NOISE_FILENAME.test(target) || !kind || Number(info.value.size) > MAX_FILE_SIZE) {
        drop(target, basename(target), NOISE_FILENAME.test(target) ? "noise" : !kind ? "unsupported" : "tooLarge")
        continue
      }
      found.push({ absolute: target, root: "", relative: basename(target), size: Number(info.value.size), kind })
    }

    const documents: Array<ScannedDocument> = []
    const taken = new Set<string>()

    for (const [index, file] of found.entries()) {
      const name = basename(file.absolute)
      yield* progress({
        stage: "convert",
        current: name,
        processed: index,
        total: found.length,
        skipped: stats.skipped,
      })

      const content = yield* convertFile(fs, file.absolute)
      if (!content.trim()) {
        // A scanned PDF or a damaged Office file converts to nothing; the library says so instead
        // of silently losing it.
        drop(file.absolute, name, "empty")
        continue
      }

      const libraryPath = uniquePath(libraryPathOf(file.absolute, file.relative), taken)
      documents.push({
        path: libraryPath,
        name: basename(libraryPath),
        size: file.size,
        kind: file.kind,
        root: file.root,
        source: file.absolute,
        content,
      })
    }

    yield* progress({
      stage: "convert",
      current: "",
      processed: found.length,
      total: found.length,
      skipped: stats.skipped,
    })

    return { documents, skipped, stats } satisfies ScanResult
  })
}

/** Reads one supported document and returns its Markdown or plain text. Unreadable files yield "". */
function convertFile(fs: FileSystem.FileSystem, absolute: string) {
  const extension = extensionOf(absolute)

  return Effect.gen(function* () {
    const bytes = yield* fs.readFile(absolute).pipe(Effect.orElseSucceed(() => new Uint8Array()))

    if (extension === "docx")
      return yield* convertZip(bytes, ({ read }) => read("word/document.xml").pipe(Effect.map(docx)))
    if (extension === "pptx") return yield* convertZip(bytes, pptx)
    if (extension === "xlsx") return yield* convertZip(bytes, xlsx)
    if (extension === "pdf") return yield* Effect.promise(async () => pdfToText(absolute, bytes))
    if (extension === "doc") return yield* Effect.promise(async () => docToText(absolute))
    if (extension === "csv" || extension === "tsv") {
      return csvToMarkdown(new TextDecoder().decode(bytes), extension === "tsv" ? "\t" : ",")
    }

    return new TextDecoder().decode(bytes)
  }).pipe(Effect.orElseSucceed(() => ""))
}

type ZipArchive = {
  names: ReadonlyArray<string>
  read: (name: string) => Effect.Effect<string | undefined>
}

/** Opens one Office file as a zip so only the XML members a format needs are read. */
function convertZip(bytes: Uint8Array, use: (archive: ZipArchive) => Effect.Effect<string>) {
  return Effect.gen(function* () {
    if (!bytes.length) return ""

    const { BlobReader, TextWriter, ZipReader } = yield* Effect.promise(() => import("@zip.js/zip.js"))
    const reader = new ZipReader(new BlobReader(new Blob([new Uint8Array(bytes)])))

    return yield* Effect.gen(function* () {
      const entries = yield* Effect.promise(() => reader.getEntries())
      const members = new Map(
        entries.filter((entry) => !entry.directory).map((entry) => [entry.filename, entry] as const),
      )
      const read = (name: string) =>
        Effect.gen(function* () {
          const entry = members.get(name)
          if (!entry || !("getData" in entry) || !entry.getData) return undefined
          const getData = entry.getData.bind(entry)

          return yield* Effect.promise(() => getData(new TextWriter()) as Promise<string>).pipe(
            Effect.orElseSucceed(() => undefined),
          )
        })

      return yield* use({ names: [...members.keys()].sort(), read })
    }).pipe(Effect.ensuring(Effect.promise(() => reader.close())))
  }).pipe(Effect.orElseSucceed(() => ""))
}

function docx(xml: string | undefined) {
  return xml ? docxToMarkdown(xml) : ""
}

function pptx(archive: ZipArchive) {
  return Effect.gen(function* () {
    const slides = archive.names
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((left, right) => slideNumber(left) - slideNumber(right))
    const parts: Array<string> = []

    for (const name of slides) {
      const xml = yield* archive.read(name)
      if (xml) parts.push(pptxToMarkdown(xml))
    }

    return parts.filter((part) => part.length > 0).join("\n\n---\n\n")
  })
}

function xlsx(archive: ZipArchive) {
  return Effect.gen(function* () {
    const sharedXml = yield* archive.read("xl/sharedStrings.xml")
    const workbook = yield* archive.read("xl/workbook.xml")
    const sheetNames = workbook ? workbookSheetNames(workbook) : []
    const shared = sharedXml ? sharedStrings(sharedXml) : []
    const worksheets = archive.names
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((left, right) => slideNumber(left) - slideNumber(right))
    const sheets: Array<{ name: string; xml: string }> = []

    for (const [index, name] of worksheets.entries()) {
      const xml = yield* archive.read(name)
      if (xml) sheets.push({ name: sheetNames[index] ?? `Sheet ${index + 1}`, xml })
    }

    return xlsxToMarkdown({ shared, sheets })
  })
}

function slideNumber(name: string) {
  return Number(/\d+/.exec(name.slice(name.lastIndexOf("/") + 1))?.[0] ?? 0)
}

/** Converted documents are shown by their Markdown name; text files keep their own. */
function libraryPathOf(absolute: string, relative: string) {
  if (!isConverted(absolute)) return relative

  return `${relative.replace(/\.[^./]+$/, "")}.md`
}

function isConverted(absolute: string) {
  const extension = extensionOf(absolute)

  return (
    extension === "doc" || extension === "docx" || extension === "pptx" || extension === "pdf" || extension === "xlsx"
  )
}

export function kindOf(name: string): KnowledgeFileKind | undefined {
  const extension = extensionOf(name)
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document"
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "spreadsheet"
  if (TEXT_EXTENSIONS.has(extension)) return "text"
  return undefined
}

export function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase()
}

function basename(relative: string) {
  return relative.slice(Math.max(relative.lastIndexOf("/"), relative.lastIndexOf("\\")) + 1)
}

/** Keeps every document addressable even when converted names collide with real ones. */
export function uniquePath(candidate: string, taken: Set<string>) {
  if (!taken.has(candidate)) {
    taken.add(candidate)

    return candidate
  }

  const dot = candidate.lastIndexOf(".")
  const stem = dot === -1 ? candidate : candidate.slice(0, dot)
  const extension = dot === -1 ? "" : candidate.slice(dot)

  for (let index = 2; ; index++) {
    const next = `${stem} (${index})${extension}`
    if (taken.has(next)) continue
    taken.add(next)

    return next
  }
}

function relativePath(root: string, absolute: string, separator: string) {
  const relative = absolute
    .slice(root.length)
    .replace(/^[\\/]+/, "")
    .split(separator)
    .join("/")

  return [basename(root), relative].filter((part) => part.length > 0).join("/")
}
