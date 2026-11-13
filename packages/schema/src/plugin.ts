export * as Plugin from "./plugin.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"
import { PluginManifest } from "./plugin-manifest.js"

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

/**
 * Why a plugin is not running, in a form a client can translate. `error` carries the technical detail; this carries
 * the one fact the UI needs, so the app does not display English written by the server.
 */
export type Reason = typeof Reason.Type
export const Reason = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("transform-failed"), state: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("activation-timeout"), seconds: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("load-timeout"), seconds: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("load-failed") }),
]).annotate({ identifier: "Plugin.Reason" })

export const State = Schema.Union([
  Schema.Struct({ status: Schema.Literal("active") }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    error: Schema.String,
    ref: Schema.String.pipe(optional),
    reason: Reason.pipe(optional),
  }),
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

/**
 * A plugin's isolated runtime environment, prepared by the host from its manifest's `runtime`. Absent for a plugin
 * that declares none, which is every plugin that does not use an interpreter.
 */
export interface Runtime extends Schema.Schema.Type<typeof Runtime> {}
export const Runtime = Schema.Struct({
  status: Schema.Literals(["ready", "preparing", "failed"]),
  /** Which step preparation is on. Present only with `preparing`; a ready or failed environment has no step to report. */
  phase: optional(Schema.Literals(["runtime", "dependencies"])),
  /** Why preparing failed. Present only with `failed`. */
  error: optional(Schema.String),
  /** A reference to the server log entry for the failure. Present only with `failed`. */
  ref: optional(Schema.String),
}).annotate({ identifier: "Plugin.Runtime" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID.pipe(optional),
  source: Source,
  features: Features,
  state: State,
  display: Display.pipe(optional),
  runtime: Runtime.pipe(optional),
}).annotate({ identifier: "Plugin.Info" })

/**
 * One plugin id found in the local discover directory, with every bundle version that is available to install. The
 * display data comes from the newest bundle's manifest, so an uninstalled plugin reads exactly like an installed one.
 */
export interface LocalEntry extends Schema.Schema.Type<typeof LocalEntry> {}
export const LocalEntry = Schema.Struct({
  id: Schema.String,
  display: Display.pipe(optional),
  /** The interpreter requirement the newest bundle declares, so a card can say what installing it prepares. */
  runtime: PluginManifest.Runtime.pipe(optional),
  versions: Schema.Array(
    Schema.Struct({
      version: Schema.String,
      /** The `.ocplugin` file name inside the version's directory. */
      file: Schema.String,
    }),
  ),
}).annotate({ identifier: "Plugin.LocalEntry" })

const Updated = ephemeral({
  type: "plugin.updated",
  schema: {},
})
export const Event = { Updated, Definitions: inventory(Updated) }

/** What a plugin controls about one message it published into the app's inbox. */
export const InboxStatus = Schema.Literals(["pending", "done", "failed"])
export type InboxStatus = typeof InboxStatus.Type

/**
 * One message a plugin published into the app's inbox, as the app reads it. `plugin` is the publisher, so the app can
 * hand the message to that plugin's `InboxContent` renderer. `status` is the plugin's own judgement; `seen` is the
 * user's.
 */
export interface InboxRecord extends Schema.Schema.Type<typeof InboxRecord> {}
export const InboxRecord = Schema.Struct({
  id: Schema.String,
  plugin: ID,
  /** The publisher's id for the message; unique within the plugin. */
  externalID: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  status: InboxStatus,
  createdAt: Schema.Finite,
  expiresAt: Schema.Finite.pipe(optional),
  payload: Schema.Unknown.pipe(optional),
  seen: Schema.Boolean,
  updatedAt: Schema.Finite,
}).annotate({ identifier: "Plugin.InboxRecord" })

