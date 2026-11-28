export * as CodeModeCatalog from "./catalog.js"

import { Schema } from "effect"

export type Tool = {
  readonly type: "tool"
  readonly name: string
  readonly description: string
  readonly signature: string
  readonly pinned?: boolean
}

export type Namespace = {
  readonly type: "namespace"
  readonly name: string
  readonly description?: string
  readonly tools: ReadonlyArray<Tool | Namespace>
}

export type Inventory = {
  readonly tools: ReadonlyArray<Tool | Namespace>
}

const NamespaceSummary = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  count: Schema.Number,
})

export const Summary = Schema.Struct({
  total: Schema.Number,
  namespaces: Schema.Array(NamespaceSummary),
})
export type Summary = typeof Summary.Type

/**
 * The catalog as the model sees it: every namespace with its tool count and one-line purpose. No signatures —
 * `search` returns those on demand, with the full parameter list and its JSDoc.
 */
export function summarize(inventory: Inventory): Summary {
  const flattened = flatten(inventory.tools)
  const namespaces = [...Map.groupBy(flattened.tools, (tool) => tool.path.split(".", 1)[0] ?? tool.path)]
    .sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })
    .map(([name, namespaceEntries]) => {
      const description = flattened.namespaces.get(name)?.description
      return {
        name,
        ...(description === undefined ? {} : { description }),
        count: namespaceEntries.length,
      }
    })

  // The catalog names what exists and how much of it there is; the signatures are what `search` returns on
  // demand. Listing them here cost 8 KB and, worse, made every namespace compete for one byte budget: a new
  // 45-tool namespace arriving mid-session cut an entry from every other namespace, so a change to one
  // namespace rewrote all of them and the whole block had to be restated.
  return { total: flattened.tools.length, namespaces }
}

function flatten(entries: ReadonlyArray<Tool | Namespace>, path: ReadonlyArray<string> = []) {
  const tools: Array<Omit<Tool, "name"> & { readonly path: string }> = []
  const namespaces = new Map<string, Namespace>()
  for (const entry of entries) {
    if (entry.type === "tool") {
      tools.push({
        type: "tool",
        path: [...path, entry.name].join("."),
        description: entry.description,
        signature: entry.signature,
        ...(entry.pinned === undefined ? {} : { pinned: entry.pinned }),
      })
      continue
    }
    const next = [...path, entry.name]
    namespaces.set(next.join("."), entry)
    const nested = flatten(entry.tools, next)
    tools.push(...nested.tools)
    for (const [name, namespace] of nested.namespaces) namespaces.set(name, namespace)
  }
  return { tools, namespaces }
}

export function namespaceLine(namespace: typeof NamespaceSummary.Type) {
  const count = namespace.count === 1 ? "1 tool" : `${namespace.count} tools`
  return `- ${namespace.name} (${count})${namespace.description === undefined ? "" : ` // ${namespace.description}`}`
}

