export * as ProjectInstructions from "./project-instructions.js"

import { Instructions } from "../instructions/index.js"

/** Stable instruction key used to notice edits to the Project's own instructions. */
export const key = Instructions.Key.make("core/project")

/** Rendered as its own system part on every Step, so the newest text always reaches the model. */
export const block = (prompt: string) =>
  [
    "# 项目指令",
    "",
    "这些指令是项目所有者为本项目的所有会话编写的。",
    "只要本项目仍是工作目录，它们就叠加在你自己的指令之上。",
    "",
    prompt,
  ].join("\n")

const notice = "项目指令已变化。最新的项目指令在系统提示词里。"

// The baseline intentionally omits this key, so these renderers only feed the "instructions updated" notice.
export const render = {
  initial: () => notice,
  changed: () => notice,
  removed: () => "项目指令不再适用。",
}
