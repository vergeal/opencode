#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises"
import { join, posix } from "node:path"

// `.ocplugin` is a gzipped tar with sorted paths and a zero mtime, so the same build produces the same file and
// sha256. Bun.Archive stamps entry mtimes from the moment it writes, which breaks that guarantee on the write path;
// it stays the read path for the installer.
const root = join(import.meta.dir, "..")
const dist = join(root, "dist")
const manifest = await Bun.file(join(root, "ocplugin.json")).json()
const out = join(dist, "plugins")

await mkdir(out, { recursive: true })

// Packing writes into dist/plugins, so it must never read its own previous output back into the archive.
const paths = (await walk(dist))
  .filter((path) => path !== "ocplugin.json" && !path.startsWith("plugins/"))
  .sort(compare)
const files = await Promise.all(
  paths.map(async (path) => ({ path, bytes: new Uint8Array(await readFile(join(dist, path))) })),
)
const declared = {
  ...manifest,
  files: files.map((file) => ({ path: file.path, sha256: createHash("sha256").update(file.bytes).digest("hex") })),
}
const entries = [
  ...files,
  { path: "ocplugin.json", bytes: new TextEncoder().encode(JSON.stringify(declared, null, 2) + "\n") },
].sort((a, b) => compare(a.path, b.path))

const tar = concat([
  ...entries.flatMap((entry) => [entryHeader(entry.path, entry.bytes.byteLength), pad(entry.bytes)]),
  zeroBlock(),
  zeroBlock(),
])
const archive = join(out, `${manifest.id}-${manifest.version}.ocplugin`)
await rm(archive, { force: true })
await Bun.write(archive, Bun.gzipSync(tar, { level: 9 }))

console.log(`packed ${archive} (${entries.length} entries, ${(tar.byteLength / 1024 / 1024).toFixed(1)} MiB of tar)`)

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

async function walk(directory: string, prefix = ""): Promise<string[]> {
  const children = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    children.map(async (child) => {
      const path = posix.join(prefix, child.name)
      if (child.isDirectory()) return walk(join(directory, child.name), path)
      const info = await stat(join(directory, child.name))
      if (!info.isFile()) throw new Error(`.ocplugin cannot contain ${path}: only regular files are allowed`)
      return [path]
    }),
  )
  return nested.flat()
}

function concat(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function pad(bytes: Uint8Array) {
  const remainder = bytes.byteLength % 512
  return remainder === 0 ? bytes : concat([bytes, new Uint8Array(512 - remainder)])
}

function zeroBlock() {
  return new Uint8Array(512)
}

function entryHeader(path: string, size: number) {
  const header = new Uint8Array(512)
  const write = (value: string, offset: number, length: number) => {
    header.set(new TextEncoder().encode(value).subarray(0, length), offset)
  }
  const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, "0") + "\0"
  // ustar stores paths over 100 bytes as prefix + name, split at a directory boundary.
  const [name, prefix] = split(path)
  write(name, 0, 100)
  write("0000644\0", 100, 8)
  write("0000000\0", 108, 8)
  write("0000000\0", 116, 8)
  write(octal(size, 12), 124, 12)
  write(octal(0, 12), 136, 12)
  write("        ", 148, 8)
  write("0", 156, 1)
  write("ustar\0", 257, 6)
  write("00", 263, 2)
  write(prefix, 345, 155)
  const checksum = header.reduce((total, byte) => total + byte, 0)
  write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8)
  return header
}

function split(path: string) {
  const encoder = new TextEncoder()
  if (encoder.encode(path).byteLength <= 100) return [path, ""] as const
  const parts = path.split("/")
  for (let index = parts.length - 1; index > 0; index--) {
    const prefix = parts.slice(0, index).join("/")
    const name = parts.slice(index).join("/")
    if (encoder.encode(prefix).byteLength <= 155 && encoder.encode(name).byteLength <= 100) return [name, prefix] as const
  }
  throw new Error(`.ocplugin path is too long for tar: ${path}`)
}
