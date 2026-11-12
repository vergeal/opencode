import { homedir } from "node:os"

/** The `/json/version` reply a Chrome that accepts DevTools connections reports. */
export type Version = {
  /** The browser's product string, such as `HeadlessChrome/131.0.6778.86`. */
  readonly browser: string
  /** The browser-level WebSocket a CDP client connects to. */
  readonly webSocketDebuggerUrl: string
}

/**
 * What a probe of a CDP endpoint found.
 *
 * - `ready`: the port answers with a JSON version that names a debugger WebSocket.
 * - `refused`: nothing listens there, or the connection failed below HTTP.
 * - `timeout`: the endpoint did not answer in time, so it is not a CDP endpoint this app can use now.
 * - `invalid`: something answers, but the reply is not JSON, is not a version document, or is an HTTP error.
 */
export type ProbeResult =
  | { readonly status: "ready"; readonly version: Version }
  | { readonly status: "refused"; readonly detail: string }
  | { readonly status: "timeout"; readonly detail: string }
  | { readonly status: "invalid"; readonly detail: string }

/** The default endpoint a Chrome started with `--remote-debugging-port=9222` exposes. */
export const DEFAULT_ENDPOINT = "http://127.0.0.1:9222/json/version"

/** How long one probe may take before it counts as a timeout. */
export const DEFAULT_PROBE_TIMEOUT_MS = 1_000

/** The version document is small; anything larger is not one. */
const MAX_BODY = 16_384

/**
 * Probes a CDP endpoint and classifies the outcome.
 *
 * Pure with respect to its inputs: the only I/O is the injected `fetch`, so a caller can state all four outcomes
 * without a running browser.
 *
 * @param endpoint - The URL to probe, normally `/json/version` of the debugging port.
 * @param options - The timeout and the fetch implementation; both default to the runtime's.
 * @returns The classified probe outcome.
 */
export async function probeEndpoint(
  endpoint: string,
  options: { readonly timeoutMs?: number; readonly fetch?: typeof fetch } = {},
): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const request = options.fetch ?? fetch

  let response: Response

  try {
    response = await request(endpoint, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    return classify(error)
  }

  if (!response.ok) return { status: "invalid", detail: `HTTP ${response.status}` }

  let body: string

  try {
    body = await response.text()
  } catch (error) {
    return classify(error)
  }

  if (body.length > MAX_BODY) return { status: "invalid", detail: "response body is too large" }

  let value: unknown

  try {
    value = JSON.parse(body)
  } catch {
    return { status: "invalid", detail: "response is not JSON" }
  }

  const version = parseVersion(value)

  return version
    ? { status: "ready", version }
    : { status: "invalid", detail: "response is not a CDP version document" }
}

/** Reads the fields this app needs from a `/json/version` document, or undefined when they are missing. */
export function parseVersion(value: unknown): Version | undefined {
  if (typeof value !== "object" || value === null) return
  const record = value as Record<string, unknown>
  const browser = record.Browser
  const webSocketDebuggerUrl = record.webSocketDebuggerUrl

  if (typeof browser !== "string" || !browser) return
  if (typeof webSocketDebuggerUrl !== "string" || !webSocketDebuggerUrl) return

  return { browser, webSocketDebuggerUrl }
}

/** The arguments that start a Chrome whose DevTools endpoint is our own port and profile. */
export function launchArgs(input: { readonly port: number; readonly userDataDir: string }): readonly string[] {
  return [`--remote-debugging-port=${input.port}`, `--user-data-dir=${input.userDataDir}`]
}

/**
 * The install locations to try, in order, for this system.
 *
 * The user's own `~/Applications` comes before the system copy on macOS, so a per-user install wins.
 *
 * @param input - The platform, home directory, and environment to read; defaults to this process's.
 * @returns Absolute paths to try in order; empty when this platform has no known location.
 */
export function chromeCandidates(
  input: {
    readonly platform?: NodeJS.Platform
    readonly home?: string
    readonly env?: Record<string, string | undefined>
  } = {},
): readonly string[] {
  const platform = input.platform ?? process.platform
  const home = input.home ?? homedir()
  const env = input.env ?? process.env

  if (platform === "darwin")
    return [
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      `${home}/Applications/Chromium.app/Contents/MacOS/Chromium`,
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]

  if (platform === "win32") {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]].flatMap((root) =>
      root ? [`${root}\\Google\\Chrome\\Application\\chrome.exe`] : [],
    )

    return [
      ...roots,
      ...roots.map((path) =>
        path.replace("\\Google\\Chrome\\Application\\chrome.exe", "\\Chromium\\Application\\chrome.exe"),
      ),
    ]
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ]
}

function classify(error: unknown): ProbeResult {
  const code = errorCode(error)
  const name = error instanceof Error ? error.name : ""

  if (name === "AbortError" || name === "TimeoutError" || code === "ABORT_ERR" || code === "ETIMEDOUT")
    return { status: "timeout", detail: detail(error) }

  return { status: "refused", detail: detail(error) }
}

function errorCode(error: unknown): string | undefined {
  let value: unknown = error

  for (let depth = 0; depth < 4 && value; depth++) {
    if (typeof value !== "object") return
    const record = value as Record<string, unknown>

    if (typeof record.code === "string") return record.code
    value = record.cause
  }
}

function detail(error: unknown) {
  if (error instanceof Error) return error.cause instanceof Error ? error.cause.message : error.message

  return String(error)
}
