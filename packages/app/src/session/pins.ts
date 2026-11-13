import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"

const PinnedSessions = Persistence.struct({
  pinned: Persistence.array(Schema.String),
})

// Shared by the Home session list and the vertical tab strip, so a session pinned in either place is pinned in both.
export function usePinnedSessions() {
  const [state, setState] = persisted({ ...Persist.global("home.pinned-sessions"), sync: true }, PinnedSessions, {
    pinned: [],
  })

  return {
    ids: () => state.pinned,
    isPinned: (sessionID: string) => state.pinned.includes(sessionID),
    toggle: (sessionID: string) =>
      setState("pinned", (current) =>
        current.includes(sessionID) ? current.filter((id) => id !== sessionID) : [sessionID, ...current],
      ),
    remove: (sessionIDs: readonly string[]) =>
      setState("pinned", (current) => current.filter((id) => !sessionIDs.includes(id))),
    /** Keeps the ids the user dragged into order first and leaves anything else where it was. */
    reorder: (sessionIDs: readonly string[]) =>
      setState("pinned", (current) => [
        ...sessionIDs.filter((id) => current.includes(id)),
        ...current.filter((id) => !sessionIDs.includes(id)),
      ]),
  }
}
