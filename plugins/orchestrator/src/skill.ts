export * as OrchestratorSkill from "./skill.js"

import { AbsolutePath } from "@opencode/schema/schema"
import { Skill } from "@opencode/schema/skill"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import manifest from "../ocplugin.json" with { type: "json" }

const entry = manifest.skills.find((skill) => skill.id === "orchestrator")!

export const id = Skill.ID.make(entry.id)

/** The skill file next to the built server entry, or beside the sources in a worktree. */
export function skillPath() {
  const candidates = [join(import.meta.dir, "..", entry.path), join(import.meta.dir, "..", "..", entry.path)]
  return candidates.find((path) => existsSync(path)) ?? candidates[0]!
}

/**
 * Ship SKILL.md as data and load it at activation, so `display.skills` in the manifest and the text the model reads can
 * never drift apart.
 */
export async function load() {
  const path = skillPath()
  return Skill.Info.make({
    id,
    name: Skill.Name.make(entry.name),
    description: entry.description,
    path: AbsolutePath.make(path),
    content: await readFile(path, "utf8"),
  })
}
