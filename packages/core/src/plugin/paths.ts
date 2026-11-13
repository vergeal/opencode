export * as PluginPaths from "./paths.js"

import { accessSync, constants } from "node:fs"
import path from "node:path"

export type Paths = {
  /** Owned by the plugin: it survives uninstall so `onUninstall` can decide what to keep. */
  readonly data: string
  /** The host deletes this on uninstall; treat everything in it as rebuildable. */
  readonly cache: string
  /** The plugin's interpreter environment. Rebuildable from the manifest, so it is removed on uninstall. */
  readonly runtime: string
  readonly log: string
}

/**
 * Whether `D:\` exists and accepts writes. A yes is asked again on every call, so a drive that is lost is noticed by
 * the next `make` and the environment falls back to the home directory without a restart.
 *
 * A no is remembered for the life of the process. Re-asking a missing drive would repeat the same syscall on every
 * list, uninstall, and activation, and a drive plugged in later is picked up on the next start. One consequence is
 * worth stating: once a call sees the drive missing, the rest of this process treats it as missing.
 */
let absent: boolean | undefined
function driveAvailable() {
  if (absent) return false
  try {
    accessSync("D:\\", constants.W_OK)
    return true
  } catch {
    absent = true
    return false
  }
}

/**
 * Each plugin gets directories named after its id, with Windows placing the rebuildable ones on `D:` when it can.
 * A scoped package id (`@scope/name`) must stay one directory name, so path separators become `+`.
 *
 * Only the environment and the cache follow the drive. `data` and `log` stay under the home directory, so a drive
 * that is missing at the moment costs a re-download, never the plugin's configuration or its log history.
 */
export function make(input: {
  readonly home: string
  readonly id: string
  /** Test seam. Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform
  /** Test seam. `true` uses `D:\.opencode`; defaults to probing `D:\`. */
  readonly drive?: boolean
}): Paths {
  const platform = input.platform ?? process.platform
  const join = platform === "win32" ? path.win32.join : path.join
  const root = join(input.home, ".opencode")
  const buildable = platform === "win32" && (input.drive ?? driveAvailable()) ? "D:\\.opencode" : root
  const id = input.id.replaceAll(/[\\/]/g, "+")
  return {
    data: join(root, "plugin-data", id),
    cache: join(buildable, "plugin-cache", id),
    runtime: join(buildable, "plugin-runtime", id),
    log: join(root, "logs", "plugin", `${id}.log`),
  }
}

/**
 * The cache and runtime paths the previous drive used. `data` and `log` never move, so they are not included.
 * Answers undefined when nothing moved: another platform, or a machine whose environment already sits on the home
 * drive because `D:\` was missing or read-only.
 */
export function legacy(input: {
  readonly home: string
  readonly id: string
  /** Test seam. Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform
  /** Test seam. `true` treats the environment as living on `D:`; defaults to probing `D:\`. */
  readonly drive?: boolean
}): { readonly cache: string; readonly runtime: string } | undefined {
  const platform = input.platform ?? process.platform
  if (platform !== "win32") return undefined
  if (!(input.drive ?? driveAvailable())) return undefined
  const root = path.win32.join(input.home, ".opencode")
  const id = input.id.replaceAll(/[\\/]/g, "+")
  return {
    cache: path.win32.join(root, "plugin-cache", id),
    runtime: path.win32.join(root, "plugin-runtime", id),
  }
}
