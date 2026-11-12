const MAX_TITLEBAR_HISTORY = 100

type TitlebarAction = "back" | "forward" | undefined

export type HistoryLocation = { url: string; state?: unknown }

export type TitlebarHistory = {
  stack: HistoryLocation[]
  index: number
  action: TitlebarAction
}

/**
 * What makes two visits the same place: the whole address (`pathname + search + hash`) plus the route state that
 * distinguishes panes with an unchanged address, such as a settings tab or an explore selection.
 */
export function locationKey(location: HistoryLocation) {
  return `${location.url}\u0000${serialize(location.state)}`
}

function serialize(value: unknown): string {
  if (value === undefined) return "undefined"

  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined"

  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key])}`)

  return `{${entries.join(",")}}`
}

export function sameLocation(left: HistoryLocation, right: HistoryLocation) {
  return locationKey(left) === locationKey(right)
}

export function applyPath(
  state: TitlebarHistory,
  current: HistoryLocation,
  max = MAX_TITLEBAR_HISTORY,
): TitlebarHistory {
  if (!state.stack.length) return { stack: [current], index: 0, action: undefined }

  const active = state.stack[state.index]

  if (!active) return { stack: [current], index: 0, action: undefined }

  // Back and forward moved the index before navigating. Accept where the router landed: the target itself, or a
  // redirect that rewrote the address (a replace, never a new entry).
  if (state.action) return sameLocation(active, current) ? { ...state, action: undefined } : replaceAt(state, current)

  if (sameLocation(active, current)) return state

  // One address with a different route state is a redirect or an in-place pane change, so it rewrites the entry
  // rather than stacking a second visit. Settings panes navigate with `replace`, so they keep one entry too.
  if (active.url === current.url || (isSettingsPath(active.url) && isSettingsPath(current.url))) {
    return replaceAt(state, current)
  }

  return pushPath(state, current, max)
}

function isSettingsPath(url: string) {
  return url.split(/[?#]/, 1)[0] === "/settings"
}

function replaceAt(state: TitlebarHistory, current: HistoryLocation): TitlebarHistory {
  return {
    ...state,
    stack: state.stack.map((entry, index) => (index === state.index ? current : entry)),
    action: undefined,
  }
}

function pushPath(state: TitlebarHistory, path: HistoryLocation, max = MAX_TITLEBAR_HISTORY): TitlebarHistory {
  const stack = state.stack.slice(0, state.index + 1).concat(path)
  const next = trimHistory(stack, stack.length - 1, max)

  return { ...state, ...next, action: undefined }
}

function trimHistory(stack: HistoryLocation[], index: number, max = MAX_TITLEBAR_HISTORY) {
  if (stack.length <= max) return { stack, index }
  const cut = stack.length - max

  return {
    stack: stack.slice(cut),
    index: Math.max(0, index - cut),
  }
}

export function backPath(state: TitlebarHistory) {
  if (state.index <= 0) return
  const index = state.index - 1
  const to = state.stack[index]

  if (!to) return

  return { state: { ...state, index, action: "back" as const }, to }
}

export function forwardPath(state: TitlebarHistory) {
  if (state.index >= state.stack.length - 1) return
  const index = state.index + 1
  const to = state.stack[index]

  if (!to) return

  return { state: { ...state, index, action: "forward" as const }, to }
}
