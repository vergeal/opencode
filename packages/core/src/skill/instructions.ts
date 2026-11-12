export * as SkillInstructions from "./instructions.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Permission } from "../permission.js"
import { Skill } from "../skill.js"
import { Instructions } from "../instructions/index.js"

const Summary = Schema.Struct({
  id: Skill.ID,
  name: Skill.Name,
  description: Schema.String,
})
type Summary = typeof Summary.Type

const entries = (skills: ReadonlyArray<Summary>) =>
  skills.flatMap((skill) => [
    "  <skill>",
    `    <id>${skill.id}</id>`,
    `    <name>${skill.name}</name>`,
    `    <description>${skill.description}</description>`,
    "  </skill>",
  ])

const render = (skills: ReadonlyArray<Summary>) =>
  [
    "技能（skill）为特定任务提供专门的指令和工作流。",
    "当任务与某个技能的描述匹配时，用 skill 工具加载它。",
    "用户也可能直接调用技能。这种情况下，它的指令会以 <skill_content> 块出现在对话里，形状与 skill 工具返回的一致。已经以这种方式出现的技能不需要再次调用。",
    ...(skills.length === 0
      ? ["当前没有可用的技能。"]
      : ["<available_skills>", ...entries(skills), "</available_skills>"]),
  ].join("\n")

const update = Instructions.listUpdate<Summary>({
  key: (skill) => skill.id,
  changed: (before, after) => before.name !== after.name || before.description !== after.description,
  entries,
  render,
  text: {
    replaced: "可用技能已变化。本列表取代之前的可用技能列表。",
    added: "除了之前列出的技能，新增了以下技能：",
    changed: "以下技能有变化。每一项替换之前列出的同一 ID 的技能：",
    removed: (ids) => `以下技能 ID 已不可用，不得再使用：${ids}。`,
  },
})

export interface Interface {
  /** Lists skills the given ruleset does not deny; callers pass the merged agent and Session permissions. */
  readonly load: (permissions: Permission.Ruleset) => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skills = yield* Skill.Service

    return Service.of({
      load: Effect.fn("SkillInstructions.load")(function* (permissions) {
        const available = Skill.available(yield* skills.list(), permissions)
          .flatMap((skill) =>
            skill.description === undefined || skill.autoinvoke === false
              ? []
              : [{ id: skill.id, name: skill.name, description: skill.description }],
          )
          .toSorted((a, b) => a.id.localeCompare(b.id))
        return Instructions.make<ReadonlyArray<Summary>>({
          key: Instructions.Key.make("core/skill-guidance"),
          codec: Schema.toCodecJson(Schema.Array(Summary)),
          read: Effect.succeed(available.length === 0 ? Instructions.removed : available),
          render: {
            initial: render,
            changed: update,
            removed: () => "技能指引已不可用。不要再使用任何之前列出的技能。",
          },
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Skill.node] })
