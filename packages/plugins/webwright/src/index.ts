import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import manifest from "../ocplugin.json" with { type: "json" }
import { BrowserRuntime } from "./browser.js"
import { BrowserTools } from "./tools.js"

export default Plugin.define({
  id: manifest.id,
  // The manifest is the single source of truth for what the plugin browser shows: the same file is what discovery
  // reads before the package is installed, so the two views cannot drift.
  display: {
    name: manifest.display.name,
    description: manifest.display.description,
    category: manifest.display.category,
    skills: manifest.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
    })),
    tools: manifest.display.tools,
  },
  effect: (ctx) =>
    Effect.gen(function* () {
      // The browser starts lazily on the first tool call, so activating the plugin never opens a window.
      const runtime = yield* Effect.acquireRelease(
        Effect.sync(() => BrowserRuntime.create(ctx.options)),
        (value) => Effect.promise(() => value.dispose()),
      )
      yield* BrowserTools.register(ctx, runtime)
    }),
})
