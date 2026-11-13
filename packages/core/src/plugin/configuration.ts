export * as PluginConfiguration from "./configuration.js"

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import * as PluginPaths from "./paths.js"

/** The declarative configuration a manifest may publish. Flat values only: no nested objects or arrays of objects. */
export type Configuration = {
  readonly title?: string
  readonly properties: Readonly<Record<string, Property>>
}

export type Property = {
  readonly type: "string" | "number" | "boolean" | "array"
  readonly default?: unknown
  readonly enum?: readonly string[]
  readonly description?: string
  readonly items?: { readonly type: "string" }
}

const types: ReadonlySet<string> = new Set(["string", "number", "boolean", "array"])

export function isConfiguration(input: unknown): input is Configuration {
  if (typeof input !== "object" || input === null) return false
  const configuration = input as { title?: unknown; properties?: unknown }
  if (configuration.title !== undefined && typeof configuration.title !== "string") return false
  if (typeof configuration.properties !== "object" || configuration.properties === null) return false
  return Object.values(configuration.properties).every(isProperty)
}

/** Rejects a declaration the runtime could not enforce, so a bad manifest fails at install time. */
export function isProperty(input: unknown): input is Property {
  if (typeof input !== "object" || input === null) return false
  const property = input as { type?: unknown; enum?: unknown; items?: unknown; default?: unknown }
  if (typeof property.type !== "string" || !types.has(property.type)) return false
  if (property.enum !== undefined) {
    if (property.type !== "string" || !Array.isArray(property.enum)) return false
    if (!property.enum.every((value) => typeof value === "string")) return false
  }
  if (property.items !== undefined) {
    if (property.type !== "array") return false
    if (typeof property.items !== "object" || property.items === null) return false
    if ((property.items as { type?: unknown }).type !== "string") return false
  }
  return property.default === undefined || matches(property as Property, property.default)
}

function matches(property: Property, value: unknown) {
  if (property.type === "array")
    return Array.isArray(value) && value.every((item) => typeof item === "string")
  if (property.type === "number") return typeof value === "number" && Number.isFinite(value)
  if (property.type === "boolean") return typeof value === "boolean"
  if (typeof value !== "string") return false
  return property.enum === undefined || property.enum.includes(value)
}

/** Drops values the manifest does not declare and fills every declared default. */
function normalize(configuration: Configuration | undefined, stored: Readonly<Record<string, unknown>>) {
  if (configuration === undefined) return {}
  return Object.fromEntries(
    Object.entries(configuration.properties).flatMap(([name, property]) => {
      const value = stored[name]
      if (value !== undefined && matches(property, value)) return [[name, value]]
      return property.default === undefined ? [] : [[name, property.default]]
    }),
  )
}

export function make(input: {
  readonly home: string
  readonly id: string
  readonly configuration?: Configuration
}) {
  const target = path.join(PluginPaths.make({ home: input.home, id: input.id }).data, "config.json")
  const listeners = new Set<(next: Record<string, unknown>) => void>()

  const read = () =>
    readFile(target, "utf8").then(
      (text) => JSON.parse(text) as Record<string, unknown>,
      () => ({}),
    )

  const write = async (values: Record<string, unknown>) => {
    await mkdir(path.dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(values, null, 2))
    await rename(temporary, target)
  }

  return {
    get: () => Effect.promise(async () => normalize(input.configuration, await read())),
    update: (patch: Readonly<Record<string, unknown>>) =>
      Effect.promise(async () => {
        const properties = input.configuration?.properties ?? {}
        for (const [name, value] of Object.entries(patch)) {
          const property = properties[name]
          if (property === undefined) throw new Error(`Unknown configuration key: ${name}`)
          if (!matches(property, value)) throw new Error(`Invalid configuration value for ${name}`)
        }
        const next = normalize(input.configuration, { ...(await read()), ...patch })
        await write(next)
        for (const listener of listeners) listener(next)
      }),
    onChange: (listener: (next: Record<string, unknown>) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}
