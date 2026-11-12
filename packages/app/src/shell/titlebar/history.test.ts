import { describe, expect, test } from "bun:test"
import { applyPath, backPath, forwardPath, sameLocation, type HistoryLocation, type TitlebarHistory } from "./history"

function history(): TitlebarHistory {
  return { stack: [], index: 0, action: undefined }
}

/** Walks the history the way the store does: push the address, then let the router report where it landed. */
function visit(state: TitlebarHistory, location: HistoryLocation, max?: number) {
  return applyPath(state, location, max)
}

function back(state: TitlebarHistory) {
  const next = backPath(state)
  if (!next) return next

  return { to: next.to, state: applyPath(next.state, next.to) }
}

function forward(state: TitlebarHistory) {
  const next = forwardPath(state)
  if (!next) return next

  return { to: next.to, state: applyPath(next.state, next.to) }
}

const DESTINATIONS = [
  "/",
  "/inbox",
  "/scheduled",
  "/explore",
  "/knowledge",
  "/settings",
  "/server/srv_1/session/ses_1",
  "/server/srv_1/session/ses_2",
  "/inbox?filter=failed",
  "/explore?plugin=github",
  "/knowledge?library=docs",
  "/scheduled?filter=active#today",
]

describe("titlebar history", () => {
  test("trims to the maximum and keeps back and forward indexes correct", () => {
    const state = ["/", "/a", "/b", "/c"].reduce((current, url) => applyPath(current, { url }, 3), history())

    expect(state.stack.map((entry) => entry.url)).toEqual(["/a", "/b", "/c"])
    expect(state.index).toBe(2)

    const first = back(state)
    expect(first?.to.url).toBe("/b")
    expect(first?.state.index).toBe(1)

    const second = forward(first!.state)
    expect(second?.to.url).toBe("/c")
    expect(second?.state.index).toBe(2)
  })

  test("records twelve destinations and still walks back ten of them", () => {
    let state = DESTINATIONS.reduce((current, url) => visit(current, { url }), history())

    expect(state.stack.map((entry) => entry.url)).toEqual(DESTINATIONS)
    expect(state.index).toBe(DESTINATIONS.length - 1)

    for (let step = 0; step < 10; step++) {
      const next = back(state)
      expect(next).toBeDefined()
      state = next!.state
    }

    expect(state.index).toBe(1)
    expect(state.stack[state.index]?.url).toBe(DESTINATIONS[1])

    const remaining = back(state)
    expect(remaining?.to.url).toBe(DESTINATIONS[0])
  })

  test("back and forward return to the position they started from", () => {
    const initial = DESTINATIONS.reduce((current, url) => visit(current, { url }), history())
    const walked = Array.from({ length: 5 }).reduce<TitlebarHistory>((current) => back(current)!.state, initial)

    expect(walked.index).toBe(DESTINATIONS.length - 6)

    const returned = Array.from({ length: 5 }).reduce<TitlebarHistory>((current) => forward(current)!.state, walked)

    expect(returned.index).toBe(initial.index)
    expect(returned.stack).toEqual(initial.stack)
    expect(returned.stack[returned.index]).toEqual(initial.stack[initial.index])
  })

  test("records a consecutive duplicate once", () => {
    const state = visit(visit(visit(history(), { url: "/inbox" }), { url: "/inbox" }), { url: "/inbox" })

    expect(state.stack.map((entry) => entry.url)).toEqual(["/inbox"])
    expect(state.index).toBe(0)
  })

  test("restores the whole address, including search and hash", () => {
    const target = { url: "/scheduled?filter=active&sort=recent#today" }
    const state = visit(visit(visit(history(), { url: "/inbox" }), target), { url: "/knowledge" })
    const previous = back(state)!

    expect(previous.to).toEqual(target)
    expect(previous.state.stack[previous.state.index]).toEqual(target)
  })

  test("restores the route state that distinguishes panes at one address", () => {
    const first = { url: "/explore", state: { selection: { plugin: "github" } } }
    const second = { url: "/explore", state: { selection: { plugin: "linear" } } }
    const state = visit(visit(visit(history(), first), { url: "/inbox" }), second)

    expect(state.stack.map((entry) => entry.url)).toEqual(["/explore", "/inbox", "/explore"])

    const toInbox = back(state)!
    const toExplore = back(toInbox.state)!
    expect(toExplore.to).toEqual(first)
  })

  test("compares route state structurally, not by object identity", () => {
    const location = { url: "/inbox", state: { filter: "failed" } }
    const state = visit(history(), location)

    expect(sameLocation(state.stack[state.index]!, { ...location, state: { filter: "failed" } })).toBe(true)

    const unchanged = visit(state, { ...location, state: { filter: "failed" } })
    expect(unchanged).toBe(state)
    expect(unchanged.stack).toHaveLength(state.stack.length)
  })

  test("action-driven navigation does not push duplicate history entries", () => {
    const state: TitlebarHistory = {
      stack: [{ url: "/" }, { url: "/a" }, { url: "/b" }],
      index: 2,
      action: undefined,
    }

    const next = back(state)
    expect(next?.to.url).toBe("/a")
    expect(next!.state.stack.map((entry) => entry.url)).toEqual(["/", "/a", "/b"])
    expect(next!.state.index).toBe(1)
    expect(next!.state.action).toBeUndefined()
  })

  test("a redirect while going back rewrites the landing entry instead of appending", () => {
    const state: TitlebarHistory = {
      stack: [{ url: "/" }, { url: "/a" }, { url: "/b" }],
      index: 2,
      action: undefined,
    }

    const next = backPath(state)!
    const landed = applyPath(next.state, { url: "/a/session/ses_9" })

    expect(landed.stack.map((entry) => entry.url)).toEqual(["/", "/a/session/ses_9", "/b"])
    expect(landed.index).toBe(1)
    expect(landed.action).toBeUndefined()
  })

  test("settings panes replace their entry but keep the state to restore", () => {
    const general = { url: "/settings?tab=general", state: { settings: { view: { target: { tab: "general" } } } } }
    const models = { url: "/settings?tab=models", state: { settings: { view: { target: { tab: "models" } } } } }
    const state = visit(visit(visit(history(), general), models), { url: "/inbox" })

    expect(state.stack.map((entry) => entry.url)).toEqual(["/settings?tab=models", "/inbox"])

    const previous = back(state)!
    expect(previous.to).toEqual(models)
  })

  test("settings visits retain their own route state", () => {
    const first = { url: "/settings", state: { settings: { type: "draft", draftID: "a" } } }
    const second = { url: "/settings", state: { settings: { type: "draft", draftID: "b" } } }
    const state = applyPath(applyPath(applyPath(history(), first), { url: "/b" }), second)
    const backToB = back(state)!
    const previous = back(backToB.state)!

    expect(previous.to).toEqual(first)
    expect(forward(backToB.state)?.to).toEqual(second)
  })
})
