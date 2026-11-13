import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { generate, slugOf } from "../src/generate.js"

const repository = path.resolve(import.meta.dir, "../../..")
const created: string[] = []
const kinds = new Set(["server", "gui", "tui", "rpc"])

/** A fresh directory under `packages/`, so the monorepo check passes and the name stays unique. */
async function scratch(name: string) {
  const directory = await mkdtemp(path.join(repository, "packages", `.create-ocplugin-${name}-`))
  created.push(directory)
  return directory
}

/** The entry the host will read: known parts only, a relative path ending in `/main`, and a file that exists. */
async function declaredEntry(directory: string) {
  const manifest = JSON.parse(await readFile(path.join(directory, "ocplugin.json"), "utf8")) as { entry: Record<string, string> }
  for (const [kind, entrypoint] of Object.entries(manifest.entry)) {
    expect(kinds.has(kind)).toBe(true)
    expect(entrypoint).toMatch(/^(?!\/)(?!\.\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?:[^/\\]+\/)+main$/)
    const prefix = path.join(directory, entrypoint)
    expect([".ts", ".tsx", ".js", ".mjs", ".cjs"].some((ext) => existsSync(prefix + ext))).toBe(true)
  }
  return manifest.entry
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("generate", () => {
  test("writes a server plugin whose declared entry exists", async () => {
    const directory = await scratch("server")
    const selected = await generate({ directory, template: "server", name: "Notes" })

    expect(selected.id).toBe(`opencode.${slugOf(path.basename(directory))}`)
    expect(selected.files).toContain("server/main.ts")
    expect(selected.files).not.toContain("gui/main.tsx")
    expect(existsSync(path.join(directory, "server", "main.ts"))).toBe(true)
    expect(await declaredEntry(directory)).toEqual({ server: "server/main" })
  })

  test("declares the GUI entry and its bundle config", async () => {
    const directory = await scratch("gui")
    const selected = await generate({ directory, template: "gui" })

    expect(selected.files).toContain("gui/main.tsx")
    expect(selected.files).toContain("vite.config.ts")
    expect(existsSync(path.join(directory, "gui", "main.tsx"))).toBe(true)
    expect(await declaredEntry(directory)).toEqual({ server: "server/main", gui: "gui/main" })
  })

  test("declares the TUI entry", async () => {
    const directory = await scratch("tui")
    const selected = await generate({ directory, template: "tui" })

    expect(selected.files).toContain("tui/main.tsx")
    expect(existsSync(path.join(directory, "tui", "main.tsx"))).toBe(true)
    expect(await declaredEntry(directory)).toEqual({ server: "server/main", tui: "tui/main" })
  })

  test("refuses to write outside the repository", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "create-ocplugin-"))
    created.push(directory)

    await expect(generate({ directory, template: "server" })).rejects.toThrow(/inside the opencode repository/)
  })
})
