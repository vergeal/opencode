export * as ProjectInstructions from "./project-instructions.js"

import { Instructions } from "../instructions/index.js"

/** Stable instruction key used to notice edits to the Project's own instructions. */
export const key = Instructions.Key.make("core/project")

/** Rendered as its own system part on every Step, so the newest text always reaches the model. */
export const block = (prompt: string) =>
  [
    "# Project instructions",
    "",
    "The project owner wrote these instructions for every session in this project.",
    "They apply on top of your own instructions for as long as this project is the working directory.",
    "",
    prompt,
  ].join("\n")

const notice = "The project instructions changed. The latest project instructions are in the system prompt."

// The baseline intentionally omits this key, so these renderers only feed the "instructions updated" notice.
export const render = {
  initial: () => notice,
  changed: () => notice,
  removed: () => "The project instructions no longer apply.",
}
