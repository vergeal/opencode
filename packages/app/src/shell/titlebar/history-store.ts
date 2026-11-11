import { createEffect, untrack } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { applyPath, backPath, forwardPath, type HistoryLocation } from "./history"

/**
 * The window's back and forward stack. Both titlebars read it, so the replica controls move through the same
 * entries as the app menu commands instead of depending on the browser's own history.
 */
export function createTitlebarHistory() {
  const navigate = useNavigate()
  const location = useLocation()
  const [history, setHistory] = createStore<{
    stack: HistoryLocation[]
    index: number
    action: "back" | "forward" | undefined
  }>({
    stack: [],
    index: 0,
    action: undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = { url: path(), state: location.state }

    untrack(() => {
      const next = applyPath(history, current)

      if (next === history) return
      setHistory(next)
    })
  })

  const back = () => {
    const next = backPath(history)

    if (!next) return
    setHistory(next.state)
    navigate(next.to.url, { state: unwrap(next.to.state) })
  }

  const forward = () => {
    const next = forwardPath(history)

    if (!next) return
    setHistory(next.state)
    navigate(next.to.url, { state: unwrap(next.to.state) })
  }

  return {
    path,
    back,
    forward,
    canBack: () => history.index > 0,
    canForward: () => history.index < history.stack.length - 1,
  }
}
