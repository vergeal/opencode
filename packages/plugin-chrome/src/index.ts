import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { ChromeBridge } from "./bridge.js"
import { ChromeTools } from "./tools.js"

export default Plugin.define({
  id: "opencode.chrome",
  effect: (ctx) =>
    Effect.gen(function* () {
      const bridge = yield* ChromeBridge.make(ctx)
      yield* ChromeTools.register(ctx, bridge)
    }),
})
