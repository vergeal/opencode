import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Project } from "../src/project.js"

const decode = Schema.decodeUnknownOption(Project.Prompt)

describe("Project.Prompt", () => {
  test("accepts a prompt at the character limit", () => {
    expect(decode("字".repeat(Project.PromptLimit))._tag).toBe("Some")
  })

  test("counts characters rather than UTF-16 units", () => {
    // Each of these is a surrogate pair: a UTF-16 length check would reject them far earlier.
    expect(decode("😀".repeat(Project.PromptLimit))._tag).toBe("Some")
    expect(decode("😀".repeat(Project.PromptLimit + 1))._tag).toBe("None")
  })

  test("rejects a prompt past the character limit", () => {
    expect(decode("字".repeat(Project.PromptLimit + 1))._tag).toBe("None")
  })
})
