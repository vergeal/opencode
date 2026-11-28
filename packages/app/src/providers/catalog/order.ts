/**
 * Providers pinned to the top of every provider list, in this order. Everything else still appears, sorted by name
 * after these — this is a ranking, not an allowlist.
 *
 * This client ships no allowlist: a curated set hid providers a user had already connected, which left their models
 * unreachable from every picker. Anything a user needs is either in the server's own catalog or a custom provider
 * their configuration declares.
 */
export const popularProviders = [
  "opencode-go",
  "opencode",
  "anthropic",
  "openai",
  "github-copilot",
  "google",
  "openrouter",
  "vercel",
]

/** Whether a provider belongs to the pinned set rather than to the rest of the catalog. */
export function isPopularProvider(id: string) {
  return popularProviders.includes(id)
}

/** Sort rank for a provider: the pinned order first, then everything else at the same rank. */
export function providerRank(id: string) {
  const index = popularProviders.indexOf(id)

  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}
