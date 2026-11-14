import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Git } from "../src/git.js"

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "orchestrator-git-"))
  const run = (args: string[], cwd = root) => Bun.spawnSync(["git", ...args], { cwd })
  run(["init", "-b", "main"])
  run(["config", "user.email", "test@example.com"])
  run(["config", "user.name", "Test"])
  await writeFile(join(root, "README.md"), "base\n")
  run(["add", "."])
  run(["commit", "-m", "base"])
  run(["branch", "lts/ocdev"])
  return {
    root,
    git: Git.create(root),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

describe("git 封装", () => {
  test("一条命令建 worktree 与分支，HEAD 指向基线", async () => {
    const { root, git, cleanup } = await repository()
    try {
      const directory = join(root, "..", `${git.name}-t1`)
      await git.createWorktree({ directory, branch: "task/t1", base: "lts/ocdev" })
      expect(await git.branch(directory)).toBe("task/t1")
      const base = Bun.spawnSync(["git", "rev-parse", "lts/ocdev"], { cwd: root }).stdout.toString().trim()
      expect(await git.head(directory)).toBe(base)
      expect(await git.branchExists("task/t1")).toBe(true)
      expect(await git.branchExists("task/t2")).toBe(false)
      await git.removeWorktree({ directory, branch: "task/t1" })
      expect(await git.branchExists("task/t1")).toBe(false)
    } finally {
      await cleanup()
    }
  })

  test("diff 给出改动路径，dirtyTracked 只看已跟踪文件", async () => {
    const { root, git, cleanup } = await repository()
    try {
      const directory = join(root, "..", `${git.name}-t2`)
      await git.createWorktree({ directory, branch: "task/t2", base: "lts/ocdev" })
      await writeFile(join(directory, "extra.txt"), "new\n")
      const run = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: directory })
      run(["add", "."])
      run(["commit", "-m", "task work"])
      expect(await git.changed("lts/ocdev", await git.head(directory))).toEqual(["extra.txt"])

      // Untracked build output must not look like uncommitted work.
      await writeFile(join(directory, "dist.log"), "artifact\n")
      expect(await git.dirtyTracked(directory)).toEqual([])
      await writeFile(join(directory, "extra.txt"), "changed\n")
      expect(await git.dirtyTracked(directory)).toEqual(["M extra.txt"])
      await git.removeWorktree({ directory, branch: "task/t2" })
    } finally {
      await cleanup()
    }
  })

  test("claimDirectory 避开已存在的目录", async () => {
    const { root, git, cleanup } = await repository()
    try {
      const base = join(root, "work", "oc-t1")
      await Bun.write(join(base, "keep"), "")
      expect(git.claimDirectory(base)).toBe(`${base}-2`)
      await Bun.write(join(`${base}-2`, "keep"), "")
      expect(git.claimDirectory(base)).toBe(`${base}-3`)
    } finally {
      await cleanup()
    }
  })
})

describe("verify", () => {
  test("通过返回 ok，非零退出保留末 30 行", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchestrator-verify-"))
    try {
      expect(await Git.runVerify(["true"], root, 5_000)).toEqual({ ok: true })
      const failed = await Git.runVerify(["seq 1 100 && exit 3"], root, 5_000)
      expect(failed.ok).toBe(false)
      const lines = failed.detail!.split("\n")
      expect(lines[0]).toBe("退出码 3")
      expect(lines).toHaveLength(31)
      expect(lines.at(-1)).toBe("100")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("超时杀进程组，不留下子进程", async () => {
    const root = await mkdtemp(join(tmpdir(), "orchestrator-verify-"))
    try {
      const started = Date.now()
      const result = await Git.runVerify(["sleep 5"], root, 200)
      expect(result.ok).toBe(false)
      expect(result.detail).toContain("超时")
      expect(Date.now() - started).toBeLessThan(3_000)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
