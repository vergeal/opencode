export * as PluginPaths from "./paths.js"

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
 * Each plugin gets directories named after its id under the same `~/.opencode` root as installed bundles. A scoped
 * package id (`@scope/name`) must stay one directory name, so path separators become `+`.
 */
export function make(input: { readonly home: string; readonly id: string }): Paths {
  const root = path.join(input.home, ".opencode")
  const id = input.id.replaceAll(/[\\/]/g, "+")
  return {
    data: path.join(root, "plugin-data", id),
    cache: path.join(root, "plugin-cache", id),
    runtime: path.join(root, "plugin-runtime", id),
    log: path.join(root, "logs", "plugin", `${id}.log`),
  }
}
