import assert from "node:assert/strict"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"
import { Host } from "../src/host.js"

// Every entrypoint throws if evaluated: resolution must never execute plugins.
const source = 'throw new Error("Plugin code must not run during resolution")'
const name = "@fixture/plugin"

async function fixture(files: Record<string, string>, installed = false) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "opencode-host-")))
  const directory = installed ? path.join(root, "node_modules", name) : root
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
      await writeFile(path.join(directory, file), content)
    }),
  )
  return {
    target: { directory, ...(installed ? { name } : {}) },
    url: (file: string) => pathToFileURL(path.join(directory, file)).href,
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

function manifest(entry: Record<string, string>) {
  return JSON.stringify({ apiVersion: 1, id: name, version: "1.0.0", entry })
}

describe("Host.resolve", () => {
  it("resolves the parts its manifest declares", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({
        server: "server/main",
        tui: "tui/main",
        rpc: "rpc/main",
        gui: "gui/main",
      }),
      "server/main.ts": source,
      "tui/main.tsx": source,
      "rpc/main.ts": source,
      "gui/main.cjs": source,
      // Undeclared conventional names do not load.
      "index.ts": source,
    })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("server/main.ts"),
      tui: plugin.url("tui/main.tsx"),
      rpc: plugin.url("rpc/main.ts"),
      gui: plugin.url("gui/main.cjs"),
    })
  })

  it("tries a part's extensions in order", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({ server: "server/main" }),
      "server/main.js": source,
      "server/main.ts": source,
      "server/main.mjs": source,
    })
    assert.equal(Host.resolve(plugin.target).server, plugin.url("server/main.ts"))
  })

  it("keeps the output beside the sources when the manifest points there", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({ server: "dist/server/main" }),
      "dist/server/main.js": source,
    })
    assert.equal(Host.resolve(plugin.target).server, plugin.url("dist/server/main.js"))
  })

  it("loads a directory that has only a main entry", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({ server: "server/main" }),
      "server/main.ts": 'export const marker = "main"',
    })

    const server = Host.resolve(plugin.target).server
    assert.equal(server, plugin.url("server/main.ts"))
    assert.equal(((await Host.load(server!)) as { marker: string }).marker, "main")
  })

  it("still loads a directory that has only the legacy entry, and reports it as deprecated", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({}),
      "server/index.ts": 'export const marker = "legacy"',
    })

    const resolved = Host.resolve(plugin.target)
    assert.equal(resolved.server, plugin.url("server/index.ts"))
    assert.equal(((await Host.load(resolved.server!)) as { marker: string }).marker, "legacy")
    // The caller logs these; `resolve` reports what it fell back to and never writes to a UI.
    assert.deepEqual(resolved.deprecated, [{ kind: "server", found: "server/index", expected: "server/main" }])
  })

  it("prefers main over a legacy file, with no deprecation", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({ server: "server/main" }),
      "server/main.ts": 'export const marker = "main"',
      "server/index.ts": 'export const marker = "legacy"',
    })

    const resolved = Host.resolve(plugin.target)
    assert.equal(resolved.server, plugin.url("server/main.ts"))
    assert.equal(((await Host.load(resolved.server!)) as { marker: string }).marker, "main")
    assert.equal(resolved.deprecated, undefined)
  })

  it("tries the legacy paths in order when there is no manifest", async () => {
    await using plugin = await fixture({
      "server/index.ts": 'export const marker = "server/index"',
      "src/index.ts": 'export const marker = "src/index"',
      "index.ts": 'export const marker = "index"',
    })

    const resolved = Host.resolve(plugin.target)
    assert.equal(resolved.server, plugin.url("server/index.ts"))
    assert.equal(((await Host.load(resolved.server!)) as { marker: string }).marker, "server/index")
  })

  it("returns undefined for a declared entry whose file is missing and has no legacy replacement", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({ server: "server/main" }),
      "tui/index.ts": source,
    })

    const resolved = Host.resolve(plugin.target)
    assert.equal(resolved.server, undefined)
    // The TUI part does have its legacy file, so it resolves while the server part does not.
    assert.equal(resolved.tui, plugin.url("tui/index.ts"))
  })

  it("resolves only a CommonJS or JavaScript file as the GUI part", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({ server: "server/main", gui: "gui/main" }),
      "server/main.ts": source,
      "gui/main.tsx": source,
    })
    assert.equal(Host.resolve(plugin.target).gui, undefined)
  })

  it("resolves a directory with no manifest through the legacy paths and reports each part", async () => {
    await using plugin = await fixture({
      "index.ts": source,
      "tui/index.tsx": source,
      "rpc/index.ts": source,
      "gui/index.cjs": source,
    })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("index.ts"),
      tui: plugin.url("tui/index.tsx"),
      rpc: plugin.url("rpc/index.ts"),
      gui: plugin.url("gui/index.cjs"),
      deprecated: [
        { kind: "server", found: "index", expected: "server/main" },
        { kind: "gui", found: "gui/index", expected: "gui/main" },
        { kind: "tui", found: "tui/index", expected: "tui/main" },
        { kind: "rpc", found: "rpc/index", expected: "rpc/main" },
      ],
    })
  })

  it("does not report a part that resolved through main while a legacy file exists", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({ server: "server/main" }),
      "server/main.ts": source,
      "index.ts": source,
    })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("server/main.ts"),
      tui: undefined,
      rpc: undefined,
      gui: undefined,
    })
  })

  it("treats an entry the standard does not allow as undeclared and reports the fallback", async () => {
    await using plugin = await fixture({
      // The rule before the standard: the file was `index`, not `main`.
      "ocplugin.json": manifest({ server: "server/index" }),
      "server/index.js": source,
    })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("server/index.js"),
      tui: undefined,
      rpc: undefined,
      gui: undefined,
      deprecated: [{ kind: "server", found: "server/index", expected: "server/main" }],
    })
  })

  it("treats a manifest that does not parse as missing", async () => {
    await using plugin = await fixture({ "ocplugin.json": '{ "entry": ', "index.ts": source })
    assert.equal(Host.resolve(plugin.target).server, plugin.url("index.ts"))
  })

  it("does not resolve a local directory through package.json exports", async () => {
    await using plugin = await fixture({
      "package.json": JSON.stringify({
        name,
        exports: { ".": "./dist/server.js", "./gui-experimental": "./dist/gui-experimental.cjs" },
      }),
      "dist/server.js": source,
      "dist/gui-experimental.cjs": source,
      "index.ts": source,
    })
    // Only the manifest and the legacy file paths count for a local directory.
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("index.ts"),
      tui: undefined,
      rpc: undefined,
      gui: undefined,
      deprecated: [{ kind: "server", found: "index", expected: "server/main" }],
    })
  })

  it("resolves a package that arrives through npm through its exports until the next minor", async () => {
    await using plugin = await fixture(
      {
        "package.json": JSON.stringify({
          name,
          exports: { "./server": "./dist/server.js", "./gui-experimental": "./dist/gui-experimental.cjs" },
        }),
        "dist/server.js": source,
        "dist/gui-experimental.cjs": source,
      },
      true,
    )
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("dist/server.js"),
      tui: undefined,
      rpc: undefined,
      gui: plugin.url("dist/gui-experimental.cjs"),
      deprecated: [
        { kind: "server", found: "@fixture/plugin/server", expected: "server/main" },
        { kind: "gui", found: "@fixture/plugin/gui-experimental", expected: "gui/main" },
      ],
    })
  })

  it("does not return a declared entry whose file is missing, unless a legacy path exists", async () => {
    await using plugin = await fixture({
      "ocplugin.json": manifest({ server: "server/main", tui: "tui/main" }),
      "server/main.ts": source,
    })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("server/main.ts"),
      tui: undefined,
      rpc: undefined,
      gui: undefined,
    })
  })

  it("names a plugin without a server part after its manifest, package, or local directory", async () => {
    await using declared = await fixture({
      "ocplugin.json": manifest({ gui: "gui/main" }),
      "package.json": JSON.stringify({ name: "@acme/opencode-gui" }),
    })
    await using named = await fixture({ "package.json": JSON.stringify({ name: "@acme/opencode-gui" }) })
    await using unnamed = await fixture({ "tui.tsx": source })
    await using published = await fixture({ "package.json": JSON.stringify({ name }) }, true)
    assert.equal(Host.packageID(declared.target), name)
    assert.equal(Host.packageID(named.target), "@acme/opencode-gui")
    assert.equal(Host.packageID(unnamed.target), path.basename(unnamed.target.directory))
    assert.equal(Host.packageID(published.target), name)
  })

  it("treats a package.json that does not parse as missing, for the id too", async () => {
    await using plugin = await fixture({ "package.json": '{ "name": "bad", ', "index.ts": source })
    assert.equal(Host.packageID(plugin.target), path.basename(plugin.target.directory))
  })
})
