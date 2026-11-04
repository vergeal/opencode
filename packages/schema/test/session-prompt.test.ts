import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Session } from "../src/session.js"

const decode = Schema.decodeUnknownOption(Session.Prompt)

describe("Session.Prompt", () => {
  test("accepts instructions at the character limit", () => {
    expect(decode("字".repeat(Session.PromptLimit))._tag).toBe("Some")
  })

  test("counts characters rather than UTF-16 units", () => {
    expect(decode("😀".repeat(Session.PromptLimit))._tag).toBe("Some")
    expect(decode("😀".repeat(Session.PromptLimit + 1))._tag).toBe("None")
  })

  test("rejects instructions past the character limit", () => {
    expect(decode("字".repeat(Session.PromptLimit + 1))._tag).toBe("None")
  })
})
