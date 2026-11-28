import { createRoot, createSignal, useContext, type JSX } from "solid-js"
import { RouterContext } from "@solidjs/router"

// solid-router keys its outlet by the matched path, so navigating between two sessions rebuilds the route
// component and everything below it: the screen, its composer and the timeline rows mount from scratch, which
// is the measured 80-100 ms activation task. The screen and the timeline cache were written to survive that
// (inputs read through retained accessors, per-session keys), so the ready view renders once per session into
// a detached root here and a later switch to the same session moves the existing DOM back in instead.
const MAX_CACHED_SESSION_VIEWS = 16

// Cached trees stay subscribed to this signal: it is how a detached view learns it is the selected session
// again, which re-arms its scroll restore and refreshes its retained inputs. A detached view never chases
// another session's route state: its params are pinned by the router-context snapshot below. The owner
// writes it from `onMount`, once the cached DOM is in the document: landing a detached tree reads zero
// scroll heights, which placed the first view wrong and jumped it after insertion.
const [selectedSessionKey, setSelectedSessionKey] = createSignal<string | undefined>(undefined)

export function useSelectedSessionKey() {
  return selectedSessionKey
}

export { setSelectedSessionKey }

type CachedView = {
  element: JSX.Element
  dispose: () => void
}

const views = new Map<string, CachedView>()

// A render that suspends throws before its root is recorded, and the boundary re-runs the same key once the
// resource resolves: the earlier half-built root would otherwise keep its computations subscribed to the
// server store with nobody left to dispose them.
const partialRoots = new Map<string, () => void>()

export function CachedSessionRouteView(props: { key: string; render: () => JSX.Element }) {
  const cached = views.get(props.key)

  if (cached) {
    views.delete(props.key)
    views.set(props.key, cached)

    return cached.element
  }

  // `useParams()` returns the router's one live params object, so a cached tree left the route with the
  // outlet: its request-model effects fired permission and form syncs for whichever session was routed
  // next. A sync against a draft session that had not been created yet answered 404, which the data layer
  // reads as deletion and evicts, and the route judged the real session not-found. Snapshot the router
  // context at creation so the whole detached subtree keeps reading the params of the session it renders.
  const router = useContext(RouterContext)
  const pinned = router ? { ...router, params: { ...router.params } } : router

  partialRoots.get(props.key)?.()

  const view = createRoot((dispose) => {
    partialRoots.set(props.key, dispose)

    return {
      element: <RouterContext.Provider value={pinned}>{props.render()}</RouterContext.Provider>,
      dispose,
    }
  })

  partialRoots.delete(props.key)
  views.set(props.key, view)

  while (views.size > MAX_CACHED_SESSION_VIEWS) {
    const oldest = views.keys().next()

    if (oldest.done) break

    const entry = views.get(oldest.value)
    views.delete(oldest.value)

    if (entry) entry.dispose()
  }

  return view.element
}
