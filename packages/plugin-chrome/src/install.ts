export * as ChromeInstall from "./install.js"

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"

const EXTENSION = "extension"

/** The unpacked extension directory shipped next to the built plugin, or its source in a worktree. */
export function extensionPath() {
  const candidates = [
    join(import.meta.dir, EXTENSION),
    join(import.meta.dir, "..", EXTENSION),
    join(import.meta.dir, "..", "dist", EXTENSION),
  ]
  return candidates.find((path) => existsSync(join(path, "manifest.json"))) ?? candidates[0]!
}

export function tokenPath() {
  return join(homedir(), ".opencode", "chrome-agent", "token")
}

export function readToken(): Effect.Effect<string> {
  return Effect.gen(function* () {
    const file = Bun.file(tokenPath())
    if (yield* Effect.promise(() => file.exists())) {
      const value = (yield* Effect.promise(() => file.text())).trim()
      if (value) return value
    }
    return yield* writeToken()
  })
}

export function writeToken(): Effect.Effect<string> {
  return Effect.promise(async () => {
    const token = crypto.randomUUID().replaceAll("-", "")
    await Bun.write(tokenPath(), `${token}\n`)
    return token
  })
}

export function copyToClipboard(value: string) {
  return Effect.promise(async () => {
    const [command, args] =
      process.platform === "darwin"
        ? ["pbcopy", []]
        : process.platform === "win32"
          ? ["clip", []]
          : existsSync("/usr/bin/wl-copy")
            ? ["wl-copy", []]
            : ["xclip", ["-selection", "clipboard"]]
    const proc = Bun.spawn([command, ...args], { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
    proc.stdin.write(value)
    proc.stdin.end()
    return (await proc.exited) === 0
  }).pipe(Effect.orElseSucceed(() => false))
}

export function openExtensionsPage() {
  return Effect.promise(async () => {
    const chrome =
      process.platform === "darwin"
        ? ["open", ["-a", "Google Chrome", "chrome://extensions/"]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", "chrome://extensions/"]]
          : ["xdg-open", ["chrome://extensions/"]]
    const proc = Bun.spawn(chrome as [string, ...string[]], { stdout: "ignore", stderr: "ignore" })
    return (await proc.exited) === 0
  }).pipe(Effect.orElseSucceed(() => false))
}

export function steps(path: string, port: number) {
  return [
    `Open chrome://extensions in the Chrome you want OpenCode to drive.`,
    `Turn on Developer mode (top-right).`,
    `Choose "Load unpacked" and select: ${path}`,
    `Keep this OpenCode process running. The extension scans 127.0.0.1:8642-${port} and pairs automatically.`,
    `If it does not connect, open the extension popup and press "Reconnect to OpenCode".`,
  ]
}
