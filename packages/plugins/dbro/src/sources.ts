export * as Sources from "./sources.js"

import * as Dialects from "./dialects.js"

export interface Source {
  readonly name: string
  readonly dialect: Dialects.Dialect
  readonly host: string
  readonly port: number
  readonly user: string
  readonly database?: string
  readonly passwordEnv?: string
  /** Only set when a user accepted putting a plaintext password in opencode.json. */
  readonly password?: string
}

export interface Settings {
  readonly sources: readonly Source[]
  readonly defaultSource?: string
  readonly python: string
  readonly timeout: number
  readonly maxRows: number
  readonly toolDirectory?: string
  /** Entries the user wrote that could not be parsed; they are reported instead of silently dropped. */
  readonly errors: readonly string[]
}

/**
 * Source entries come from two places: `opencode.json` options (static, committed with the project) and the plugin's
 * user-level `configuration` (runtime, string[] only). Later entries win by name, so the runtime config can correct a
 * project default without duplicating it.
 */
export function settings(options: Readonly<Record<string, unknown>>, config: Readonly<Record<string, unknown>>): Settings {
  const parsed = [parseEntries(options.sources), parseEntries(config.sources)]
  const sources = parsed.flatMap((entry) => entry.sources)
  const errors = parsed.flatMap((entry) => entry.errors)
  const merged = [...sources.reduce((byName, source) => byName.set(source.name, source), new Map<string, Source>()).values()]

  return {
    sources: merged,
    defaultSource: text(config.defaultSource) ?? text(options.defaultSource),
    python: text(config.python) ?? text(options.python) ?? "python3",
    timeout: number(config.timeout) ?? number(options.timeout) ?? 30,
    maxRows: integer(config.maxRows) ?? integer(options.maxRows) ?? 200,
    toolDirectory: text(config.toolDirectory) ?? text(options.toolDirectory),
    errors,
  }
}

export function find(settings: Settings, name: string) {
  return settings.sources.find((source) => source.name === name)
}

/** The environment variable that holds a source's password, in the order the executor and the plugin check it. */
export function passwordEnv(source: Source) {
  if (source.passwordEnv) return source.passwordEnv
  return `DBRO_${source.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_PASSWORD`
}

function parseEntries(value: unknown) {
  if (value === undefined || value === null) return { sources: [] as Source[], errors: [] as string[] }
  if (!Array.isArray(value)) return { sources: [] as Source[], errors: ["sources 必须是字符串或对象数组。"] }

  const sources: Source[] = []
  const errors: string[] = []
  for (const entry of value) {
    const result = parseEntry(entry)
    if (typeof result === "string") {
      errors.push(result)
      continue
    }
    sources.push(result)
  }
  return { sources, errors }
}

function parseEntry(entry: unknown): Source | string {
  if (typeof entry === "string") return parseString(entry)
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "数据源条目必须是字符串或对象。"

  const record = entry as Readonly<Record<string, unknown>>
  const name = text(record.name)
  const dialect = text(record.dialect)
  if (!name) return "数据源对象缺少 name。"
  if (!dialect || !Dialects.is(dialect))
    return `数据源 ${name} 的 dialect 必须是 ${Dialects.VALUES.join(" / ")}。`

  return {
    name,
    dialect,
    host: text(record.host) ?? "127.0.0.1",
    port: integer(record.port) ?? Dialects.DEFAULT_PORT[dialect],
    user: text(record.user) ?? Dialects.DEFAULT_USER[dialect],
    database: text(record.database),
    passwordEnv: text(record.passwordEnv),
    password: text(record.password),
  }
}

/**
 * `name=dm://user@host:5236/schema` or the same URL without a name, in which case the name is derived from it. Passwords
 * never belong in this string: use `passwordEnv` or the encrypted plugin secret `source.<name>.password`.
 */
function parseString(entry: string): Source | string {
  const trimmed = entry.trim()
  const separator = trimmed.indexOf("=")
  const named = separator > 0 && !trimmed.slice(0, separator).includes("://")
  const name = named ? trimmed.slice(0, separator).trim() : undefined
  const address = named ? trimmed.slice(separator + 1).trim() : trimmed

  let url: URL
  try {
    url = new URL(address)
  } catch {
    return `无法解析数据源：${trimmed}。格式是 name=dm://user@host:5236/database。`
  }

  const dialect = url.protocol.replace(/:$/, "")
  if (!Dialects.is(dialect)) return `数据源 ${trimmed} 的协议必须是 dm / mysql / pg。`

  const port = url.port ? Number(url.port) : Dialects.DEFAULT_PORT[dialect]
  if (!Number.isInteger(port) || port < 1 || port > 65535) return `数据源 ${trimmed} 的端口无效。`

  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined
  const user = decodeURIComponent(url.username) || Dialects.DEFAULT_USER[dialect]

  return {
    name: name || `${dialect}:${url.hostname}${database ? `/${database}` : ""}`,
    dialect,
    host: url.hostname,
    port,
    user,
    database,
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined
}
