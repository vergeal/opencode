import type { ServerApi } from "@/runtime/server/api"
import type { KnowledgeFile } from "./store"

/**
 * Asks the server for one sentence describing the library, using its smallest text model so
 * describing a folder stays cheap.
 */
export async function generateLibrarySummary(input: {
  api: ServerApi
  name: string
  files: ReadonlyArray<KnowledgeFile>
}): Promise<string | undefined> {
  if (!input.files.length) return

  const listing = input.files
    .slice(0, 40)
    .map((file) => `- ${file.path}`)
    .join("\n")
  const prompt = [
    "Describe what this local knowledge base is about in one short sentence of at most 20 words.",
    "Reply with the sentence only, in the main language of the file names.",
    "",
    `Library: ${input.name}`,
    `Files (${input.files.length}):`,
    listing,
  ].join("\n")

  try {
    const result = await input.api.generate.text({ prompt, small: true })
    const text = result.text?.trim()

    return text ? text.replace(/^["'“”]+|["'“”]+$/g, "").slice(0, 200) : undefined
  } catch {
    return undefined
  }
}
