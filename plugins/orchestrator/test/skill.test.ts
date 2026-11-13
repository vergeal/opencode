import { expect, test } from "bun:test"
import { OrchestratorSkill } from "../src/skill.js"

test("技能正文从 SKILL.md 加载，与 manifest 的描述一致", async () => {
  const info = await OrchestratorSkill.load()
  expect(info.id).toBe("orchestrator" as never)
  expect(info.content).toContain("# Orchestrator")
  expect(info.content).toContain("## 异常处理矩阵")
  expect(info.content).toContain("## 什么时候不用插件")
})

test("正文只写作业流程：不提已砍掉的 rebase，也不复述实现", async () => {
  const info = await OrchestratorSkill.load()
  expect(info.content).not.toContain("rebase")
  expect(info.content).not.toContain("TRANSITIONS")
  expect(OrchestratorSkill.skillPath()).toEndWith("skills/orchestrator/SKILL.md")
})
