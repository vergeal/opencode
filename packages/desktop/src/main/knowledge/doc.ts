/**
 * Legacy Word documents. A `.doc` is a binary format that needs a word processor to read, so the
 * conversion goes through the platform's own text extractor. Only macOS ships one; elsewhere the
 * file is skipped rather than stored as unreadable bytes.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

export async function docToText(file: string) {
  if (process.platform !== "darwin") return ""

  try {
    const { stdout } = await run("textutil", ["-convert", "txt", "-stdout", file], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
    })

    return stdout
  } catch {
    return ""
  }
}
