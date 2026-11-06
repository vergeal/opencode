import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Session } from "../src/session.js"

const decode = Schema.decodeUnknownOption(Session.Prompt)

describe("Session.Prompt", () => {
  test("accepts instructions without a length cap", () => {
    // Regression: the contract used to reject anything past 2000 characters.
    expect(decode("字".repeat(10_000))._tag).toBe("Some")
  })

  test("accepts emoji past the old limit", () => {
    expect(decode("😀".repeat(10_000))._tag).toBe("Some")
  })
})
