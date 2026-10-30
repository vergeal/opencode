export * as DesktopKnowledge from "./index"

import { Context, Effect, FileSystem, Layer, Path } from "effect"

/** Files larger than this are indexed but only the head of their text is returned. */
const MAX_TEXT_LENGTH = 200_000

const MAX_FILES = 5_000

const MAX_DEPTH = 12

// Directories that hold dependencies, build output or VCS data: scanning them would only add noise.
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
])

const DOCUMENT_EXTENSIONS = new Set(["docx"])

const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "csv", "tsv"])

const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "mdx",
  "json",
  "jsonc",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "properties",
  "log",
  "html",
  "htm",
  "xml",
  "svg",
  "css",
  "scss",
  "less",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "gradle",
  "dockerfile",
  "makefile",
])

export type KnowledgeFileKind = "document" | "spreadsheet" | "text"

export type KnowledgeFileEntry = {
  path: string
  name: string
  size: number
  kind: KnowledgeFileKind
}

export type Interface = ReturnType<typeof make>

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopKnowledge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    return Service.of(make(fs, path))
  }),
)

function make(fs: FileSystem.FileSystem, path: Path.Path) {
  return {
    scan: Effect.fn("DesktopKnowledge.scan")(function* (root: string) {
      const files: KnowledgeFileEntry[] = []
      const walk = (directory: string, depth: number): Effect.Effect<void> =>
        Effect.gen(function* () {
          if (depth > MAX_DEPTH || files.length >= MAX_FILES) return
          const names = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => [] as Array<string>))

          // Sorted so the same directory always produces the same index.
          for (const name of names.sort()) {
            if (files.length >= MAX_FILES) return
            // Hidden entries are caches, VCS metadata or editor state rather than library content.
            if (name.startsWith(".")) continue
            const absolute = path.join(directory, name)
            const info = yield* fs.stat(absolute).pipe(Effect.option)
            if (info._tag === "None") continue
            if (info.value.type === "Directory") {
              if (SKIP_DIRECTORIES.has(name)) continue
              yield* walk(absolute, depth + 1)
              continue
            }
            if (info.value.type !== "File") continue
            const kind = kindOf(name)
            if (!kind) continue
            files.push({
              path: relativePath(root, absolute, path.sep),
              name,
              size: Number(info.value.size),
              kind,
            })
          }
        })

      yield* walk(root, 0)

      return { files }
    }),
    read: Effect.fn("DesktopKnowledge.read")(function* (root: string, relative: string) {
      const absolute = path.resolve(root, relative)
      if (!inside(root, absolute, path.sep)) return { text: "" }
      const extension = path.extname(absolute).toLowerCase()
      if (extension === ".docx") return { text: yield* readDocx(fs, absolute) }
      if (extension === ".xlsx") return { text: yield* readXlsx(fs, absolute) }
      const bytes = yield* fs.readFile(absolute)

      return { text: new TextDecoder().decode(bytes).slice(0, MAX_TEXT_LENGTH) }
    }),
  }
}

function kindOf(name: string): KnowledgeFileKind | undefined {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document"
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "spreadsheet"
  if (TEXT_EXTENSIONS.has(extension)) return "text"
  return undefined
}

function relativePath(root: string, absolute: string, separator: string) {
  return absolute
    .slice(root.length)
    .replace(/^[\\/]+/, "")
    .split(separator)
    .join("/")
}

function inside(root: string, absolute: string, separator: string) {
  if (absolute === root) return true
  return absolute.startsWith(root.endsWith(separator) ? root : `${root}${separator}`)
}

/**
 * Opens one Office file as a zip and hands its entries to `use`. docx and xlsx are both
 * zip archives, so the parser only needs to read the XML members by name.
 */
function withZip<A>(
  fs: FileSystem.FileSystem,
  file: string,
  use: (archive: {
    names: ReadonlyArray<string>
    read: (name: string) => Effect.Effect<string | undefined>
  }) => Effect.Effect<A>,
) {
  return Effect.gen(function* () {
    const { BlobReader, TextWriter, ZipReader } = yield* Effect.promise(() => import("@zip.js/zip.js"))
    const bytes = yield* fs.readFile(file)
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

      return yield* use({ names: [...members.keys()], read })
    }).pipe(Effect.ensuring(Effect.promise(() => reader.close())))
  })
}

function readDocx(fs: FileSystem.FileSystem, file: string) {
  return withZip(fs, file, ({ read }) =>
    Effect.gen(function* () {
      const xml = yield* read("word/document.xml")
      if (!xml) return ""
      return xml
        .split("</w:p>")
        .map((paragraph) => collectTag(paragraph, "w:t"))
        .filter((line) => line.trim().length > 0)
        .join("\n")
        .slice(0, MAX_TEXT_LENGTH)
    }),
  )
}

function readXlsx(fs: FileSystem.FileSystem, file: string) {
  return withZip(fs, file, ({ names, read }) =>
    Effect.gen(function* () {
      const sharedXml = yield* read("xl/sharedStrings.xml")
      const shared = sharedXml
        ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => collectTag(match[1]!, "t"))
        : []
      const workbook = yield* read("xl/workbook.xml")
      const sheetNames = workbook
        ? [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXml(match[1]!))
        : []
      const worksheets = names
        .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
        .sort((a, b) => sheetNumber(a) - sheetNumber(b))
      const sections: Array<string> = []

      for (const [index, name] of worksheets.entries()) {
        const xml = yield* read(name)
        if (!xml) continue
        const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
          [...row[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
            .map((cell) => cellValue(cell[1]!, cell[2]!, shared))
            .join("\t"),
        )
        sections.push(`# ${sheetNames[index] ?? `Sheet ${index + 1}`}\n${rows.join("\n")}`)
      }

      return sections.join("\n\n").slice(0, MAX_TEXT_LENGTH)
    }),
  )
}

function sheetNumber(name: string) {
  return Number(/\d+/.exec(name)?.[0] ?? 0)
}

function cellValue(attributes: string, body: string, shared: ReadonlyArray<string>) {
  const type = /\bt="([^"]*)"/.exec(attributes)?.[1]
  if (type === "inlineStr") return collectTag(body, "t")
  const value = collectTag(body, "v")
  if (type === "s") return shared[Number(value)] ?? ""
  return value
}

function collectTag(xml: string, tag: string) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g")

  return decodeXml([...xml.matchAll(pattern)].map((match) => match[1]!).join(""))
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

function decodeXml(value: string) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return XML_ENTITIES[body] ?? entity
  })
}
