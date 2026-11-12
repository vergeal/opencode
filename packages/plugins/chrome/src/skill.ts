export * as ChromeSkill from "./skill.js"

import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import { Effect } from "effect"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import manifest from "../ocplugin.json" with { type: "json" }

const entry = manifest.skills.find((skill) => skill.id === "chrome")!

export const id = Skill.ID.make(entry.id)

/** The skill file next to the built server entry, or beside the sources in a worktree. */
export function skillPath() {
  const relative = entry.path.split("/").join("/")
  const candidates = [join(import.meta.dir, "..", relative), join(import.meta.dir, "..", "..", relative)]
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!
}

/**
 * Load the skill body from the package rather than pasting it into this module: the package ships SKILL.md as data,
 * so the same file is what the app lists in `display.skills` and what the model reads.
 */
export function load() {
  return Effect.promise(async () => {
    const path = skillPath()
    return Skill.Info.make({
      id,
      name: Skill.Name.make(entry.name),
      description: entry.description,
      path: AbsolutePath.make(path),
      content: await readFile(path, "utf8"),
    })
  })
}
