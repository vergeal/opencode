/**
 * Office-to-Markdown conversion. Everything here is pure: the caller unzips the file and hands over
 * the XML members, so conversion stays independent of Electron and the file system.
 */

const MAX_TEXT_LENGTH = 200_000

/** Bigger inputs are read only far enough to produce a bounded excerpt and fingerprint. */
const MAX_SOURCE_LENGTH = 2_000_000

/** Converts a Word document to Markdown: headings, list items and tables survive, page noise does not. */
export function docxToMarkdown(xml: string) {
  const blocks: Array<string> = []
  // Tables come first so their paragraphs are not emitted as loose text.
  for (const match of xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const block = match[0]
    if (block.startsWith("<w:tbl")) {
      const table = rowsToMarkdown(docxTableRows(block))
      if (table) blocks.push(table)
      continue
    }

    const line = docxParagraph(block)
    if (line) blocks.push(line)
  }

  return cleanMarkdown(blocks.join("\n\n"))
}

function docxParagraph(xml: string) {
  const text = paragraphText(xml)
  if (!text) return undefined

  const style = /<w:pStyle\b[^>]*\bw:val="([^"]*)"/.exec(xml)?.[1] ?? ""
  // A table of contents repeats what the headings below already say.
  if (/^(?:toc|目录)/i.test(style)) return undefined
  const outline = Number(/<w:outlineLvl\b[^>]*\bw:val="(\d+)"/.exec(xml)?.[1] ?? Number.NaN)
  const heading = headingLevel(style, outline)
  if (heading) return `${"#".repeat(heading)} ${text}`
  // `w:numPr` marks a numbered or bulleted paragraph; the exact marker is not worth preserving.
  if (/<w:numPr\b/.test(xml)) return `- ${text}`

  return text
}

function headingLevel(style: string, outline: number) {
  const numbered = /^(?:heading|标题|제목|見出し)?\s*([1-6])$/i.exec(style)
  if (numbered) return Number(numbered[1])
  if (/^(?:title|标题|제목|タイトル)$/i.test(style)) return 1
  if (!Number.isNaN(outline) && outline < 6) return outline + 1

  return undefined
}

function paragraphText(xml: string) {
  const inline = xml
    // Field codes hold instructions such as PAGE and NUMPAGES, never document text.
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:br\b[^>]*\/>|<w:br\b[^>]*><\/w:br>/g, "<w:t>\n</w:t>")
    .replace(/<w:tab\b[^>]*\/>/g, "<w:t> </w:t>")

  return collectTag(inline, "w:t")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
}

function docxTableRows(xml: string) {
  return [...xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((row) =>
    [...row[1]!.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((cell) =>
      // A cell may hold several paragraphs; one line keeps the table readable.
      [...cell[1]!.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)]
        .map((paragraph) => paragraphText(paragraph[0]))
        .filter((text) => text.length > 0)
        .join(" "),
    ),
  )
}

/** Converts one slide's XML to Markdown: every paragraph becomes a line, tables keep their cells. */
export function pptxToMarkdown(xml: string) {
  const blocks: Array<string> = []

  for (const match of xml.matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>|<a:p\b[\s\S]*?<\/a:p>/g)) {
    const block = match[0]
    if (block.startsWith("<a:tbl")) {
      const rows = [...block.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((row) =>
        [...row[1]!.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((cell) => collectTag(cell[1]!, "a:t").trim()),
      )
      const table = rowsToMarkdown(rows)
      if (table) blocks.push(table)
      continue
    }

    const text = collectTag(block, "a:t").replace(/\s+/g, " ").trim()
    if (!text) continue
    // A slide title is the first paragraph in its placeholder; Markdown headings only help readers.
    blocks.push(text)
  }

  return cleanMarkdown(blocks.join("\n\n"))
}

export function sharedStrings(xml: string) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => collectTag(match[1]!, "t"))
}

export function workbookSheetNames(xml: string) {
  return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXml(match[1]!))
}

/** Converts every worksheet to a Markdown table, keeping cell addresses so columns do not shift. */
export function xlsxToMarkdown(input: {
  sheets: ReadonlyArray<{ name: string; xml: string }>
  shared: ReadonlyArray<string>
}) {
  const sections = input.sheets.flatMap((sheet) => {
    const table = rowsToMarkdown(sheetRows(sheet.xml, input.shared))

    return table ? [`# ${sheet.name}\n\n${table}`] : []
  })

  return cleanMarkdown(sections.join("\n\n"))
}

function sheetRows(xml: string, shared: ReadonlyArray<string>) {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = [...row[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)]
    const values: Array<{ column: number; value: string }> = []

    for (const [index, cell] of cells.entries()) {
      const reference = /\br="([A-Z]+)\d*"/.exec(cell[1]!)?.[1]
      values.push({ column: reference ? columnIndex(reference) : index, value: cellValue(cell[1]!, cell[2]!, shared) })
    }

    const width = values.length ? Math.max(...values.map((value) => value.column)) + 1 : 0
    const line = Array.from({ length: width }, () => "")
    for (const value of values) line[value.column] = value.value

    return line
  })
}

function columnIndex(reference: string) {
  return [...reference].reduce((index, letter) => index * 26 + (letter.charCodeAt(0) - 64), 0) - 1
}

function cellValue(attributes: string, body: string, shared: ReadonlyArray<string>) {
  const type = /\bt="([^"]*)"/.exec(attributes)?.[1]
  if (type === "inlineStr") return collectTag(body, "t")
  const value = collectTag(body, "v")
  if (type === "s") return shared[Number(value)] ?? ""
  return value
}

/** Converts a CSV or TSV file to a Markdown table, honouring quoted fields and embedded newlines. */
export function csvToMarkdown(text: string, delimiter: "," | "\t") {
  const rows = splitDelimited(text.slice(0, MAX_SOURCE_LENGTH), delimiter)

  return cleanMarkdown(rowsToMarkdown(rows) ?? "")
}

function splitDelimited(text: string, delimiter: string) {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let cell = ""
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!

    if (quoted) {
      if (character !== '"') {
        cell += character
        continue
      }
      // Two quotes inside a quoted field mean one literal quote.
      if (text[index + 1] === '"') {
        cell += '"'
        index++
        continue
      }
      quoted = false
      continue
    }

    if (character === '"') {
      quoted = true
      continue
    }
    if (character === delimiter) {
      row.push(cell)
      cell = ""
      continue
    }
    if (character === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      continue
    }
    if (character === "\r") continue
    cell += character
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

/** Drops empty rows and columns, escapes table pipes and prefixes a header row. */
function rowsToMarkdown(rows: ReadonlyArray<ReadonlyArray<string>>) {
  const filled = rows
    .map((row) => row.map((cell) => cell.replace(/\s+/g, " ").trim()))
    .filter((row) => row.some((cell) => cell.length > 0))
  if (!filled.length) return undefined

  const width = Math.max(...filled.map((row) => row.length))
  const columns = Array.from({ length: width }, (_, index) => index).filter((index) =>
    filled.some((row) => (row[index] ?? "").length > 0),
  )
  if (!columns.length) return undefined

  const lines = filled.map((row) => `| ${columns.map((index) => escapeCell(row[index] ?? "")).join(" | ")} |`)
  lines.splice(1, 0, `| ${columns.map(() => "---").join(" | ")} |`)

  return lines.join("\n")
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|")
}

function collectTag(xml: string, tag: string) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g")

  return decodeXml([...xml.matchAll(pattern)].map((match) => match[1]!).join(""))
}

const PAGE_NOISE = [
  /^[-–—]\s*\d+\s*[-–—]$/,
  /^\d{1,3}\s*\/\s*\d{1,3}$/,
  /^page\s*\d{1,3}(\s*(?:of|\/)\s*\d{1,3})?$/i,
  /^第\s*\d{1,3}\s*页(?:\s*[,，]?\s*共\s*\d{1,3}\s*页)?$/,
  /^\d{1,3}\s*页$/,
]

/** A table-of-contents line: a title, dot leaders and a page number. */
const TOC_LINE = /(?:\.{3,}|…{2,})\s*\d{1,4}$/

/** Removes page-number and table-of-contents lines, trailing whitespace and runs of blank lines. */
function cleanMarkdown(markdown: string) {
  return markdown
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line) => {
      const text = line.trim()
      if (!text) return true
      if (TOC_LINE.test(text)) return false
      // Page numbers are short; anything longer that starts with a digit is real content.
      return !(text.length <= 24 && PAGE_NOISE.some((pattern) => pattern.test(text)))
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

function decodeXml(value: string) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return XML_ENTITIES[body] ?? entity
  })
}
