export * as PluginRuntime from "./runtime.js"

import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "@opencode/schema/plugin"
import type { PluginManifest } from "@opencode/schema/plugin-manifest"
import { Effect } from "effect"
import { compareVersions } from "./local.js"
import { PluginPaths } from "./paths.js"

/** The uv release the host downloads when the machine has none. Pinned so one code revision prepares one environment. */
const UV_VERSION = "0.13.8"

/**
 * The release asset for a platform and architecture. uv publishes no build for the rest, and guessing a target would
 * download a binary that cannot run there, so those combinations use the system interpreter instead.
 */
const UV_TARGETS: Readonly<Record<string, string>> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
}

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
  /**
   * Test seam: what this machine appears to have and where a release asset comes from, so a test can exercise every
   * branch without touching `PATH` or the network. Production callers omit it.
   */
  readonly uv?: {
    /** Same question as looking up a command: can this executable name or path run? */
    readonly which?: (command: string) => Promise<boolean>
    /** Serves a release asset by name instead of downloading it. */
    readonly download?: (asset: string) => Promise<Uint8Array>
  }
}): Effect.Effect<Plugin.Runtime> =>
  Effect.promise(async () => {
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
      ? await exec(uv, ["venv", "--python", minimum(target) ?? "python3", venv])
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
      const installed = uv
        ? await exec(uv, ["pip", "install", "--python", python, ...dependencies])
        : await exec(python, ["-m", "pip", "install", ...dependencies])
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

/**
 * The `uv` to prepare with. A copy the user already has always wins: an explicit path, then `PATH`, then a release the
 * host downloads once. The last step is what lets a machine with neither `uv` nor a matching `python3` still prepare a
 * runtime, and it answers the reason instead of throwing so the caller can fall back to the system interpreter.
 */
async function findUv(input: {
  readonly home: string
  readonly uv?: {
    readonly which?: (command: string) => Promise<boolean>
    readonly download?: (asset: string) => Promise<Uint8Array>
  }
}): Promise<{ readonly command: string } | { readonly error: string }> {
  const which = input.uv?.which ?? available
  const explicit = process.env.OPENCODE_UV_PATH?.trim()
  if (explicit && (await which(explicit))) return { command: explicit }
  if (await which("uv")) return { command: "uv" }
  return download(input)
}

async function download(input: {
  readonly home: string
  readonly uv?: {
    readonly which?: (command: string) => Promise<boolean>
    readonly download?: (asset: string) => Promise<Uint8Array>
  }
}): Promise<{ readonly command: string } | { readonly error: string }> {
  const asset = uvAsset()
  if (!asset) return { error: `uv publishes no release for ${process.platform}/${process.arch}` }
  const directory = path.join(input.home, ".opencode", "bin")
  const target = path.join(directory, asset.executable)
  // A finished binary is the only answer needed, so two plugins preparing at once download once.
  if (await available(target)) return { command: target }

  // Executing what the host downloads carries the same trust as installing a plugin's declared dependencies: that is
  // what installing a plugin with a `runtime` means. The archive is unpacked and the binary is checked by running it,
  // so a truncated or wrong-architecture download answers a failure instead of leaving a path that cannot spawn.
  const staging = path.join(directory, `.uv-${crypto.randomUUID()}`)
  try {
    const bytes = input.uv?.download
      ? await input.uv.download(asset.name)
      : await release(process.env.OPENCODE_UV_VERSION?.trim() || UV_VERSION, asset.name)
    if (bytes.byteLength === 0) return { error: `${asset.name} was empty` }
    await mkdir(staging, { recursive: true })
    await new Bun.Archive(bytes).extract(staging)
    // The archive keeps its own top-level directory, like `uv-x86_64-apple-darwin/uv`.
    const nested = path.join(staging, asset.name.replace(/\.(tar\.gz|zip)$/, ""), asset.executable)
    const file = (await Bun.file(nested).exists()) ? nested : path.join(staging, asset.executable)
    if (!(await Bun.file(file).exists())) return { error: `${asset.name} had no ${asset.executable}` }
    await mkdir(directory, { recursive: true })
    if (process.platform !== "win32") await chmod(file, 0o755)
    // A rename is atomic, so a concurrent prepare that finishes first leaves the same binary behind.
    await rename(file, target).catch(() => undefined)
    if (!(await available(target))) return { error: `${target} did not run` }
    return { command: target }
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** The release asset that matches this machine, or undefined when uv publishes none it can run. */
function uvAsset() {
  const target = UV_TARGETS[`${process.platform}-${process.arch}`]
  if (!target) return undefined
  const windows = process.platform === "win32"
  return { name: `uv-${target}.${windows ? "zip" : "tar.gz"}`, executable: windows ? "uv.exe" : "uv" }
}

async function release(version: string, asset: string) {
  const response = await fetch(`https://github.com/astral-sh/uv/releases/download/${version}/${asset}`)
  if (!response.ok) throw new Error(`downloading ${asset} answered ${response.status} ${response.statusText}`)
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
async function exec(command: string, args: string[]): Promise<Executed> {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
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
