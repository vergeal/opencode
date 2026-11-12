import { defineConfig, devices } from "@playwright/test"

/**
 * A story server belongs to one checkout. Deriving the default port from the package directory keeps two worktrees
 * from silently sharing a server, which would test one checkout's code against another's.
 */
function storiesPort(directory: string) {
  const explicit = process.env.PLAYWRIGHT_STORIES_PORT

  if (explicit) return Number(explicit)

  const offset = [...directory].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 400, 0)
  return 6006 + offset
}

export function componentConfig(directory: string) {
  const port = storiesPort(directory)
  const baseURL = process.env.PLAYWRIGHT_STORIES_URL ?? `http://127.0.0.1:${port}`

  return defineConfig({
    testDir: `${directory}/component-tests`,
    outputDir: `${directory}/component-tests/test-results`,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: [["html", { outputFolder: `${directory}/component-tests/playwright-report`, open: "never" }], ["line"]],
    webServer: {
      // Vite runs on Node: Bun 1.4.2's node:http crashes the server with an uncaught "write after end" when a browser
      // abandons pipelined requests (oven-sh/bun#40350, fixed in Bun 1.4.3).
      command: `bun run --cwd ${directory}/../stories dev --port ${port} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // Vite reports dependency re-optimization ("optimized dependencies changed. reloading") on stdout; keep it in logs.
      stdout: "pipe",
    },
    use: {
      baseURL,
      // A local failure keeps the trace instead of the video: the same evidence without encoding a webm per failure.
      trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
      screenshot: "only-on-failure",
      video: process.env.CI ? "on-first-retry" : "off",
    },
    projects: [{ name: "components", use: { ...devices["Desktop Chrome"] } }],
  })
}
