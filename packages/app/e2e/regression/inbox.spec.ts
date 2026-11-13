import { expect, test, type Page } from "@playwright/test"
import { T0 } from "../utils/app"
import { mockWorkspace } from "../utils/workspace"

test.use({ serviceWorkers: "block" })

const approvalSession = "ses_inbox_approval"

const questionSession = "ses_inbox_question"

const failureSession = "ses_inbox_failure"

const schedule = {
  id: "sch_inbox",
  name: "Nightly report",
  when: { type: "cron", cron: "0 3 * * *" },
  tz: "UTC",
  action: { type: "prompt", prompt: "report" },
  status: "active",
  runCount: 1,
  lastFiredAt: T0 + 4_000,
  lastOutcome: "fired",
  lastOutput: "All systems nominal",
  time: { created: T0, updated: T0 + 4_000 },
}

const library = {
  id: "lib_inbox",
  name: "Handbook",
  keywords: [],
  status: "ready",
  documentCount: 12,
  chunkCount: 40,
  indexedAt: T0 + 5_000,
  time: { created: T0, updated: T0 + 5_000 },
}

async function openInbox(page: Page, options: { pluginInbox?: unknown[] } = {}) {
  await mockWorkspace(page, {
    name: "Inbox",
    sessions: [
      {
        id: approvalSession,
        title: "Deploy the parser",
        time: { created: T0, updated: T0 + 1, busy: T0 + 1 },
      },
      { id: questionSession, title: "Choose a database" },
      {
        id: failureSession,
        title: "Broken build",
        outcome: "failed",
        time: { created: T0, updated: T0 + 1_000, idle: T0 + 1_000 },
      },
    ],
    permissions: [permission],
    // A working session's requests load when the inbox syncs it.
    sessionPermissions: { [approvalSession]: [permission] },
    onPermissionReply: () => {},
    forms: [
      {
        id: "frm_inbox",
        sessionID: questionSession,
        title: "Which database?",
        metadata: { kind: "question" },
        fields: [{ key: "database", type: "string", title: "Database" }],
      },
    ],
    schedules: [schedule],
    knowledge: [library],
    pluginInbox: options.pluginInbox,
  })
  await page.goto("/inbox")
}

const pluginMessage = {
  id: "pib_inbox",
  plugin: "demo.reports",
  externalID: "report-1",
  title: "Nightly report is ready",
  summary: "The parser deploy finished at 03:00",
  status: "pending",
  createdAt: T0 + 6_000,
  updatedAt: T0 + 6_000,
  seen: false,
}

const rows = (page: Page) => page.locator('[data-ui="inbox-row"]')

const permission = { id: "per_inbox", sessionID: approvalSession, action: "bash", resources: ["rm -rf build"] }

test("lists the five kinds of inbox items", async ({ page }) => {
  await openInbox(page)
  await expect(rows(page)).toHaveCount(5)

  await expect(page.locator('[data-ui="inbox-row"][data-kind="approval"]')).toContainText("Approval needed: bash")
  await expect(page.locator('[data-ui="inbox-row"][data-kind="question"]')).toContainText("Choose a database needs an answer")
  await expect(page.locator('[data-ui="inbox-row"][data-kind="failure"]')).toContainText("Broken build failed")
  await expect(page.locator('[data-ui="inbox-row"][data-kind="output"]')).toContainText("Nightly report produced an output")
  await expect(page.locator('[data-ui="inbox-row"][data-kind="result"]')).toContainText("Knowledge base reindexed")

  await expect(page.getByRole("button", { name: /Pending/ })).toContainText("3")
  await expect(page.getByRole("button", { name: /Failed/ })).toContainText("1")
  await expect(page.getByRole("button", { name: /Done/ })).toContainText("1")
})

test("approving once turns the row into done", async ({ page }) => {
  await openInbox(page)
  const approval = page.locator('[data-ui="inbox-row"][data-kind="approval"]')
  await approval.click()
  await expect(page.locator("[data-slot='inbox-detail']")).toContainText("Approval needed: bash")

  await page.getByRole("button", { name: "Approve once" }).click()
  await expect(approval).toHaveAttribute("data-status", "done")
})

test("answering a form turns the question into done", async ({ page }) => {
  await openInbox(page)
  const question = page.locator('[data-ui="inbox-row"][data-kind="question"]')
  await question.click()
  await page.getByRole("textbox", { name: "Database" }).fill("sqlite")
  await page.getByRole("button", { name: "Submit" }).click()

  await expect(question).toHaveAttribute("data-status", "done")
})

test("keeps read state across a reload", async ({ page }) => {
  await openInbox(page)
  const result = page.locator('[data-ui="inbox-row"][data-kind="result"]')
  await expect(result.locator('[data-slot="inbox-unread"]')).toHaveCount(1)

  await result.click()
  await expect(result.locator('[data-slot="inbox-unread"]')).toHaveCount(0)

  await page.reload()
  await expect(rows(page)).toHaveCount(5)
  await expect(page.locator('[data-ui="inbox-row"][data-kind="result"] [data-slot="inbox-unread"]')).toHaveCount(0)
})

test("reaches all four destinations from the keyboard", async ({ page }) => {
  await openInbox(page)
  await page.keyboard.press("ControlOrMeta+3")
  await expect(page).toHaveURL(/\/knowledge$/)
  await page.keyboard.press("ControlOrMeta+4")
  await expect(page).toHaveURL(/\/scheduled$/)
  await page.keyboard.press("ControlOrMeta+2")
  await expect(page).toHaveURL(/\/inbox$/)
  await page.keyboard.press("ControlOrMeta+1")
  await expect(page).toHaveURL(/\/$/)
})

test("lists a plugin message beside the built-in sources and filters it by status", async ({ page }) => {
  await openInbox(page, { pluginInbox: [pluginMessage] })
  await expect(rows(page)).toHaveCount(6)

  const row = page.locator('[data-ui="inbox-row"]', { hasText: "Nightly report is ready" })
  await expect(row).toHaveAttribute("data-status", "pending")
  // The built-in sources keep their rows while a plugin message joins the same list.
  await expect(page.locator('[data-ui="inbox-row"][data-kind="approval"]')).toContainText("Approval needed: bash")
  await expect(page.locator('[data-ui="inbox-row"][data-kind="result"]')).toContainText("Knowledge base reindexed")

  await page.getByRole("button", { name: /Pending/ }).click()
  await expect(row).toHaveCount(1)

  await page.getByRole("button", { name: /Done/ }).click()
  await expect(row).toHaveCount(0)
})

test("shows the default message page when the publisher has no content renderer", async ({ page }) => {
  await openInbox(page, { pluginInbox: [pluginMessage] })

  const row = page.locator('[data-ui="inbox-row"]', { hasText: "Nightly report is ready" })
  await expect(row.locator('[data-slot="inbox-unread"]')).toHaveCount(1)
  await row.click()

  const detail = page.locator("[data-slot='inbox-detail']")
  await expect(detail).toContainText("Nightly report is ready")
  await expect(detail).toContainText("The parser deploy finished at 03:00")
  await expect(detail).toContainText("demo.reports")

  // Opening the message marks it read on the server, so the unread dot goes away.
  await expect(row.locator('[data-slot="inbox-unread"]')).toHaveCount(0)
})
