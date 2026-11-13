import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
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

/** A shell stand-in for uv: it answers `--version`, and every other invocation fails with a marker a test can find. */
function stubUv() {
  return ['#!/bin/sh', 'if [ "$1" = "--version" ]; then echo "uv 0.0.0"; exit 0; fi', 'echo "stub uv: $*" >&2', "exit 1", ""].join(
    "\n",
  )
}

/** Writes the stub where a test needs it and makes it runnable. */
async function stubAt(file: string) {
  await writeFile(file, stubUv())
  await chmod(file, 0o755)
  return file
}

/**
 * A release archive shaped like uv's own: one top-level directory holding the executable. The stub inside stands in for
 * the binary, so the download path is exercised without fetching anything.
 */
async function releaseArchive(directory: string, name: string) {
  const top = name.replace(/\.(tar\.gz|zip)$/, "")
  const staging = path.join(directory, "release", top)
  await mkdir(staging, { recursive: true })
  const executable = process.platform === "win32" ? "uv.exe" : "uv"
  await stubAt(path.join(staging, executable))
  const file = path.join(directory, name)
  const archived = Bun.spawnSync(["tar", "-czf", file, "-C", path.join(directory, "release"), top])
  if (archived.exitCode !== 0) throw new Error(archived.stderr.toString())
  return new Uint8Array(await Bun.file(file).arrayBuffer())
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

describe("PluginRuntime.prepare uv resolution", () => {
  it("uses OPENCODE_UV_PATH without downloading", async () => {
    await using root = await home()
    const explicit = await stubAt(path.join(root.path, "uv"))
    const previous = process.env.OPENCODE_UV_PATH
    let downloads = 0
    process.env.OPENCODE_UV_PATH = explicit
    try {
      const runtime = await prepare({
        home: root.path,
        id: "acme.data",
        runtime: { python: ">=3.9" },
        uv: {
          which: async (command) => command === explicit,
          download: async () => {
            downloads++
            throw new Error("unused")
          },
        },
      })
      expect(downloads).toBe(0)
      // The stub cannot create a venv, so the failure comes from running it, not from failing to find uv.
      expect(runtime.status).toBe("failed")
      expect(runtime.status === "failed" && runtime.error).toContain("stub uv: venv")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_UV_PATH
      else process.env.OPENCODE_UV_PATH = previous
    }
  }, 120_000)

  it("uses the uv on PATH without downloading", async () => {
    await using root = await home()
    let downloads = 0
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async (command) => command === "uv",
        download: async () => {
          downloads++
          throw new Error("unused")
        },
      },
    })
    expect(downloads).toBe(0)
    // Whether this machine has a real uv or not, the failure must not be the one about finding it.
    if (runtime.status === "failed") expect(runtime.error).not.toContain("uv could not be used")
  }, 120_000)

  it("downloads uv into ~/.opencode/bin when the machine has neither", async () => {
    await using root = await home()
    await using build = await home()
    const assets: string[] = []
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async () => false,
        download: async (asset) => {
          assets.push(asset)
          return releaseArchive(build.path, asset)
        },
      },
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatch(/^uv-(aarch64|x86_64)-/)
    expect(assets[0]).toMatch(process.platform === "win32" ? /\.zip$/ : /\.tar\.gz$/)
    const target = path.join(root.path, ".opencode", "bin", process.platform === "win32" ? "uv.exe" : "uv")
    expect(existsSync(target)).toBe(true)
    // The downloaded stub answers `--version` but cannot create a venv, so this proves it was executed.
    expect(runtime.status).toBe("failed")
    expect(runtime.status === "failed" && runtime.error).toContain("stub uv: venv")
  }, 120_000)

  it("does not download when ~/.opencode/bin/uv already runs", async () => {
    await using root = await home()
    const bin = path.join(root.path, ".opencode", "bin")
    await mkdir(bin, { recursive: true })
    await stubAt(path.join(bin, process.platform === "win32" ? "uv.exe" : "uv"))
    let downloads = 0
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async () => false,
        download: async () => {
          downloads++
          throw new Error("unused")
        },
      },
    })
    expect(downloads).toBe(0)
    expect(runtime.status).toBe("failed")
    expect(runtime.status === "failed" && runtime.error).toContain("stub uv: venv")
  }, 120_000)

  it("falls back to the system python3 when the download fails", async () => {
    await using root = await home()
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async () => false,
        download: async () => {
          throw new Error("offline")
        },
      },
    })
    expect(runtime).toEqual({ status: "ready" })
  }, 120_000)

  it("names both failures when neither uv nor a matching python3 is available", async () => {
    await using root = await home()
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=99.0" },
      uv: {
        which: async () => false,
        download: async () => {
          throw new Error("offline")
        },
      },
    })
    expect(runtime.status).toBe("failed")
    expect(runtime.status === "failed" && runtime.error).toContain(">=99.0")
    expect(runtime.status === "failed" && runtime.error).toContain("this machine has")
    expect(runtime.status === "failed" && runtime.error).toContain("offline")
  }, 120_000)
})
