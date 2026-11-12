import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import manifest from "../ocplugin.json" with { type: "json" }
import { Operations } from "../src/rpc.js"

describe("ocplugin manifest", () => {
  test("declares every operation once and reserves the webwright namespace", () => {
    const names = Operations.map((operation) => operation.name)
    expect(new Set(names).size).toBe(names.length)
    expect(manifest.display.tools).toEqual(["webwright.*"])
  })

  test("ships the skill it advertises", () => {
    expect(manifest.skills.map((skill) => skill.id)).toEqual(["webwright"])
    for (const skill of manifest.skills) expect(existsSync(join(import.meta.dir, "..", skill.path))).toBe(true)
  })
})
