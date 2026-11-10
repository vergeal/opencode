import { describe, expect, test } from "bun:test"
import type { FormInfo, KnowledgeInfo, PermissionRequest, ScheduleInfo } from "@opencode/client/promise"
import {
  knowledgeItem,
  permissionItem,
  questionItem,
  scheduleItem,
  sessionFailureItem,
  type InboxText,
} from "./model"

const text: InboxText = (key, params) => (params ? `${key}:${Object.values(params).join(",")}` : key)

const session = { id: "ses_1", title: "Fix the parser", projectID: "proj_1" }

const permission: PermissionRequest = {
  id: "per_1",
  sessionID: "ses_1",
  action: "bash",
  resources: ["rm -rf build"],
}

const form: FormInfo = {
  id: "frm_1",
  sessionID: "ses_1",
  title: "Which database?",
  fields: [{ type: "string", key: "database" }],
}

function schedule(overrides: Partial<ScheduleInfo> = {}): ScheduleInfo {
  return {
    id: "sch_1",
    name: "Nightly report",
    when: { type: "cron", cron: "0 3 * * *" },
    tz: "UTC",
    action: { type: "prompt", prompt: "report" },
    status: "active",
    runCount: 4,
    time: { created: 1_000, updated: 2_000 },
    ...overrides,
  }
}

function knowledge(overrides: Partial<KnowledgeInfo> = {}): KnowledgeInfo {
  return {
    id: "lib_1",
    name: "Handbook",
    keywords: [],
    status: "ready",
    documentCount: 12,
    chunkCount: 40,
    time: { created: 1_000, updated: 2_000 },
    ...overrides,
  }
}

describe("inbox session sources", () => {
  test("maps a waiting permission to a pending approval", () => {
    const item = permissionItem({ server: "srv", session, request: permission, createdAt: 10, text })

    expect(item).toMatchObject({
      key: "srv\0approval\0per_1",
      kind: "approval",
      status: "pending",
      title: "inbox.item.approval.title:bash",
      summary: "Fix the parser",
      source: { type: "session", id: "ses_1", name: "Fix the parser" },
      projectID: "proj_1",
      action: { type: "permission", sessionID: "ses_1", requestID: "per_1" },
    })
  })

  test("maps a waiting form to a pending question", () => {
    const item = questionItem({ server: "srv", session, form, createdAt: 10, text })

    expect(item).toMatchObject({
      key: "srv\0question\0frm_1",
      kind: "question",
      status: "pending",
      title: "inbox.item.question.title:Fix the parser",
      summary: "Which database?",
      action: { type: "form", sessionID: "ses_1", formID: "frm_1" },
    })
  })

  test("falls back to an untitled name", () => {
    const item = questionItem({ server: "srv", session: { id: "ses_2" }, form, createdAt: 10, text })

    expect(item.title).toBe("inbox.item.question.title:inbox.item.untitled")
    expect(item.source.name).toBe("inbox.item.untitled")
  })

  test("maps a failed session to a failed failure", () => {
    const item = sessionFailureItem({ server: "srv", session, createdAt: 10, text })

    expect(item).toMatchObject({
      key: "srv\0failure\0session\0ses_1",
      kind: "failure",
      status: "failed",
      title: "inbox.item.failure.title:Fix the parser",
      summary: "inbox.item.session.failure.summary",
      action: { type: "open-session", sessionID: "ses_1" },
    })
  })
})

describe("inbox schedule source", () => {
  test("maps a failed run to a failed failure", () => {
    const item = scheduleItem({ server: "srv", schedule: schedule({ lastOutcome: "failed" }), createdAt: 10, text })

    expect(item).toMatchObject({
      key: "srv\0failure\0schedule\0sch_1",
      kind: "failure",
      status: "failed",
      title: "inbox.item.failure.title:Nightly report",
      summary: "inbox.item.schedule.failed.summary",
      source: { type: "schedule", id: "sch_1", name: "Nightly report" },
      action: { type: "open-schedule", scheduleID: "sch_1" },
    })
  })

  test("maps an expired run to a failed failure", () => {
    const item = scheduleItem({ server: "srv", schedule: schedule({ lastOutcome: "expired" }), createdAt: 10, text })

    expect(item).toMatchObject({ kind: "failure", summary: "inbox.item.schedule.expired.summary" })
  })

  test("maps a fired run with output to a pending output", () => {
    const item = scheduleItem({
      server: "srv",
      schedule: schedule({ lastOutcome: "fired", lastOutput: "  All systems nominal  " }),
      createdAt: 10,
      text,
    })

    expect(item).toMatchObject({
      key: "srv\0output\0sch_1",
      kind: "output",
      status: "pending",
      title: "inbox.item.output.title:Nightly report",
      summary: "All systems nominal",
      action: { type: "open-schedule", scheduleID: "sch_1" },
    })
  })

  test("truncates a long output", () => {
    const item = scheduleItem({
      server: "srv",
      schedule: schedule({ lastOutcome: "fired", lastOutput: "x".repeat(400) }),
      createdAt: 10,
      text,
    })

    expect(item?.summary).toHaveLength(280)
    expect(item?.summary.endsWith("…")).toBe(true)
  })

  test("leaves out runs that produced nothing or never fired", () => {
    expect(scheduleItem({ server: "srv", schedule: schedule({ lastOutcome: "fired" }), createdAt: 10, text })).toBe(
      undefined,
    )
    expect(
      scheduleItem({ server: "srv", schedule: schedule({ lastOutcome: "fired", lastOutput: "   " }), createdAt: 10, text }),
    ).toBe(undefined)

    for (const outcome of ["checked", "skipped", "disabled", "late"] as const)
      expect(scheduleItem({ server: "srv", schedule: schedule({ lastOutcome: outcome }), createdAt: 10, text })).toBe(
        undefined,
      )

    expect(scheduleItem({ server: "srv", schedule: schedule(), createdAt: 10, text })).toBe(undefined)
  })
})

describe("inbox knowledge source", () => {
  test("maps a ready library to a done result", () => {
    const item = knowledgeItem({ server: "srv", library: knowledge(), createdAt: 10, text })

    expect(item).toMatchObject({
      key: "srv\0result\0lib_1",
      kind: "result",
      status: "done",
      title: "inbox.item.knowledge.title",
      summary: "inbox.item.knowledge.summary:12",
      source: { type: "knowledge", id: "lib_1", name: "Handbook" },
      action: { type: "open-knowledge", libraryID: "lib_1" },
    })
  })

  test("maps a failed library to a failed failure", () => {
    const item = knowledgeItem({ server: "srv", library: knowledge({ status: "failed" }), createdAt: 10, text })

    expect(item).toMatchObject({
      key: "srv\0failure\0knowledge\0lib_1",
      kind: "failure",
      status: "failed",
      title: "inbox.item.knowledge.failure.title:Handbook",
      summary: "inbox.item.knowledge.failure.summary",
    })
  })

  test("leaves out libraries that are not finished", () => {
    for (const status of ["empty", "indexing", "stale"] as const)
      expect(knowledgeItem({ server: "srv", library: knowledge({ status }), createdAt: 10, text })).toBe(undefined)
  })
})
