import type { ServerApi } from "@/runtime/server/api"
import type { KnowledgeFileExcerpt } from "@/runtime/platform/platform"
import type { KnowledgeFlag } from "./store"

/** Documents reviewed at once; a larger import is described by its first documents. */
const MAX_EXCERPTS = 40

const MAX_SUMMARY = 200

const MAX_FLAGS = 60

// Summaries are optional; a provider that never answers must not leave the import running forever.
const REVIEW_TIMEOUT_MS = 30_000

export type LibraryReview = {
  summary?: string
  /** Documents that clearly do not help the library, as described when it was created. */
  irrelevant: KnowledgeFlag[]
}

/**
 * Asks the server for one sentence describing the library and for the documents that do not fit the
 * description the user wrote. One small call per import covers both, so judging a folder stays
 * cheap: excerpts are opening text, not whole documents.
 */
export async function reviewLibrary(input: {
  api: ServerApi
  name: string
  description: string
  excerpts: ReadonlyArray<KnowledgeFileExcerpt>
}): Promise<LibraryReview> {
  if (!input.excerpts.length) return { irrelevant: [] }

  const listing = input.excerpts
    .slice(0, MAX_EXCERPTS)
    .map((item) => `- ${item.path}: ${item.excerpt}`)
    .join("\n")
  const description = input.description.trim()
  // Without a description there is nothing to judge against, so ask only for the summary.
  const instructions = description
    ? [
        "Reply with JSON only, in this shape:",
        '{"summary":"one introduction of at most 40 words describing the knowledge base","irrelevant":[{"path":"a library path","reason":"at most 12 words"}]}',
        `The library was created for this purpose: "${description}". Write summary as one introduction that merges that purpose with what the documents actually contain. Do not repeat the purpose word for word and do not write two separate descriptions.`,
        "Write in the main language of the documents. List a document as irrelevant only when it clearly does not help this knowledge base; if everything fits, return an empty irrelevant list.",
      ]
    : [
        "Reply with JSON only, in this shape:",
        '{"summary":"one introduction of at most 40 words describing the knowledge base"}',
        "Write in the main language of the documents.",
      ]
  const prompt = [
    `You maintain a local knowledge base named "${input.name}".`,
    ...(description ? [`What it is for: ${description}`] : []),
    "",
    ...instructions,
    "",
    "Documents:",
    listing,
  ].join("\n")

  try {
    const result = await input.api.generate.text(
      { prompt, small: true },
      { signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS) },
    )
    const text = result.text?.trim()

    if (!text) return { irrelevant: [] }
    const review = parseReview(text)

    return { summary: review.summary, irrelevant: description ? review.irrelevant : [] }
  } catch {
    return { irrelevant: [] }
  }
}

/** Providers sometimes wrap JSON in prose or a code fence; anything unparsable becomes the summary. */
function parseReview(text: string): LibraryReview {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")

  if (start === -1 || end <= start) return { summary: cleanSummary(text), irrelevant: [] }

  try {
    // SAFETY: the parsed value is read field by field below and every field is type-checked.
    const value = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; irrelevant?: unknown }
    const summary = typeof value.summary === "string" ? cleanSummary(value.summary) : undefined

    return { summary, irrelevant: readFlags(value.irrelevant) }
  } catch {
    return { summary: cleanSummary(text), irrelevant: [] }
  }
}

function readFlags(value: unknown): KnowledgeFlag[] {
  if (!Array.isArray(value)) return []

  return value
    .flatMap((item) => {
      // SAFETY: each entry is read field by field and only string paths are kept.
      const flag = item as { path?: unknown; reason?: unknown } | null
      if (!flag || typeof flag !== "object" || typeof flag.path !== "string" || !flag.path) return []

      return [{ path: flag.path, reason: typeof flag.reason === "string" ? flag.reason.trim() : "" }]
    })
    .slice(0, MAX_FLAGS)
}

function cleanSummary(text: string) {
  return text
    .replace(/^```[a-z]*\n?|```$/g, "")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .slice(0, MAX_SUMMARY)
}
