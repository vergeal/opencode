/**
 * PDF text extraction. macOS reads the text layer with the system PDF framework, which decodes the
 * fonts of real project documents correctly; every other platform falls back to the built-in
 * parser. Both paths return "" for a scanned document without a text layer, so nothing is stored as
 * an image-only placeholder.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parsePdfText } from "./pdf-parser"

const run = promisify(execFile)

/** One PDF at a time; the text comes back as a single string on stdout. */
const PDFKIT = `
function run(argv) {
  ObjC.import('Quartz')
  const data = $.NSData.dataWithContentsOfFile(argv[0])
  if (!data) return ''
  const document = $.PDFDocument.alloc.initWithData(data)
  if (!document) return ''
  const text = document.string
  return text ? text.js : ''
}
`

export async function pdfToText(file: string, bytes: Uint8Array) {
  if (process.platform === "darwin") {
    const text = await pdfKitText(file).catch(() => "")
    if (text.trim()) return clean(text)
  }

  return clean(parsePdfText(bytes))
}

async function pdfKitText(file: string) {
  const { stdout } = await run("osascript", ["-l", "JavaScript", "-e", PDFKIT, file], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  })

  return stdout
}

/**
 * NFKC folds the Kangxi radical and compatibility glyphs that ToUnicode tables use back into the
 * everyday characters they stand for, so the same word matches across documents.
 */
function clean(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
