import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { PluginRuntime } from "@opencode/core/plugin/runtime"

/** An isolated `home`, so every test's environment directory is its own. */
async function home() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "opencode-plugin-runtime-")))
  return { path: root, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

const prepare = (input: Parameters<typeof PluginRuntime.prepare>[0]) =>
  Effect.runPromise(PluginRuntime.prepare(input))
const detect = (input: Parameters<typeof PluginRuntime.detect>[0]) => Effect.runPromise(PluginRuntime.detect(input))

/**
 * A pure-Python wheel built by hand, so installing a dependency needs neither a build backend nor the network. The
 * archive is what `pip install` accepts as a requirement.
 */
async function wheel(directory: string) {
  const staging = path.join(directory, "wheel")
  const dist = path.join(staging, "demo-0.0.1.dist-info")
  await mkdir(dist, { recursive: true })
  await mkdir(path.join(staging, "demo"), { recursive: true })
  await writeFile(path.join(staging, "demo", "__init__.py"), "VALUE = 42\n")
  await writeFile(
    path.join(dist, "METADATA"),
    "Metadata-Version: 2.1\nName: demo\nVersion: 0.0.1\n",
  )
  await writeFile(
    path.join(dist, "WHEEL"),
    "Wheel-Version: 1.0\nGenerator: opencode-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
  )
  await writeFile(
    path.join(dist, "RECORD"),
    [
      "demo/__init__.py,,",
      "demo-0.0.1.dist-info/METADATA,,",
      "demo-0.0.1.dist-info/WHEEL,,",
      "demo-0.0.1.dist-info/RECORD,,",
      "",
    ].join("\n"),
  )
  const file = path.join(directory, "demo-0.0.1-py3-none-any.whl")
  const zipped = Bun.spawnSync(["zip", "-q", "-r", file, "demo", "demo-0.0.1.dist-info"], { cwd: staging })
  if (zipped.exitCode !== 0) throw new Error(zipped.stderr.toString())
  return file
}

describe("PluginRuntime.requirementHash", () => {
  it("ignores order and surrounding space, and changes with the requirement", () => {
    expect(PluginRuntime.requirementHash({ dependencies: ["psycopg2-binary>=2.9", " pymysql>=1.0 "] })).toBe(
      PluginRuntime.requirementHash({ dependencies: ["pymysql>=1.0", "psycopg2-binary>=2.9"] }),
    )
    expect(PluginRuntime.requirementHash({ python: ">=3.10" })).not.toBe(
      PluginRuntime.requirementHash({ python: ">=3.11" }),
    )
    expect(PluginRuntime.requirementHash({ dependencies: ["demo"] })).not.toBe(
      PluginRuntime.requirementHash({ dependencies: ["demo", "other"] }),
    )
  })
})

describe("PluginRuntime.detect", () => {
  it("reports a missing environment before anything prepared it", async () => {
    await using root = await home()
    const input = { home: root.path, id: "acme.data", runtime: { python: ">=3.9" } }
    expect(await detect(input)).toBe("missing")
  })

  it("reports missing when the requirement changed since it prepared", async () => {
    await using root = await home()
    const input = { home: root.path, id: "acme.data", runtime: { python: ">=3.9" } }
    expect(await prepare(input)).toEqual({ status: "ready" })
    expect(await detect(input)).toBe("ready")
    expect(await detect({ ...input, runtime: { python: ">=3.9", dependencies: [await wheel(root.path)] } })).toBe(
      "missing",
    )
  }, 120_000)
})

describe("PluginRuntime.prepare", () => {
  it("creates one venv per plugin, outside the system interpreters", async () => {
    await using root = await home()
    const input = { home: root.path, id: "acme.data", runtime: { python: ">=3.9" } }
    expect(await prepare(input)).toEqual({ status: "ready" })
    const directory = PluginRuntime.directory(input)
    expect(directory).toBe(path.join(root.path, ".opencode", "plugin-runtime", "acme.data"))
    expect(existsSync(path.join(directory, "bin", "python")) || existsSync(path.join(directory, "Scripts", "python.exe"))).toBe(
      true,
    )
    expect(existsSync(path.join(directory, "runtime.json"))).toBe(true)
    // A scoped id stays one directory name.
    expect(PluginRuntime.directory({ home: root.path, id: "@acme/data" })).toBe(
      path.join(root.path, ".opencode", "plugin-runtime", "@acme+data"),
    )
  }, 120_000)

  it("installs the declared dependencies where the plugin can import them", async () => {
    await using root = await home()
    await using build = await home()
    const requirement = await wheel(build.path)
    const input = { home: root.path, id: "acme.data", runtime: { python: ">=3.9", dependencies: [requirement] } }
    expect(await prepare(input)).toEqual({ status: "ready" })
    expect(await detect(input)).toBe("ready")

    const python = path.join(PluginRuntime.directory(input), "bin", "python")
    const imported = Bun.spawnSync([python, "-c", "import demo; print(demo.VALUE)"])
    expect(imported.exitCode).toBe(0)
    expect(imported.stdout.toString().trim()).toBe("42")
  }, 120_000)

  it("fails with the required and actual versions when no interpreter can satisfy it", async () => {
    await using root = await home()
    const input = { home: root.path, id: "acme.future", runtime: { python: ">=99.0" } }
    const runtime = await prepare(input)
    expect(runtime.status).toBe("failed")
    expect(runtime.error).toContain(">=99.0")
    expect(runtime.error).toContain("this machine has")
    expect(runtime.ref).toStartWith("err_")
    // A failed preparation leaves nothing usable behind.
    expect(await detect(input)).toBe("missing")
  }, 120_000)

  it("can prepare again after a failure", async () => {
    await using root = await home()
    const failed = await prepare({ home: root.path, id: "acme.data", runtime: { python: ">=99.0" } })
    expect(failed.status).toBe("failed")
    const retried = await prepare({ home: root.path, id: "acme.data", runtime: { python: ">=3.9" } })
    expect(retried).toEqual({ status: "ready" })
  }, 120_000)

  it("treats a runtime with no constraint and no dependencies as ready", async () => {
    await using root = await home()
    const input = { home: root.path, id: "acme.data", runtime: {} }
    expect(await prepare(input)).toEqual({ status: "ready" })
    expect(await detect(input)).toBe("ready")
  }, 120_000)
})
