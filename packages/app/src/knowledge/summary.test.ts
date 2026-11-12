import { expect, test } from "bun:test"
import type { ServerApi } from "@/runtime/server/api"
import { reviewLibrary } from "./summary"

test("falls back when the summary request exceeds its deadline", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
  const controller = new AbortController()
  let timeout = 0

  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    value: (ms: number) => {
      timeout = ms

      return controller.signal
    },
  })

  const text: ServerApi["generate"]["text"] = async (_input, options) => {
    const signal = options?.signal

    if (!signal) return { text: '{"summary":"unbounded request"}' }

    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Timed out", "TimeoutError")), {
        once: true,
      })
    })
  }

  // SAFETY: reviewLibrary only calls generate.text, whose existing input and request options are implemented above.
  const api = { generate: { text } } as ServerApi

  try {
    const pending = reviewLibrary({
      api,
      name: "Handbook",
      description: "",
      excerpts: [{ path: "handbook.md", excerpt: "Employee handbook" }],
    })

    controller.abort()

    expect(timeout).toBe(30_000)
    expect(await pending).toEqual({ irrelevant: [] })
  } finally {
    if (descriptor) Object.defineProperty(AbortSignal, "timeout", descriptor)
  }
})
