/** Where a later segment of a path or slug begins: `/ocplugin-open-dev` in `ocdev/ocplugin-open-dev`. */
const segment = /[\s/\\\-_.:]/

/**
 * Ranks a title against a typed query: 0 for the exact title, 1 when the title starts with the query, 2 when a later
 * title word does, 3 when the query starts a later segment of a path or slug, and undefined otherwise. Each query word
 * must start consecutive title words, case-insensitively. A trailing space asks for one more title word, so `@HOME `
 * stops matching "HOME" and the popover gives way to prose.
 */
export function rankSessionTitle(title: string, query: string) {
  if (title.toLowerCase() === query.toLowerCase()) return 0
  const words = query.toLowerCase().split(" ")
  const titleWords = title.toLowerCase().split(/\s+/).filter(Boolean)

  const start = titleWords.findIndex((_, start) =>
    words.every((word, index) => titleWords[start + index]?.startsWith(word)),
  )

  if (start >= 0) return start === 0 ? 1 : 2

  // A multi-word query only matches whole title words, as it can span them.
  const needle = words[0]
  if (words.length > 1 || !needle) return
  const normalized = title.toLowerCase()

  for (let index = normalized.indexOf(needle); index >= 0; index = normalized.indexOf(needle, index + 1)) {
    const before = normalized[index - 1]

    // A query inside a word, such as "sole" in "console", is not a match: only a segment start is.
    if (before && segment.test(before)) return 3
  }
}
