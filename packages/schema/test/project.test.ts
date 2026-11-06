import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Project } from "../src/project.js"

const decode = Schema.decodeUnknownOption(Project.Prompt)

describe("Project.Prompt", () => {
  test("accepts instructions without a length cap", () => {
    // Regression: the contract used to reject anything past 1000 characters.
    expect(decode("字".repeat(10_000))._tag).toBe("Some")
  })

  test("accepts emoji past the old limit", () => {
    expect(decode("😀".repeat(10_000))._tag).toBe("Some")
  })
})
