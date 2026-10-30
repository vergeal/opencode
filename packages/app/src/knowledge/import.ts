import type { Platform } from "@/runtime/platform/platform"
import type { KnowledgeFile } from "./store"

/**
 * Asks the desktop main process for a directory and indexes every readable file under it.
 * The web build has no filesystem access, so it resolves nothing and the UI explains why.
 */
export async function importKnowledgeDirectory(input: {
  platform: Platform
  title: string
}): Promise<{ root: string; files: KnowledgeFile[] } | undefined> {
  if (input.platform.platform !== "desktop") return
  const picked = await input.platform.openDirectoryPickerDialog({ title: input.title })
  const root = Array.isArray(picked) ? picked[0] : picked
  if (!root) return
  const scan = await input.platform.scanKnowledgeDirectory?.(root)

  return { root, files: [...(scan?.files ?? [])] }
}
