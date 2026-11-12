export * as Plugin from "./plugin.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"), Schema.annotate({ identifier: "Plugin.ID" }))
export type ID = typeof ID.Type

export const Source = Schema.Union([
  Schema.Struct({ type: Schema.Literal("builtin") }),
  Schema.Struct({
    type: Schema.Literal("package"),
    target: Schema.String,
    version: Schema.String.pipe(optional),
    outdated: Schema.Literal(true).pipe(optional),
    updating: Schema.Literal(true).pipe(optional),
  }),
  Schema.Struct({ type: Schema.Literal("local"), path: Schema.String }),
  Schema.Struct({ type: Schema.Literal("sdk") }),
]).annotate({ identifier: "Plugin.Source" })
export type Source = typeof Source.Type

export const Features = Schema.Struct({
  server: Schema.Literal(true).pipe(optional),
  tui: Schema.Literal(true).pipe(optional),
  rpc: Schema.Literal(true).pipe(optional),
  /** The package exports `./gui-experimental`, the GUI bundle the desktop app loads. */
  gui: Schema.Literal(true).pipe(optional),
}).annotate({ identifier: "Plugin.Features" })
export type Features = typeof Features.Type

/** A plugin's prebuilt CommonJS `./gui-experimental` bundle. */
export interface GuiBundle extends Schema.Schema.Type<typeof GuiBundle> {}
export const GuiBundle = Schema.Struct({
  /** The bundle's CommonJS code. */
  code: Schema.String,
  /** An opaque value that changes whenever the plugin, its options or its bundle change. */
  revision: Schema.String,
  /** The plugin's options from its `opencode.json` entry, as its server entry receives them. */
  options: Schema.Record(Schema.String, Schema.Json),
}).annotate({ identifier: "Plugin.GuiBundle" })

export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("active") }),
  Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String, ref: Schema.String.pipe(optional) }),
]).annotate({ identifier: "Plugin.State" })
export type State = typeof State.Type

/**
 * What a plugin shows in the app's plugin browser. A built-in plugin omits it to stay out of the browser; a plugin
 * that declares it appears with the skills and tools it contributes, so one entry reads as one capability bundle.
 */
export interface Display extends Schema.Schema.Type<typeof Display> {}
export const Display = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** The shelf the plugin browser groups the entry under. */
  category: Schema.String.pipe(optional),
  /** Skills the plugin registers when it loads. */
  skills: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.String,
    }),
  ).pipe(optional),
  /** Tool name prefixes the plugin registers, such as `chrome.*`. */
  tools: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Plugin.Display" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID.pipe(optional),
  source: Source,
  features: Features,
  state: State,
  display: Display.pipe(optional),
}).annotate({ identifier: "Plugin.Info" })

const Updated = ephemeral({
  type: "plugin.updated",
  schema: {},
})
export const Event = { Updated, Definitions: inventory(Updated) }
