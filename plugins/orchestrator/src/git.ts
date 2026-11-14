export * as Git from "./git.js"

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { basename } from "node:path"

const OUTPUT_LIMIT = 256 * 1024

export interface CommandResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GitError"
  }
}

/** Runs one command without a shell. Used for git, where arguments must not be re-split. */
export function runArgv(argv: readonly string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return spawnAndRead(argv as string[], cwd, timeoutMs)
}

/** Runs one shell command. Used for `verify`, which is authored as shell text. */
export function runShell(command: string, cwd: string, timeoutMs: number): Promise<CommandResult> {
  return spawnAndRead(["bash", "-lc", command], cwd, timeoutMs)
}

/**
 * The child is its own process group, so a timeout kills the shell *and* whatever it started (a test runner that
 * forks workers, for example). Killing only the shell would leave those running against the worktree.
 */
function spawnAndRead(argv: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let timedOut = false
    let settled = false

    const collect = (chunks: Buffer[], chunk: Buffer) => {
      chunks.push(chunk)
      let size = chunks.reduce((total, item) => total + item.byteLength, 0)
      while (size > OUTPUT_LIMIT && chunks.length > 1) size -= chunks.shift()!.byteLength
    }
    child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk))
    child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk))

    const kill = () => {
      if (child.pid === undefined) return
      try {
        // Negative pid targets the group created by `detached`; fall back to the child alone.
        process.kill(-child.pid, "SIGKILL")
      } catch {
        child.kill("SIGKILL")
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
      })
    }

    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => finish(code))
  })
}

export interface Worktree {
  readonly directory: string
  readonly branch: string
}

export interface GitClient {
  readonly root: string
  readonly name: string
  createWorktree(input: { directory: string; branch: string; base: string }): Promise<void>
  removeWorktree(input: { directory: string; branch: string }): Promise<void>
  head(directory: string): Promise<string>
  branch(directory: string): Promise<string>
  branchExists(branch: string): Promise<boolean>
  changed(base: string, head: string): Promise<string[]>
  dirtyTracked(directory: string): Promise<string[]>
  /** A unique `<repo>-<task>` directory, suffixed `-2`, `-3` when a previous attempt left one behind. */
  claimDirectory(name: string): string
}

export function create(root: string): GitClient {
  const name = basename(root)
  const git = async (cwd: string, args: string[], timeoutMs = 60_000) => {
    const result = await runArgv(["git", ...args], cwd, timeoutMs)
    if (result.timedOut) throw new GitError(`git ${args.join(" ")} 超时`)
    if (result.code !== 0) throw new GitError(`git ${args.join(" ")} 失败（${result.code}）：${result.stderr.trim()}`)
    return result.stdout.trim()
  }

  return {
    root,
    name,
    createWorktree: async ({ directory, branch, base }) => {
      // `add -b` creates the branch and the worktree in one step; a second `switch` would be a second failure point.
      await git(root, ["worktree", "add", "-b", branch, directory, base])
    },
    removeWorktree: async ({ directory, branch }) => {
      await git(root, ["worktree", "remove", "--force", directory]).catch(() => undefined)
      await git(root, ["branch", "-D", branch]).catch(() => undefined)
    },
    head: (directory) => git(directory, ["rev-parse", "HEAD"]),
    branch: (directory) => git(directory, ["rev-parse", "--abbrev-ref", "HEAD"]),
    branchExists: async (branch) => {
      const result = await runArgv(["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], root, 30_000)
      return result.code === 0
    },
    changed: async (base, head) => {
      const output = await git(root, ["diff", "--name-only", `${base}...${head}`])
      return output === "" ? [] : output.split("\n")
    },
    dirtyTracked: async (directory) => {
      const output = await git(directory, ["status", "--porcelain", "--untracked-files=no"])
      return output === "" ? [] : output.split("\n")
    },
    claimDirectory: (base) => {
      const directory = base
      let suffix = 1
      let candidate = directory
      while (existsSync(candidate)) {
        suffix += 1
        candidate = `${directory}-${suffix}`
      }
      return candidate
    },
  }
}

export interface VerifyResult {
  readonly ok: boolean
  readonly command?: string
  /** Last 30 lines of the failing command's output, which is what a reviewer reads. */
  readonly detail?: string
}

export async function runVerify(
  commands: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<VerifyResult> {
  for (const command of commands) {
    const result = await runShell(command, cwd, timeoutMs)
    if (result.timedOut)
      return { ok: false, command, detail: `超时（${Math.round(timeoutMs / 1000)} 秒）\n${tail(result.stdout, result.stderr)}` }
    if (result.code !== 0)
      return { ok: false, command, detail: `退出码 ${result.code}\n${tail(result.stdout, result.stderr)}` }
  }
  return { ok: true }
}

export function tail(stdout: string, stderr: string, lines = 30) {
  const combined = [stdout, stderr].filter((part) => part.trim() !== "").join("\n").trimEnd()
  if (combined === "") return "（无输出）"
  return combined.split("\n").slice(-lines).join("\n")
}
