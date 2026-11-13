export * as PluginRuntime from "./runtime.js"

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { inflateRawSync } from "node:zlib"
import type { Plugin } from "@opencode/schema/plugin"
import type { PluginManifest } from "@opencode/schema/plugin-manifest"
import { Effect } from "effect"
import { compareVersions } from "./local.js"
import { PluginPaths } from "./paths.js"

/**
 * The uv release the host downloads when the machine has none. Pinned so one code revision prepares one environment;
 * `OPENCODE_UV_VERSION` picks another.
 */
const UV_VERSION = "0.13.8"

/**
 * The release target for a platform and architecture. uv publishes no build for the rest, and guessing one would
 * download a binary that cannot run there, so those combinations use the system interpreter instead.
 */
const UV_TARGETS: Readonly<Record<string, string>> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
}

/** Mirrors the GitHub release assets, tried first so a machine in China never needs the official host. */
const UV_MIRROR = "https://mirrors.ustc.edu.cn"

/** Stands in for the official download host, so uv fetches CPython from China too. */
const PYTHON_MIRROR = "https://mirrors.ustc.edu.cn/github-release/astral-sh/python-build-standalone"

/** The package index, which is also what the fallback `pip` installs from. */
const PYPI_INDEX = "https://mirrors.ustc.edu.cn/pypi/simple"

/**
 * Each plugin's interpreter environment lives under the same `~/.opencode` root as installed bundles, one directory
 * per id, next to the other per-plugin directories so uninstall removes it with them. Nothing here touches the
 * system's site-packages.
 */
export function directory(input: { readonly home: string; readonly id: string }) {
  return PluginPaths.make(input).runtime
}

/**
 * The identity of an environment: the interpreter constraint and the normalized dependency list. A manifest edit that
 * changes either one makes the existing environment stale, so the host prepares it again.
 */
export function requirementHash(runtime: PluginManifest.Runtime) {
  const dependencies = (runtime.dependencies ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
  return createHash("sha256")
    .update(JSON.stringify({ python: runtime.python?.trim() ?? "", dependencies }))
    .digest("hex")
}

/** Whether the plugin's environment can be used as it is. A `missing` answer is what prompts `prepare`. */
export const detect = (input: {
  readonly home: string
  readonly id: string
  readonly runtime: PluginManifest.Runtime
}): Effect.Effect<"ready" | "missing"> =>
  Effect.promise(async () => {
    const python = venvPython(directory(input))
    if (!existsSync(python)) return "missing"
    const marker = await readMarker(directory(input))
    if (!marker || marker.hash !== requirementHash(input.runtime)) return "missing"
    const actual = await version(python)
    if (!actual || !satisfies(actual, input.runtime.python)) return "missing"
    return "ready"
  })

/**
 * Creates the plugin's environment: its own venv, then its dependencies. `uv` is preferred because it resolves and
 * installs quickly; the platform's `python3` is the fallback, and its version is checked against the manifest first.
 *
 * `pip install` runs each package's build steps, so installing a plugin's declared dependencies executes whatever
 * that package ships. This is the same trust the plugin itself already has: a plugin runs with the host's
 * permissions, and its dependencies are part of what installing it means.
 */
export const prepare = (input: {
  readonly home: string
  readonly id: string
  readonly runtime: PluginManifest.Runtime
  /** Reports each step as it starts, so a list can show progress instead of one long "preparing". */
  readonly onPhase?: (phase: "runtime" | "dependencies") => void
  /**
   * Test seam: what this machine appears to have and where a release asset comes from, so a test can exercise every
   * branch without touching `PATH` or the network. Production callers omit it.
   */
  readonly uv?: UvSeam
}): Effect.Effect<Plugin.Runtime> =>
  Effect.promise(async () => {
    // Announced before anything else: acquiring uv can download a release and fall back through two mirrors, which is
    // the longest quiet stretch of a first install. A failure that follows still reported the step it was on.
    input.onPhase?.("runtime")
    const target = input.runtime.python
    const resolved = await findUv(input)
    const uv = "command" in resolved ? resolved.command : undefined
    const fallback = uv ? undefined : await python3()
    const mismatch = fallback && !satisfies(fallback.version, target) ? fallback : undefined
    if (!uv && (!fallback || mismatch))
      return failure(
        input,
        `Plugin ${input.id} needs Python ${target ?? "any"}; this machine has ${fallback?.version ?? "no python3"}, and uv could not be used: ${"error" in resolved ? resolved.error : "not found"}. Install a matching Python or let the host download uv, then retry.`,
      )

    const venv = directory(input)
    await rm(venv, { recursive: true, force: true })
    await mkdir(path.dirname(venv), { recursive: true })

    // `uv --python` takes a version request, not a comparison, so it gets the constraint's minimum.
    const created = uv
      ? await exec(uv, ["venv", "--python", minimum(target) ?? "python3", venv], uvEnvironment())
      : await exec(fallback!.file, ["-m", "venv", venv])
    if (!created.ok) {
      const system = fallback ?? (await python3())
      return failure(
        input,
        `Plugin ${input.id} needs Python ${target ?? "any"}; this machine has ${system?.version ?? "no python3"}. ${created.message}`,
      )
    }

    const python = venvPython(venv)
    const actual = await version(python)
    if (!actual || !satisfies(actual, target))
      return failure(
        input,
        `Plugin ${input.id} needs Python ${target ?? "any"}, but its environment has ${actual ?? "no working python"}.`,
      )

    const dependencies = (input.runtime.dependencies ?? []).map((item) => item.trim()).filter(Boolean)
    if (dependencies.length > 0) {
      input.onPhase?.("dependencies")
      const installed = uv
        ? await exec(uv, ["pip", "install", "--python", python, ...dependencies], uvEnvironment())
        : await exec(python, ["-m", "pip", "install", ...dependencies], { PIP_INDEX_URL: pypiIndex() })
      if (!installed.ok)
        return failure(input, `Could not install dependencies for ${input.id}: ${installed.message}`)
    }

    await writeFile(
      path.join(venv, "runtime.json"),
      JSON.stringify(
        {
          hash: requirementHash(input.runtime),
          version: actual,
          interpreter: uv ? "uv" : fallback?.file,
          preparedAt: Date.now(),
        },
        null,
        2,
      ) + "\n",
    )
    return { status: "ready" }
  })

function failure(input: { readonly id: string }, error: string): Plugin.Runtime {
  return { status: "failed", error, ref: `err_${createHash("sha256").update(input.id + error).digest("hex").slice(0, 8)}` }
}

type Marker = { hash?: unknown; version?: unknown; interpreter?: unknown; preparedAt?: unknown }

function readMarker(directory: string): Promise<Marker | undefined> {
  return readFile(path.join(directory, "runtime.json"), "utf8").then(
    (text) => JSON.parse(text) as Marker,
    () => undefined,
  )
}

function venvPython(directory: string) {
  return process.platform === "win32" ? path.join(directory, "Scripts", "python.exe") : path.join(directory, "bin", "python")
}

/**
 * The prepared interpreter for a plugin, or undefined when there is none to hand out. The caller only needs a path it
 * can spawn, so an environment that is missing or still being prepared answers undefined rather than a broken path.
 */
export function python(input: { readonly home: string; readonly id: string }): string | undefined {
  const file = venvPython(directory(input))
  return existsSync(file) ? file : undefined
}

/** Test seam: what the machine appears to have, and where a release asset comes from. Production callers omit it. */
type UvSeam = {
  /** Same question as looking up a command: can this executable name or path run? */
  readonly which?: (command: string) => Promise<boolean>
  /** Serves a URL instead of downloading it. */
  readonly download?: (url: string) => Promise<Uint8Array>
  /** The machine to fetch a release for, so a test can exercise another platform's asset. */
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

/**
 * Removes the interpreter environment and cache a previous drive left behind. Only the rebuildable half moves, so
 * `data` and the log are never touched.
 */
export async function discard(input: {
  readonly home: string
  readonly id: string
  /** Test seam. Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform
  /** Test seam. Defaults to probing `D:\`. */
  readonly drive?: boolean
}) {
  const previous = PluginPaths.legacy(input)
  if (!previous) return
  await discardPaths(previous)
}

/** Removes the two rebuildable directories a drive change left behind. */
export async function discardPaths(previous: { readonly cache: string; readonly runtime: string }) {
  await Promise.all([
    rm(previous.cache, { recursive: true, force: true }),
    rm(previous.runtime, { recursive: true, force: true }),
  ])
}

/**
 * The `uv` to prepare with. A copy the user already has always wins: an explicit path, then `PATH`, then a release the
 * host downloads once. The last step is what lets a machine with neither `uv` nor a matching `python3` still prepare a
 * runtime, and it answers the reason instead of throwing so the caller can fall back to the system interpreter.
 */
async function findUv(input: {
  readonly home: string
  readonly uv?: UvSeam
}): Promise<{ readonly command: string } | { readonly error: string }> {
  const which = input.uv?.which ?? available
  const explicit = process.env.OPENCODE_UV_PATH?.trim()
  if (explicit && (await which(explicit))) return { command: explicit }
  if (await which("uv")) return { command: "uv" }
  return download(input)
}

async function download(input: {
  readonly home: string
  readonly uv?: UvSeam
}): Promise<{ readonly command: string } | { readonly error: string }> {
  const platform = input.uv?.platform ?? process.platform
  const arch = input.uv?.arch ?? process.arch
  const asset = uvAsset(platform, arch)
  if (!asset) return { error: `uv publishes no release for ${platform}/${arch}` }
  const directory = path.join(input.home, ".opencode", "bin")
  const target = path.join(directory, asset.executable)
  // A finished binary is the only answer needed, so two plugins preparing at once download once.
  if (await available(target)) return { command: target }

  const version = process.env.OPENCODE_UV_VERSION?.trim() || UV_VERSION
  const get = input.uv?.download ?? release
  const staging = path.join(directory, `.uv-${crypto.randomUUID()}`)
  const failures: string[] = []

  // Executing what the host downloads carries the same trust as installing a plugin's declared dependencies: that is
  // what installing a plugin with a `runtime` means. The archive is unpacked and the binary is checked by running it,
  // so a truncated or wrong-architecture download answers a failure instead of leaving a path that cannot spawn.
  try {
    for (const url of uvUrls(version, asset.name)) {
      try {
        const bytes = await get(url)
        if (bytes.byteLength === 0) throw new Error("the download was empty")
        // A mirror that publishes a checksum must match it; one that does not is trusted by transport alone.
        const expected = await checksum(url, get)
        if (expected && createHash("sha256").update(bytes).digest("hex") !== expected)
          throw new Error(`sha256 mismatch, expected ${expected}`)
        await mkdir(staging, { recursive: true })
        // `Bun.Archive` reads tar only, so a Windows zip goes through the central directory instead.
        if (asset.name.endsWith(".zip")) {
          const data = unzipEntry(bytes, `scripts/${asset.executable}`) ?? unzipEntry(bytes, asset.executable)
          if (!data) throw new Error(`the archive has no ${asset.executable}`)
          await writeFile(path.join(staging, asset.executable), data)
        } else await new Bun.Archive(bytes).extract(staging)
        // The archive keeps its own top-level directory, like `uv-x86_64-apple-darwin/uv`.
        const nested = path.join(staging, `uv-${asset.target}`, asset.executable)
        const file = (await Bun.file(nested).exists()) ? nested : path.join(staging, asset.executable)
        if (!(await Bun.file(file).exists())) throw new Error(`the archive has no ${asset.executable}`)
        await mkdir(directory, { recursive: true })
        // Runnable on the machine that asked for it, whichever platform this process happens to run on.
        await chmod(file, 0o755)
        // A rename is atomic, so a concurrent prepare that finishes first leaves the same binary behind.
        await rename(file, target).catch(() => undefined)
        if (!(await available(target))) throw new Error(`${target} did not run`)
        return { command: target }
      } catch (cause) {
        failures.push(`${new URL(url).host}: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }

    return { error: `no mirror or official release delivered uv (${failures.join("; ")})` }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Where a release asset comes from, in order: the mirror, a proxy, then GitHub itself. */
function uvUrls(version: string, asset: string) {
  const mirror = uvMirror()
  return [
    ...(mirror ? [`${mirror}/github-release/astral-sh/uv/${version}/${asset}`] : []),
    `https://gh-proxy.com/https://github.com/astral-sh/uv/releases/download/${version}/${asset}`,
    `https://github.com/astral-sh/uv/releases/download/${version}/${asset}`,
  ]
}

/** The mirror to download from. An empty override asks for the proxy and the official host only. */
function uvMirror() {
  const override = process.env.OPENCODE_UV_MIRROR
  if (override === undefined) return UV_MIRROR
  return override.trim() || undefined
}

/** The checksum the source advertises for an asset, or undefined when it advertises none. */
async function checksum(url: string, get: (url: string) => Promise<Uint8Array>) {
  try {
    const text = new TextDecoder().decode(await get(`${url}.sha256`)).trim()
    return /^[0-9a-f]{64}/i.exec(text)?.[0].toLowerCase()
  } catch {
    return undefined
  }
}

/** The release asset for a machine, or undefined when uv publishes none it can run. */
function uvAsset(platform: NodeJS.Platform, arch: string) {
  const target = UV_TARGETS[`${platform}-${arch}`]
  if (!target) return undefined
  const windows = platform === "win32"
  return { target, name: `uv-${target}.${windows ? "zip" : "tar.gz"}`, executable: windows ? "uv.exe" : "uv" }
}

/**
 * Reads one entry out of a zip. A Windows uv release is a zip and `Bun.Archive` reads only tar, so the central
 * directory is walked by hand. The entry stores a deflated byte range rather than a path `Bun.Archive` could open.
 */
function unzipEntry(bytes: Uint8Array, endsWith: string): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  let end = -1
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset
      break
    }
  }
  if (end < 0) return undefined
  const count = view.getUint16(end + 10, true)
  let entry = view.getUint32(end + 16, true)
  for (let index = 0; index < count; index++) {
    if (view.getUint32(entry, true) !== 0x02014b50) return undefined
    const method = view.getUint16(entry + 10, true)
    const compressed = view.getUint32(entry + 20, true)
    const nameLength = view.getUint16(entry + 28, true)
    const extraLength = view.getUint16(entry + 30, true)
    const commentLength = view.getUint16(entry + 32, true)
    const local = view.getUint32(entry + 42, true)
    const name = decoder.decode(bytes.subarray(entry + 46, entry + 46 + nameLength))
    entry += 46 + nameLength + extraLength + commentLength
    if (!name.endsWith(endsWith)) continue
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = bytes.subarray(start, start + compressed)
    if (method === 0) return raw
    if (method === 8) return new Uint8Array(inflateRawSync(raw))
    return undefined
  }
  return undefined
}

/** The package index handed to uv and `pip`. An empty override asks for the official services instead. */
function pypiIndex() {
  const override = process.env.OPENCODE_PYPI_INDEX
  if (override === undefined) return PYPI_INDEX
  return override.trim() || undefined
}

function pythonMirror() {
  const override = process.env.OPENCODE_PYTHON_INSTALL_MIRROR
  if (override === undefined) return PYTHON_MIRROR
  return override.trim() || undefined
}

/** What uv needs to fetch CPython and packages from China. An old uv on `PATH` reads the older index name. */
function uvEnvironment() {
  const index = pypiIndex()
  return {
    UV_PYTHON_INSTALL_MIRROR: pythonMirror(),
    UV_DEFAULT_INDEX: index,
    UV_INDEX_URL: index,
  }
}

async function release(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`downloading ${new URL(url).pathname} answered ${response.status} ${response.statusText}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** The version a constraint names, without its operator. Only a lower bound is checked, as `requires.opencode` does. */
function minimum(constraint: string | undefined) {
  if (!constraint) return undefined
  return pad(constraint.replace(/^[\^~>=v\s]+/, ""))
}

/** `compareVersions` only orders three-part versions; a two-part constraint such as `>=3.9` needs its patch. */
function pad(version: string) {
  const [major = "0", minor = "0", patch = "0"] = version.split(".")
  return `${major}.${minor}.${patch}`
}

function satisfies(actual: string, constraint: string | undefined) {
  const least = minimum(constraint)
  if (!least) return true
  return compareVersions(pad(actual), least) >= 0
}

async function version(python: string) {
  const result = await exec(python, ["--version"])
  if (!result.ok) return undefined
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(result.stdout || result.stderr)
  return match ? match[0] : undefined
}

async function python3() {
  for (const candidate of process.platform === "win32" ? ["python", "python3"] : ["python3", "python"]) {
    const found = await exec(candidate, ["--version"])
    if (!found.ok) continue
    const match = /(\d+\.\d+(?:\.\d+)?)/.exec(found.stdout || found.stderr)
    if (match) return { file: candidate, version: match[1] }
  }
  return undefined
}

async function available(command: string) {
  return (await exec(command, ["--version"])).ok
}

type Executed = { ok: boolean; stdout: string; stderr: string; message: string }

/**
 * Runs one command and captures both streams. A missing executable is a normal answer here: the caller is choosing
 * between an optional tool and a fallback, so it must not fail the whole preparation.
 */
async function exec(
  command: string,
  args: string[],
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<Executed> {
  try {
    // A spawned process gets either the inherited environment or exactly what is passed, never a merge, so the added
    // values are layered on top; an undefined one means "use the default of the tool", as an empty override does.
    const env = environment && {
      ...process.env,
      ...Object.fromEntries(
        Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    }
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe", ...(env ? { env } : {}) })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return {
      ok: code === 0,
      stdout,
      stderr,
      message: (stderr || stdout).trim() || `${command} exited with ${code}`,
    }
  } catch (cause) {
    return { ok: false, stdout: "", stderr: "", message: cause instanceof Error ? cause.message : String(cause) }
  }
}
