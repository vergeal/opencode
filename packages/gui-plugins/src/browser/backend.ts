import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import { join } from "node:path"
import type { Cdp } from "./cdp"
import { createWebSocketCdp } from "./cdp"
import { chromeCandidates, launchArgs, probeEndpoint, type ProbeResult, type Version } from "./discovery"

/** Why a browser pane kept its embedded page instead of using a local Chrome. */
export type EmbeddedReason =
  | "preferred"
  | "probe-timeout"
  | "probe-invalid"
  | "chrome-missing"
  | "launch-failed"
  | "connect-failed"

/**
 * Which browser a pane drives.
 *
 * - `external`: a local Chrome answered on the debugging port, so page tools run against it.
 * - `embedded`: the pane's own Electron `WebContentsView`; the default, so the pane never needs another process.
 */
export type Backend =
  | { readonly mode: "external"; readonly endpoint: string; readonly version: Version; readonly cdp: Cdp }
  | { readonly mode: "embedded"; readonly reason: EmbeddedReason; readonly detail: string }

/** Which backend to resolve: the pane's embedded view, or a local Chrome this app launches or connects to. */
export type BackendPreference = "embedded" | "external"

/** What resolving a backend may call; every entry is injectable so a test states each outcome. */
export type BackendDependencies = {
  readonly probe?: (endpoint: string) => Promise<ProbeResult>
  readonly connect?: (webSocketDebuggerUrl: string) => Cdp
  readonly exists?: (path: string) => Promise<boolean>
  readonly launch?: (path: string, args: readonly string[]) => Promise<void>
  readonly candidates?: () => readonly string[]
  /** How long to wait for a launched Chrome to answer. */
  readonly readyTimeoutMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

/**
 * Picks the browser backend. The pane's embedded view is the default; only an explicit `external` preference probes
 * the debugging endpoint and, when nothing answers there yet, launches a Chrome of its own.
 *
 * Every failure is a fallback, never an error: a missing Chrome, a refused connection, a port serving something else,
 * a launch that dies, or a WebSocket that cannot complete the handshake all return `embedded`.
 *
 * @param input - The endpoint to probe, the debugging port to launch with, the profile directory to launch into, and
 *   which backend to resolve; omitted, it resolves `embedded`.
 * @param dependencies - The I/O to use; defaults are the real process, clock, and network.
 * @returns The backend to drive.
 */
export async function resolveBackend(
  input: {
    readonly endpoint: string
    readonly port: number
    readonly userDataDir: string
    readonly prefer?: BackendPreference
  },
  dependencies: BackendDependencies = {},
): Promise<Backend> {
  if ((input.prefer ?? "embedded") === "embedded")
    return {
      mode: "embedded",
      reason: "preferred",
      detail: "The pane drives its own embedded view, so no local Chrome is launched or connected.",
    }

  const probe = dependencies.probe ?? probeEndpoint
  const first = await probe(input.endpoint)

  if (first.status === "ready") return connectExternal(input, first.version, dependencies)

  if (first.status !== "refused") return embedded(first)

  const chrome = await findChrome(dependencies)

  if (!chrome) return { mode: "embedded", reason: "chrome-missing", detail: "No Google Chrome installation was found." }

  try {
    await (dependencies.launch ?? launchChrome)(
      chrome,
      launchArgs({ port: input.port, userDataDir: input.userDataDir }),
    )
  } catch (error) {
    return { mode: "embedded", reason: "launch-failed", detail: error instanceof Error ? error.message : String(error) }
  }

  const started = await waitForEndpoint(probe, input.endpoint, dependencies)

  if (started.status !== "ready")
    return {
      mode: "embedded",
      reason: "launch-failed",
      detail: `Launched ${chrome} but it did not answer on ${input.endpoint}.`,
    }

  return connectExternal(input, started.version, dependencies)
}

async function connectExternal(
  input: { readonly endpoint: string },
  version: Version,
  dependencies: BackendDependencies,
): Promise<Backend> {
  const cdp = (dependencies.connect ?? createWebSocketCdp)(version.webSocketDebuggerUrl)

  try {
    // The transport connects lazily, so the handshake is what proves the socket works. It is a read that changes
    // nothing in the user's Chrome.
    await cdp.send("Browser.getVersion")
  } catch (error) {
    cdp.dispose()

    return {
      mode: "embedded",
      reason: "connect-failed",
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  return { mode: "external", endpoint: input.endpoint, version, cdp }
}

async function findChrome(dependencies: BackendDependencies) {
  const exists = dependencies.exists ?? pathExists
  const candidates = (dependencies.candidates ?? chromeCandidates)()

  for (const candidate of candidates) {
    if (await exists(candidate).catch(() => false)) return candidate
  }
}

async function waitForEndpoint(
  probe: (endpoint: string) => Promise<ProbeResult>,
  endpoint: string,
  dependencies: BackendDependencies,
) {
  const now = dependencies.now ?? Date.now
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const deadline = now() + (dependencies.readyTimeoutMs ?? 8_000)

  while (now() < deadline) {
    await sleep(150)
    const result = await probe(endpoint)

    if (result.status === "ready") return result
  }

  return { status: "timeout" as const, detail: `No answer on ${endpoint}.` }
}

/** The default profile directory keeps this app's Chrome separate from the user's own sessions and extensions. */
export function browserProfileDirectory(userData: string) {
  return join(userData, "browser-chrome")
}

/** Starts Chrome without inheriting its output or keeping the app waiting on it. */
export function launchChrome(path: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // A failed spawn arrives as an `error` event; without a listener Node would throw it as an uncaught exception.
    const child = spawn(path, [...args], { detached: true, stdio: "ignore" })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

async function pathExists(path: string) {
  await access(path)

  return true
}

function embedded(result: Exclude<ProbeResult, { status: "ready" }>): Backend {
  return {
    mode: "embedded",
    reason: result.status === "timeout" ? "probe-timeout" : "probe-invalid",
    detail: result.detail,
  }
}
