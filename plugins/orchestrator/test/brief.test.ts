import { describe, expect, test } from "bun:test"
import { Brief } from "../src/brief.js"

const input = {
  id: "t1",
  title: "给 dbro 加超时",
  allowPaths: ["plugins/dbro/src"],
  verify: ["bun test", "bun run typecheck"],
  branch: "task/t1",
  base: "lts/ocdev",
  worktree: "/tmp/worktrees/oc-t1",
  resultPath: "/data/results/p1/t1.json",
  pmSessionID: "ses_pm",
}

describe("任务书", () => {
  test("六个小节齐全，路径与命令逐行", () => {
    const text = Brief.render(input)
    for (const heading of ["# 任务 t1：给 dbro 加超时", "## 工作目录", "## 分支", "## 允许修改的路径", "## 验收命令", "## 完成时", "## 只有这三种情况"]) {
      expect(text).toContain(heading)
    }
    expect(text).toContain("/tmp/worktrees/oc-t1")
    expect(text).toContain("task/t1（已从 lts/ocdev 创建")
    expect(text).toContain("- plugins/dbro/src")
    expect(text).toContain("- `bun test`")
    expect(text).toContain("/data/results/p1/t1.json")
    expect(text).toContain('"commit": "<HEAD 的完整 sha>"')
    expect(text).toContain("`ses_pm`")
  })

  test("完成时先提交再写结果，且明确不要 push", () => {
    const text = Brief.render(input)
    expect(text).toContain("1. 把所有改动提交到 task/t1，**不要 push**")
    expect(text).toContain('git add -A && git commit -m "task t1: 给 dbro 加超时"')
    expect(text).toContain("2. 写文件 `/data/results/p1/t1.json`")
    expect(text).toContain("不要 push")
    expect(text).not.toContain("推主干")
  })

  test("changed 的示例命令带真实 base，不留占位符", () => {
    const text = Brief.render(input)
    expect(text).toContain('"changed": ["<git diff --name-only lts/ocdev...HEAD 的结果，逐行>"]')
    expect(text).not.toContain("<base>")
  })

  test("提交信息里的引号与展开字符被转义", () => {
    const text = Brief.render({ ...input, title: '修 "bug" 与 $HOME `x`' })
    expect(text).toContain('git commit -m "task t1: 修 \\"bug\\" 与 \\$HOME \\`x\\`"')
  })

  test("没有验收命令时明确说只核对范围", () => {
    const text = Brief.render({ ...input, verify: [] })
    expect(text).toContain("本任务没有验收命令")
    expect(text).not.toContain("- `bun test`")
  })

  test("三种回报情况都列出，且不允许写进度汇报", () => {
    const text = Brief.render(input)
    expect(text).toContain("卡住超过 30 分钟")
    expect(text).toContain("需求没写的决策")
    expect(text).toContain("`plugins/dbro/src` 之外的路径")
    expect(text).toContain("不要写进度汇报")
  })
})
