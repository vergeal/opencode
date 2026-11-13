import { describe, expect, test } from "bun:test"
import path from "node:path"

const repository = path.resolve(import.meta.dir, "../../..")
const cli = path.resolve(import.meta.dir, "../src/cli.ts")

function run(...args: string[]) {
  return Bun.spawnSync(["bun", cli, ...args], { cwd: repository, stdout: "pipe", stderr: "pipe" })
}

describe("cli", () => {
  test("prints help and exits zero", () => {
    const result = run("--help")

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("Usage: create-ocplugin")
  })

  test("rejects a missing directory", () => {
    const result = run()

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("target directory is required")
  })

  test("rejects an unknown template", () => {
    const result = run("packages/plugins/x", "--template", "rpc")

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('Unknown template "rpc"')
  })
})
