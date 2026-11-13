export * as PluginLocal from "./local.js"

import type { Plugin } from "@opencode/schema/plugin"
import { PluginManifest } from "@opencode/schema/plugin-manifest"
import { Option, Schema } from "effect"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

/**
 * The local discover directory mirrors what a registry would publish: one folder per plugin id, one folder per
 * version inside it, and the `.ocplugin` bundle in that version folder. The app lists it as the catalog, so this
 * machine can try the full install flow before a registry exists.
 */
export const root = (home: string) => path.join(home, ".ocplugins-local")

/** Where installed bundles are unpacked, one directory per plugin id. */
export const installRoot = (home: string) => path.join(home, ".opencode", "ocplugins")

type Manifest = {
  id?: unknown
  version?: unknown
  display?: unknown
  skills?: unknown
  runtime?: unknown
}

type Found = { version: string; file: string; manifest?: Manifest }

/** Every id with at least one bundle, newest version first, keyed by id. */
export async function list(input: { home: string }): Promise<Plugin.LocalEntry[]> {
  const directory = root(input.home)
  const ids = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const entries = await Promise.all(
    ids.filter((entry) => entry.isDirectory()).map((entry) => read(directory, entry.name)),
  )
  return entries.filter((entry): entry is Plugin.LocalEntry => entry !== undefined).sort((a, b) => compare(a.id, b.id))
}

export function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semver order when both versions parse, byte order otherwise. */
export function compareVersions(a: string, b: string) {
  const ordered = semver(a, b)
  return ordered ?? compare(a, b)
}

async function read(directory: string, id: string): Promise<Plugin.LocalEntry | undefined> {
  const versions = await readdir(path.join(directory, id), { withFileTypes: true }).catch(() => [])
  const found = (
    await Promise.all(
      versions.filter((entry) => entry.isDirectory()).map((entry) => readVersion(path.join(directory, id), entry.name)),
    )
  )
    .filter((entry): entry is Found => entry !== undefined)
    .sort((a, b) => compareVersions(a.version, b.version))
    .reverse()
  if (found.length === 0) return undefined

  // The newest bundle describes the plugin; older versions keep their own bundle but share the entry's copy.
  const display = found.map((entry) => displayOf(entry.manifest)).find((entry) => entry !== undefined)
  const runtime = found.map((entry) => runtimeOf(entry.manifest)).find((entry) => entry !== undefined)
  return {
    id,
    ...(display ? { display } : {}),
    ...(runtime ? { runtime } : {}),
    versions: found.map((entry) => ({ version: entry.version, file: entry.file })),
  }
}

async function readVersion(directory: string, version: string): Promise<Found | undefined> {
  const folder = path.join(directory, version)
  const files = await readdir(folder).catch(() => [])
  const file = files.find((name) => name.endsWith(".ocplugin"))
  if (!file) return undefined
  return { version, file, manifest: await readManifest(path.join(folder, file)) }
}

/**
 * A pack writes a `manifest.json` next to the bundle, so listing a directory never opens a multi-megabyte archive.
 * A bundle copied in by hand has no sidecar; reading its own `ocplugin.json` is the fallback that still lets it show.
 */
async function readManifest(file: string): Promise<Manifest | undefined> {
  const sidecar = await Bun.file(path.join(path.dirname(file), "manifest.json"))
    .json()
    .catch(() => undefined)
  if (isManifest(sidecar)) return sidecar
  const archive = new Bun.Archive(new Uint8Array(await readFile(file)))
  const declared = (await archive.files()).get("ocplugin.json")
  if (!declared) return undefined
  const parsed: unknown = await declared.json().catch(() => undefined)
  return isManifest(parsed) ? parsed : undefined
}

function isManifest(input: unknown): input is Manifest {
  return typeof input === "object" && input !== null
}

/** The runtime the newest bundle declares, read with the same schema the host prepares it from. */
function runtimeOf(manifest: Manifest | undefined): Plugin.LocalEntry["runtime"] {
  return Option.getOrUndefined(Schema.decodeUnknownOption(PluginManifest.Runtime)(manifest?.runtime))
}

function displayOf(manifest: Manifest | undefined): Plugin.Display | undefined {  if (typeof manifest?.display !== "object" || manifest.display === null) return undefined
  const display = manifest.display as Partial<Plugin.Display>
  if (typeof display.name !== "string" || typeof display.description !== "string") return undefined
  const skills = skillsOf(display.skills) ?? skillsOf(manifest.skills)
  return {
    name: display.name,
    description: display.description,
    ...(typeof display.category === "string" ? { category: display.category } : {}),
    ...(Array.isArray(display.tools) ? { tools: display.tools } : {}),
    ...(skills ? { skills } : {}),
  } as Plugin.Display
}

/** `display.skills` and a bundle's top-level `skills` share the fields a card reads; `path` only matters in the pack. */
function skillsOf(input: unknown): Plugin.Display["skills"] {
  if (!Array.isArray(input)) return undefined
  const skills = input.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const skill = item as { id?: unknown; name?: unknown; description?: unknown }
    if (typeof skill.id !== "string" || typeof skill.name !== "string" || typeof skill.description !== "string") return []
    return [{ id: skill.id, name: skill.name, description: skill.description }]
  })
  return skills.length > 0 ? skills : undefined
}

function semver(a: string, b: string) {
  try {
    return Bun.semver.order(a, b) as -1 | 0 | 1
  } catch {
    return undefined
  }
}
