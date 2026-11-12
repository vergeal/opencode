export * as ChromeInstall from "./install.js"

import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
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

/** A dedicated profile so the agent never drives the user's everyday Chrome session. */
export function profilePath() {
  return join(homedir(), ".opencode", "chrome-agent", "profile")
}

/** Find a Chromium-based browser that accepts --load-extension. */
export function browserBinary() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ].find((path) => existsSync(path))
  }
  if (process.platform === "win32") {
    return [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
      .flatMap((root) => [
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      ])
      .find((path) => existsSync(path))
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]
    .map((name) => Bun.which(name))
    .find((path): path is string => Boolean(path))
}

/**
 * Start the dedicated Chrome with the extension loaded. Chrome 137+ gates
 * --load-extension behind a feature flag, so the flag is turned off for this
 * profile. A second launch for the same profile hands off to the running
 * instance, which already has the extension.
 */
export function launch() {
  return Effect.promise(async () => {
    const binary = browserBinary()
    if (!binary) return { ok: false as const, reason: "No Chrome, Chromium, or Edge installation was found." }
    const profile = profilePath()
    await mkdir(profile, { recursive: true })
    const proc = Bun.spawn(
      [
        binary,
        `--user-data-dir=${profile}`,
        `--load-extension=${extensionPath()}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--no-first-run",
        "--no-default-browser-check",
        "--start-maximized",
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    )
    proc.unref()
    return { ok: true as const, binary, profile, pid: proc.pid }
  })
}

export function manualSteps(path: string) {
  return [
    `If the dedicated Chrome did not start, open chrome://extensions in the Chrome you want to drive.`,
    `Turn on Developer mode (top-right).`,
    `Choose "Load unpacked" and select: ${path}`,
    `Keep this OpenCode process running. The extension scans 127.0.0.1:8642-8662 and pairs automatically.`,
  ]
}
