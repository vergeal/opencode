import { createStore } from "solid-js/store"
import type { KnowledgeImportProgress } from "@/runtime/platform/platform"

/** One import the workspace is following; `summarize` is the description request after the files land. */
export type KnowledgeImportJob = Omit<KnowledgeImportProgress, "stage"> & {
  stage: KnowledgeImportProgress["stage"] | "summarize"
}

const [state, setState] = createStore<{ jobs: Record<string, KnowledgeImportJob> }>({ jobs: {} })

/**
 * Import progress lives outside the route: the desktop process keeps importing after the user leaves
 * the knowledge workspace, so coming back must show the run instead of an empty library.
 */
export const knowledgeImports = {
  get: (libraryID: string) => state.jobs[libraryID],
  begin: (libraryID: string) =>
    setState("jobs", libraryID, {
      libraryID,
      stage: "scan",
      current: "",
      processed: 0,
      total: 0,
      kept: 0,
      duplicates: 0,
      similar: 0,
      skipped: 0,
    }),
  /** Progress from the desktop process, or the run it reports when the workspace reopens. */
  update: (progress: KnowledgeImportProgress) => setState("jobs", progress.libraryID, { ...progress }),
  stage: (libraryID: string, stage: KnowledgeImportJob["stage"]) => {
    if (!state.jobs[libraryID]) return

    setState("jobs", libraryID, "stage", stage)
  },
  end: (libraryID: string) =>
    setState("jobs", (jobs) => {
      if (!jobs[libraryID]) return jobs

      const next = { ...jobs }
      delete next[libraryID]

      return next
    }),
}
