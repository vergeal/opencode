import { describe, expect, test } from "bun:test"
import { isPopularProvider, popularProviders, providerRank } from "./order"

describe("provider order", () => {
  test("pins the providers the client recommends", () => {
    expect([...popularProviders]).toEqual([
      "opencode-go",
      "opencode",
      "anthropic",
      "openai",
      "github-copilot",
      "google",
      "openrouter",
      "vercel",
    ])
  })

  test("ranks a pinned provider by its position", () => {
    expect(providerRank("openai")).toBe(popularProviders.indexOf("openai"))
  })

  // The point of the module: a provider outside the pinned set is ranked, never hidden.
  test("ranks a provider outside the pinned set last instead of dropping it", () => {
    expect(providerRank("groq")).toBe(Number.MAX_SAFE_INTEGER)
    expect(isPopularProvider("groq")).toBe(false)
  })
})
