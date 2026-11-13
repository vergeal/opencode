import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { deflateRawSync } from "node:zlib"
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

/** A shell stand-in for uv: it answers `--version`, reports its environment, and fails with a marker otherwise. */
function stubUv() {
  return [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "uv 0.0.0"; exit 0; fi',
    'echo "stub uv: $* | $UV_PYTHON_INSTALL_MIRROR | $UV_DEFAULT_INDEX | $UV_INDEX_URL" >&2',
    "exit 1",
    "",
  ].join("\n")
}

/** Writes the stub where a test needs it and makes it runnable. */
async function stubAt(file: string) {
  await writeFile(file, stubUv())
  await chmod(file, 0o755)
  return file
}

const UV_TEST_VERSION = "0.13.8"

/**
 * A release archive shaped like uv's own: one top-level directory holding the executable. The stub inside stands in for
 * the binary, so the download path is exercised without fetching anything.
 */
async function releaseArchive(directory: string, name: string) {
  const top = name.replace(/\.(tar\.gz|zip)$/, "")
  const staging = path.join(directory, "release")
  await mkdir(path.join(staging, top), { recursive: true })
  await stubAt(path.join(staging, top, name.endsWith(".zip") ? "uv.exe" : "uv"))
  const file = path.join(directory, name)
  const archived = name.endsWith(".zip")
    ? Bun.spawnSync(["zip", "-q", "-r", "-X", file, top], { cwd: staging })
    : Bun.spawnSync(["tar", "-czf", file, "-C", staging, top])
  if (archived.exitCode !== 0) throw new Error(archived.stderr.toString())
  return new Uint8Array(await Bun.file(file).arrayBuffer())
}

/** A one-entry zip, enough to exercise the central directory path a Windows release goes through. */
function zipWith(name: string, content: Uint8Array) {
  const nameBytes = new TextEncoder().encode(name)
  const deflated = new Uint8Array(deflateRawSync(content))
  const local = new Uint8Array(30 + nameBytes.length)
  const localView = new DataView(local.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(4, 20, true)
  localView.setUint16(8, 8, true)
  localView.setUint32(14, 0, true)
  localView.setUint32(18, deflated.length, true)
  localView.setUint32(22, content.length, true)
  localView.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)

  const central = new Uint8Array(46 + nameBytes.length)
  const centralView = new DataView(central.buffer)
  centralView.setUint32(0, 0x02014b50, true)
  centralView.setUint16(4, 20, true)
  centralView.setUint16(6, 20, true)
  centralView.setUint16(10, 8, true)
  centralView.setUint32(20, deflated.length, true)
  centralView.setUint32(24, content.length, true)
  centralView.setUint16(28, nameBytes.length, true)
  centralView.setUint32(42, 0, true)
  central.set(nameBytes, 46)

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, 1, true)
  endView.setUint16(10, 1, true)
  endView.setUint32(12, central.length, true)
  endView.setUint32(16, local.length + deflated.length, true)

  const total = new Uint8Array(local.length + deflated.length + central.length + end.length)
  total.set(local, 0)
  total.set(deflated, local.length)
  total.set(central, local.length + deflated.length)
  total.set(end, local.length + deflated.length + central.length)
  return total
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

  it("downloads uv from the mirror when the machine has neither", async () => {
    await using root = await home()
    await using build = await home()
    const requests: string[] = []
    let archive: Uint8Array | undefined
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async () => false,
        download: async (url) => {
          requests.push(url)
          if (url.endsWith(".sha256")) throw new Error("this source has no checksum")
          archive ??= await releaseArchive(build.path, url.split("/").pop()!)
          return archive
        },
      },
    })

    expect(requests[0]).toMatch(
      new RegExp(
        `^https://mirrors\\.ustc\\.edu\\.cn/github-release/astral-sh/uv/${UV_TEST_VERSION}/uv-[a-z0-9_-]+\\.${process.platform === "win32" ? "zip" : "tar\\.gz"}$`,
      ),
    )
    // The asset and its checksum, and no request to the proxy or GitHub.
    expect(requests).toHaveLength(2)
    const target = path.join(root.path, ".opencode", "bin", process.platform === "win32" ? "uv.exe" : "uv")
    expect(existsSync(target)).toBe(true)
    // The stub answers `--version` but cannot create a venv, so this proves the extracted binary was executed.
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

  it("falls back to the system python3 when the mirror, the proxy and GitHub all fail", async () => {
    await using root = await home()
    const requests: string[] = []
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async () => false,
        download: async (url) => {
          requests.push(url)
          throw new Error("offline")
        },
      },
    })
    expect(runtime).toEqual({ status: "ready" })
    expect(requests).toHaveLength(3)
    expect(requests[0]).toStartWith("https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/")
    expect(requests[1]).toStartWith("https://gh-proxy.com/https://github.com/astral-sh/uv/releases/download/")
    expect(requests[2]).toStartWith("https://github.com/astral-sh/uv/releases/download/")
  }, 120_000)

  it("names every failed source and the system python when nothing works", async () => {
    await using root = await home()
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=99.0" },
      uv: {
        which: async () => false,
        download: async (url) => {
          throw new Error(`offline ${new URL(url).host}`)
        },
      },
    })
    expect(runtime.status).toBe("failed")
    const error = runtime.status === "failed" ? runtime.error : ""
    expect(error).toContain(">=99.0")
    expect(error).toContain("this machine has")
    expect(error).toContain("no mirror or official release delivered uv")
    expect(error).toContain("mirrors.ustc.edu.cn")
    expect(error).toContain("gh-proxy.com")
    expect(error).toContain("github.com")
  }, 120_000)

  it("downloads from OPENCODE_UV_MIRROR when it is set", async () => {
    await using root = await home()
    const requests: string[] = []
    const previous = process.env.OPENCODE_UV_MIRROR
    process.env.OPENCODE_UV_MIRROR = "https://mirror.example"
    try {
      await prepare({
        home: root.path,
        id: "acme.data",
        runtime: { python: ">=99.0" },
        uv: {
          which: async () => false,
          download: async (url) => {
            requests.push(url)
            throw new Error("offline")
          },
        },
      })
      expect(requests[0]).toStartWith(
        `https://mirror.example/github-release/astral-sh/uv/${UV_TEST_VERSION}/uv-`,
      )
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_UV_MIRROR
      else process.env.OPENCODE_UV_MIRROR = previous
    }
  }, 120_000)

  it("treats a mismatched checksum as a failed source", async () => {
    await using root = await home()
    await using build = await home()
    const requests: string[] = []
    let archive: Uint8Array | undefined
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async () => false,
        download: async (url) => {
          requests.push(url)
          if (url.endsWith(".sha256")) {
            // The mirror publishes a checksum that cannot match, so the proxy has to serve the asset instead.
            if (url.startsWith("https://mirrors.ustc.edu.cn")) return new TextEncoder().encode(`${"0".repeat(64)}  x\n`)
            throw new Error("this source has no checksum")
          }
          archive ??= await releaseArchive(build.path, url.split("/").pop()!)
          return archive
        },
      },
    })

    expect(requests[0]).toStartWith("https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/")
    expect(requests).toContain(
      `https://gh-proxy.com/https://github.com/astral-sh/uv/releases/download/${UV_TEST_VERSION}/${requests[0].split("/").pop()}`,
    )
    expect(runtime.status).toBe("failed")
    expect(runtime.status === "failed" && runtime.error).toContain("stub uv: venv")
  }, 120_000)

  it("hands the mirrors to uv", async () => {
    await using root = await home()
    const explicit = await stubAt(path.join(root.path, "uv"))
    const previous = process.env.OPENCODE_UV_PATH
    process.env.OPENCODE_UV_PATH = explicit
    try {
      // The stub prints its environment, which is the only place the child process can prove what it received.
      const runtime = await prepare({
        home: root.path,
        id: "acme.data",
        runtime: { python: ">=3.9" },
        uv: { which: async (command) => command === explicit },
      })
      const error = runtime.status === "failed" ? (runtime.error ?? "") : ""
      expect(error).toContain("https://mirrors.ustc.edu.cn/github-release/astral-sh/python-build-standalone")
      // Both index names, because an older uv on PATH reads the one 0.13 renamed.
      expect(error.split("https://mirrors.ustc.edu.cn/pypi/simple")).toHaveLength(3)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_UV_PATH
      else process.env.OPENCODE_UV_PATH = previous
    }
  }, 120_000)

  it("hands the index to the fallback pip", async () => {
    await using root = await home()
    const previous = process.env.OPENCODE_PYPI_INDEX
    // A `file:` index keeps pip off the network while still printing the index it was told to use.
    process.env.OPENCODE_PYPI_INDEX = "file:///nonexistent-opencode-index"
    try {
      const runtime = await prepare({
        home: root.path,
        id: "acme.data",
        runtime: { python: ">=3.9", dependencies: ["demo"] },
        uv: {
          which: async () => false,
          download: async () => {
            throw new Error("offline")
          },
        },
      })
      expect(runtime.status).toBe("failed")
      expect(runtime.status === "failed" && runtime.error).toContain("file:///nonexistent-opencode-index")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_PYPI_INDEX
      else process.env.OPENCODE_PYPI_INDEX = previous
    }
  }, 180_000)

  it("unpacks a Windows zip release without Bun.Archive", async () => {
    await using root = await home()
    const content = new TextEncoder().encode(stubUv())
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async () => false,
        platform: "win32",
        arch: "x64",
        download: async (url) => {
          if (url.endsWith(".sha256")) throw new Error("this source has no checksum")
          return zipWith("uv-x86_64-pc-windows-msvc/uv.exe", content)
        },
      },
    })
    const target = path.join(root.path, ".opencode", "bin", "uv.exe")
    expect(existsSync(target)).toBe(true)
    // Byte for byte, because the entry stores a deflated range rather than a path.
    expect(new Uint8Array(await Bun.file(target).arrayBuffer())).toEqual(content)
    expect(runtime.status).toBe("failed")
    expect(runtime.status === "failed" && runtime.error).toContain("stub uv: venv")
  }, 120_000)

  it("treats a truncated zip as a failed source instead of throwing", async () => {
    await using root = await home()
    const content = new TextEncoder().encode(stubUv())
    const full = zipWith("uv-x86_64-pc-windows-msvc/uv.exe", content)
    const requests: string[] = []
    const runtime = await prepare({
      home: root.path,
      id: "acme.data",
      runtime: { python: ">=3.9" },
      uv: {
        which: async () => false,
        platform: "win32",
        arch: "x64",
        download: async (url) => {
          requests.push(url)
          if (url.endsWith(".sha256")) throw new Error("this source has no checksum")
          return full.subarray(0, full.length - 10)
        },
      },
    })
    // The central directory is gone, so each source fails and the system interpreter takes over. Each source answers
    // its asset request, then its checksum request, which the stub refuses.
    expect(runtime).toEqual({ status: "ready" })
    expect(requests).toHaveLength(6)
  }, 120_000)

  it("maps each platform to the release uv publishes for it", async () => {
    const cases = [
      ["darwin", "arm64", "uv-aarch64-apple-darwin.tar.gz"],
      ["darwin", "x64", "uv-x86_64-apple-darwin.tar.gz"],
      ["linux", "arm64", "uv-aarch64-unknown-linux-gnu.tar.gz"],
      ["linux", "x64", "uv-x86_64-unknown-linux-gnu.tar.gz"],
      ["win32", "x64", "uv-x86_64-pc-windows-msvc.zip"],
    ] as const
    for (const [platform, arch, name] of cases) {
      await using root = await home()
      const requests: string[] = []
      await prepare({
        home: root.path,
        id: "acme.data",
        runtime: { python: ">=99.0" },
        uv: {
          which: async () => false,
          platform,
          arch,
          download: async (url) => {
            requests.push(url)
            throw new Error("offline")
          },
        },
      })
      expect(requests[0]).toBe(`https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/${UV_TEST_VERSION}/${name}`)
    }
  }, 120_000)
})
