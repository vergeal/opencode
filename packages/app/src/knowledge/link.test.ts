import { expect, test } from "bun:test"
import type { Platform } from "@/runtime/platform/platform"
import type { ServerApi } from "@/runtime/server/api"
import type { KnowledgeLibrary } from "./store"
import { linkKnowledgeLibrary } from "./link"

const library: KnowledgeLibrary = {
  id: "library-1",
  name: "Handbook",
  summary: "",
  createdAt: 0,
  files: [
    {
      path: "handbook.md",
      name: "handbook.md",
      size: 18,
      kind: "text",
      root: "",
      source: "/tmp/handbook.md",
    },
  ],
  sources: [],
}

type Failures = { sync?: Error; assign?: Error }

/** Records each server call in order, so a test can assert what ran and what did not. */
function fakeServer(calls: string[], failures: Failures) {
  const knowledge = {
    sync: async () => {
      calls.push("sync")

      if (failures.sync) throw failures.sync

      return { libraryID: library.id }
    },
    assign: async () => {
      calls.push("assign")

      if (failures.assign) throw failures.assign

      return { projectID: "project-1", libraryID: library.id }
    },
    unassign: async () => {
      calls.push("unassign")
    },
  }

  // SAFETY: linkKnowledgeLibrary only reaches sync, assign and unassign, all of which are implemented above.
  return { api: { experimental: { "server.knowledge": knowledge } } as unknown as ServerApi }
}

function fakePlatform(calls: string[]) {
  const readKnowledgeFile: Platform["readKnowledgeFile"] = async () => {
    calls.push("read")

    return { text: "# Handbook" }
  }

  // SAFETY: syncKnowledgeLibrary only reads files through readKnowledgeFile, implemented above.
  return { platform: { platform: "web", readKnowledgeFile } as Platform }
}

test("uploads the local text before assigning the library", async () => {
  const calls: string[] = []
  const { api } = fakeServer(calls, {})
  const { platform } = fakePlatform(calls)

  await linkKnowledgeLibrary({ api, platform, library, projectID: "project-1" })

  expect(calls).toEqual(["read", "sync", "assign"])
})

test("never assigns when the upload fails, and rolls back", async () => {
  const calls: string[] = []
  const failure = new Error("reading the library failed")
  const { api } = fakeServer(calls, { sync: failure })
  const { platform } = fakePlatform(calls)

  const link = linkKnowledgeLibrary({ api, platform, library, projectID: "project-1" })

  await expect(link).rejects.toThrow(failure)
  expect(calls).toEqual(["read", "sync", "unassign"])
})

test("rolls back the assignment when assigning fails", async () => {
  const calls: string[] = []
  const failure = new Error("assigning the library failed")
  const { api } = fakeServer(calls, { assign: failure })
  const { platform } = fakePlatform(calls)

  const link = linkKnowledgeLibrary({ api, platform, library, projectID: "project-1" })

  await expect(link).rejects.toThrow(failure)
  expect(calls).toEqual(["read", "sync", "assign", "unassign"])
})
