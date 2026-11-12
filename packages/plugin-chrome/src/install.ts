export * as ChromeInstall from "./install.js"

import { existsSync } from "node:fs"
import { mkdir, readlink } from "node:fs/promises"
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
 * A Chrome process that already owns the dedicated profile. Chrome keeps the
 * owning PID in a SingletonLock symlink named "<hostname>-<pid>".
 */
export function runningPid() {
  return Effect.promise(async () => {
    const target = await readlink(join(profilePath(), "SingletonLock")).catch(() => null)
    const pid = Number(target?.split("-").pop())
    if (!Number.isInteger(pid) || pid <= 0) return null
    try {
      process.kill(pid, 0)
      return pid
    } catch {
      return null
    }
  })
}

/**
 * Mark the previous session as clean before Chrome starts. Chrome treats an
 * unclean exit as a crash and offers to restore tabs on the next launch, which
 * is exactly the bubble the dedicated window must not show.
 */
export function prepareProfile() {
  return Effect.promise(async () => {
    const directory = join(profilePath(), "Default")
    await mkdir(directory, { recursive: true })
    const file = Bun.file(join(directory, "Preferences"))
    const preferences: Record<string, Record<string, unknown>> =
      (await file.exists()) ? await file.json().catch(() => ({})) : {}
    await Bun.write(
      join(directory, "Preferences"),
      JSON.stringify({
        ...preferences,
        profile: { ...preferences.profile, exit_type: "Normal", exited_cleanly: true },
        session: { ...preferences.session, restore_on_startup: 5 },
      }),
    )
  })
}

/**
 * Start the dedicated Chrome with the extension loaded. Chrome 137+ gates
 * --load-extension behind a feature flag, so the flag is turned off for this
 * profile. A second call reuses the running instance instead of opening another
 * window for the same profile.
 */
export function launch() {
  return Effect.gen(function* () {
    const binary = browserBinary()
    if (!binary) return { ok: false as const, reason: "No Chrome, Chromium, or Edge installation was found." }
    const profile = profilePath()
    const running = yield* runningPid()
    if (running) return { ok: true as const, binary, profile, pid: running, reused: true }
    yield* prepareProfile()
    const proc = Bun.spawn(
      [
        binary,
        `--user-data-dir=${profile}`,
        `--load-extension=${extensionPath()}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-crash-restore-bubble",
        "--disable-session-crashed-bubble",
        "--start-maximized",
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    )
    proc.unref()
    return { ok: true as const, binary, profile, pid: proc.pid, reused: false }
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
