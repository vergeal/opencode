export * as PluginBundle from "./bundle.js"

import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { mkdir, readdir, readFile, rename, rm, stat, symlink, utimes } from "node:fs/promises"
import path from "node:path"

export type Result = { readonly id: string; readonly version: string; readonly path: string }

type Manifest = {
  apiVersion: number
  id: string
  version: string
  entry: { server?: string; tui?: string; rpc?: string; gui?: string }
  externals?: string[]
  files?: { path: string; sha256: string }[]
}

/**
 * Installs a `.ocplugin` bundle that already exists on this machine, so the app can offer one button instead of
 * explaining the container format. The bundle is found by plugin id in the usual download locations, verified, and
 * unpacked into the config directory's `plugins/<id>/`, where directory discovery picks it up.
 */
export async function install(input: {
  readonly id: string
  readonly config: string
  readonly cwd: string
  readonly home: string
}): Promise<Result> {
  const file = await find(input)
  const archive = new Bun.Archive(new Uint8Array(await readFile(file)))
  const entries = await archive.files()
  const manifest = await readManifest(entries)
  if (manifest.apiVersion !== 1)
    throw new Error(`This bundle needs a newer OpenCode (format ${manifest.apiVersion}). Update the app first.`)
  if (manifest.id !== input.id) throw new Error(`This bundle is ${manifest.id}, not ${input.id}.`)
  for (const hash of manifest.files ?? []) {
    const entry = entries.get(hash.path)
    if (!entry) throw new Error(`This bundle is incomplete: ${hash.path} is missing.`)
    const digest = createHash("sha256").update(new Uint8Array(await entry.arrayBuffer())).digest("hex")
    if (digest !== hash.sha256) throw new Error(`This bundle is damaged: ${hash.path} does not match its checksum.`)
  }

  const plugins = path.join(input.config, "plugins")
  await mkdir(plugins, { recursive: true })
  const target = path.join(plugins, manifest.id)
  const existed = await exists(target)
  const tmp = path.join(plugins, `.${manifest.id}.tmp-${random()}`)
  const backup = path.join(plugins, `.${manifest.id}.old-${random()}`)
  await mkdir(tmp, { recursive: true })
  try {
    await archive.extract(tmp)
    await linkExternals(tmp, manifest.externals ?? [])
    if (existed) await rename(target, backup)
    try {
      await rename(tmp, target)
    } catch (error) {
      if (existed) await rename(backup, target)
      throw error
    }
    await rm(backup, { recursive: true, force: true })
    // Touching the directory gives the config watcher a change event, so the host reloads without a restart.
    await utimes(plugins, new Date(), new Date()).catch(() => {})
    return { id: manifest.id, version: manifest.version, path: target }
  } catch (error) {
    await rm(tmp, { recursive: true, force: true })
    throw error
  }
}

/** The newest matching bundle in the locations a user's download or drag onto the desktop lands in. */
async function find(input: { id: string; config: string; cwd: string; home: string }) {
  const folders = [
    path.join(input.home, "Desktop"),
    path.join(input.home, "Downloads"),
    path.join(input.home, "desktop"),
    path.join(input.home, "downloads"),
    input.cwd,
    path.join(input.config, "plugins"),
  ]
  const candidates: { file: string; mtime: number }[] = []
  for (const folder of folders) {
    const names = await readdir(folder).catch(() => [])
    for (const name of names) {
      if (!name.startsWith(input.id) || !name.endsWith(".ocplugin")) continue
      const info = await stat(path.join(folder, name)).catch(() => undefined)
      if (info?.isFile()) candidates.push({ file: path.join(folder, name), mtime: info.mtimeMs })
    }
  }
  if (candidates.length === 0)
    throw new Error(`No ${input.id} bundle was found. Download it again, then install.`)
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0]!.file
}

async function readManifest(entries: Map<string, File>): Promise<Manifest> {
  const file = entries.get("ocplugin.json")
  if (!file) throw new Error("This is not a plugin bundle: ocplugin.json is missing.")
  const parsed: unknown = JSON.parse(await file.text())
  if (typeof parsed !== "object" || parsed === null) throw new Error("This plugin bundle has an unreadable manifest.")
  const manifest = parsed as Partial<Manifest>
  if (typeof manifest.id !== "string" || typeof manifest.version !== "string" || typeof manifest.apiVersion !== "number")
    throw new Error("This plugin bundle has an unreadable manifest.")
  if (typeof manifest.entry?.server !== "string" || !entries.has(manifest.entry.server))
    throw new Error("This plugin bundle has no server entry.")
  return manifest as Manifest
}

/**
 * The bundle's entry imports the host's own `effect` and `@opencode/*` modules, and a plugin directory lives outside
 * any node_modules tree. Link each host module into the plugin so those imports resolve to the same instances the
 * host already loaded.
 */
async function linkExternals(directory: string, externals: readonly string[]) {
  if (externals.length === 0) return
  const require = createRequire(import.meta.url)
  for (const name of externals) {
    const manifest = require.resolve(`${name}/package.json`)
    const target = path.join(directory, "node_modules", ...name.split("/"))
    await mkdir(path.dirname(target), { recursive: true })
    await symlink(path.dirname(manifest), target, process.platform === "win32" ? "junction" : "dir")
  }
}

async function exists(target: string) {
  return stat(target).then(
    (info) => info.isDirectory(),
    () => false,
  )
}

function random() {
  return Math.random().toString(36).slice(2, 10)
}
