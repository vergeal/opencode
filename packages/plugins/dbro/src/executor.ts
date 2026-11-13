export * as Executor from "./executor.js"

import * as Dialects from "./dialects.js"
import { existsSync } from "node:fs"
import { join } from "node:path"

/** Cap on rendered table text returned to the model; the executors have no row limit for 达梦 and MySQL. */
export const MAX_OUTPUT = 200_000

export interface Run {
  readonly dialect: Dialects.Dialect
  readonly sql: string
  readonly python: string
  readonly directory: string
  readonly host?: string
  readonly port?: number
  readonly user?: string
  readonly database?: string
  readonly timeout: number
  readonly maxRows: number
  readonly password?: string
  readonly signal?: AbortSignal
}

export interface Outcome {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly durationMs: number
  readonly truncated: boolean
  readonly timedOut: boolean
}

/**
 * The scripts always come from the bundle: an installed plugin only ever uses `<plugin>/assets/dbro`, never a copy in
 * the user's home directory. The extra candidates cover a worktree before and after `bun run build`, and
 * `toolDirectory` is the explicit override.
 */
export function locate(configured?: string) {
  const candidates = [
    configured,
    join(import.meta.dir, "..", "assets", "dbro"),
    join(import.meta.dir, "..", "..", "assets", "dbro"),
    join(import.meta.dir, "..", "dist", "assets", "dbro"),
  ].filter((path): path is string => Boolean(path))

  return candidates.find((path) => existsSync(join(path, "dbro.py")))
}

export async function run(input: Run): Promise<Outcome> {
  const script = join(input.directory, "dbro.py")
  if (!existsSync(script)) throw new Error(`找不到 dbro.py：${script}。请重新构建并安装插件。`)

  const env: Record<string, string | undefined> = { ...process.env }
  if (input.password !== undefined) env[Dialects.PASSWORD_ENV[input.dialect]] = input.password

  const started = Date.now()
  const proc = spawn(input.python, argumentsFor(script, input), env)
  // SQL goes through stdin: argv has a platform size limit, and a 100k-character query with Chinese literals can
  // exceed it. dbro.py reads stdin whenever neither -e nor -f is given.
  try {
    proc.stdin?.write(input.sql)
    proc.stdin?.end()
  } catch {
    // The child may have exited before reading; the exit code and stderr below carry the real reason.
  }
  let timedOut = false
  const budget = Math.max(1, input.timeout) * 1000 + 5_000
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, budget)
  const abort = () => proc.kill()
  input.signal?.addEventListener("abort", abort, { once: true })

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readCapped(proc.stdout, MAX_OUTPUT),
      readCapped(proc.stderr, MAX_OUTPUT),
      proc.exited,
    ])
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode,
      durationMs: Date.now() - started,
      truncated: stdout.truncated || stderr.truncated,
      timedOut,
    }
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener("abort", abort)
  }
}

function spawn(python: string, args: string[], env: Record<string, string | undefined>) {
  try {
    return Bun.spawn([python, ...args], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === "ENOENT")
      throw new Error(`找不到 Python 解释器「${python}」。安装 python3，或在插件设置里把 python 指向可执行文件。`)
    throw error
  }
}

/**
 * dbro.py owns the read-only gate: it rejects multi-statement and write-shaped SQL, then the executor opens a read-only
 * transaction. This function never adds `--force` or a write switch, so the plugin cannot widen that gate.
 */
function argumentsFor(script: string, input: Run) {
  const args = [script, input.dialect]
  if (input.host) args.push("-H", input.host)
  if (input.port !== undefined) args.push("-P", String(input.port))
  if (input.user) args.push("-u", input.user)
  if (input.database) args.push("-d", input.database)
  args.push("--timeout", String(input.timeout), "--max-rows", String(input.maxRows))
  return args
}

async function readCapped(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  while (true) {
    const next = await reader.read().catch(() => undefined)
    if (!next || next.done) break
    const value = next.value
    if (size >= limit) {
      truncated = true
      continue
    }
    const room = limit - size
    const chunk = value.byteLength > room ? value.subarray(0, room) : value
    chunks.push(chunk)
    size += chunk.byteLength
    if (chunk.byteLength < value.byteLength) truncated = true
  }
  return { text: await new Blob(chunks).text(), truncated }
}

export interface Probe {
  readonly python: string
  readonly version?: string
  readonly drivers: Readonly<Record<string, boolean>>
  readonly error?: string
}

/** Importability of each driver without importing it, so a broken dmPython install cannot fail the whole probe. */
export async function probe(python: string, signal?: AbortSignal): Promise<Probe> {
  const script = [
    "import importlib.util, json",
    'print(json.dumps({name: importlib.util.find_spec(name) is not None for name in ["pymysql", "psycopg2", "dmPython"]}))',
  ].join("\n")

  try {
    const version = await capture(python, ["--version"], signal)
    const drivers = await capture(python, ["-c", script], signal)
    return {
      python,
      version: version.stdout.trim().split("\n")[0],
      drivers: JSON.parse(drivers.stdout.trim() || "{}") as Record<string, boolean>,
    }
  } catch (error) {
    return { python, drivers: {}, error: error instanceof Error ? error.message : String(error) }
  }
}

async function capture(python: string, args: string[], signal?: AbortSignal) {
  const proc = spawn(python, args, { ...process.env })
  proc.stdin?.end()
  const [stdout, stderr, exitCode] = await Promise.all([readCapped(proc.stdout, 8_000), readCapped(proc.stderr, 8_000), proc.exited])
  if (signal?.aborted) throw new Error("已取消。")
  if (exitCode !== 0) throw new Error(stderr.text.trim() || `${python} 退出码 ${exitCode}`)
  return { stdout: stdout.text, stderr: stderr.text }
}
