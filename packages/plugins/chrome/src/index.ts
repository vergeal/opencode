import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import manifest from "../ocplugin.json" with { type: "json" }
import { ChromeBridge } from "./bridge.js"
import { ChromeTools } from "./tools.js"

export default Plugin.define({
  id: manifest.id,
  // Enabled from the plugin browser, not on first launch, so a new user chooses it instead of finding a Chrome window
  // the agent opened on its own.
  defaultEnabled: false,
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
      const bridge = yield* ChromeBridge.make(ctx)
      yield* ChromeTools.register(ctx, bridge)
    }),
})
