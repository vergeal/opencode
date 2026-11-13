import { Location } from "@opencode/schema/location"
import { Plugin } from "@opencode/schema/plugin"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { InvalidRequestError, PluginNotFoundError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const PluginGroup = HttpApiGroup.make("server.plugin")
  .add(
    HttpApiEndpoint.get("plugin.list", "/api/plugin", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Plugin.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "plugin.list",
          summary: "List plugins",
          description: "Retrieve enabled server plugins and their current status.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("plugin.gui", "/api/plugin/gui", {
      query: Schema.Struct({
        ...LocationQuery.fields,
        id: Plugin.ID,
      }),
      success: Location.response(Plugin.GuiBundle),
      error: PluginNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "plugin.gui",
          summary: "Read plugin GUI bundle",
          description:
            "Read an active plugin's prebuilt CommonJS `./gui-experimental` bundle. Desktop app windows run its default export; the desktop app's main process runs its `main` export. Fails with not found when no active plugin has the id or the plugin exports no `./gui-experimental`.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.check", "/api/plugin/check", {
      query: LocationQuery,
      payload: Schema.Struct({ target: Schema.String.pipe(Schema.optional) }),
      success: Location.response(Schema.Array(Plugin.Info)),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "plugin.check",
          summary: "Check plugin updates",
          description: "Check one or all package plugins for available updates.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.update", "/api/plugin/update", {
      query: LocationQuery,
      payload: Schema.Struct({ targets: Schema.Array(Schema.String) }),
      success: HttpApiSchema.NoContent,
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "plugin.update",
          summary: "Update plugins",
          description:
            "Update package plugins concurrently and notify active locations to reload them. Responds once every update has finished; fails when any update fails.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("plugin.local", "/api/experimental/plugin/local", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Plugin.LocalEntry)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.plugin.local",
          summary: "List local plugin bundles",
          description:
            "Experimental: may change without compatibility guarantees. List every plugin id and version found in the local discover directory, with the display data from each id's newest bundle.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.bundle", "/api/experimental/plugin/bundle", {
      query: LocationQuery,
      payload: Schema.Struct({ id: Plugin.ID, version: Schema.String.pipe(Schema.optional) }),
      success: Location.response(Schema.Struct({ id: Plugin.ID, version: Schema.String, path: Schema.String })),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.plugin.bundle",
          summary: "Install a plugin bundle",
          description:
            "Experimental: may change without compatibility guarantees. Find a local .ocplugin bundle for this plugin id, verify its checksums, unpack it into the config plugins directory, and load it.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.uninstall", "/api/experimental/plugin/uninstall", {
      query: LocationQuery,
      payload: Schema.Struct({ id: Plugin.ID }),
      success: Location.response(Schema.Struct({ id: Plugin.ID, removed: Schema.Boolean })),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.plugin.uninstall",
          summary: "Uninstall a plugin bundle",
          description:
            "Experimental: may change without compatibility guarantees. Remove an installed .ocplugin bundle's directory so the host unloads it.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.reload", "/api/experimental/plugin/reload", {
      query: LocationQuery,
      payload: Schema.Struct({ id: Plugin.ID }),
      success: Location.response(Schema.Struct({ id: Plugin.ID })),
      error: PluginNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.plugin.reload",
          summary: "Retry a failed plugin",
          description:
            "Experimental: may change without compatibility guarantees. Clear one plugin's load backoff and ask the location's supervisor to activate again through its normal trigger queue. Fails with not found when no plugin in the current inventory has the id.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.runtimeRetry", "/api/experimental/plugin/runtime/retry", {
      query: LocationQuery,
      payload: Schema.Struct({ id: Plugin.ID }),
      success: Location.response(Schema.Struct({ id: Plugin.ID })),
      error: PluginNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.plugin.runtime.retry",
          summary: "Prepare a plugin runtime again",
          description:
            "Experimental: may change without compatibility guarantees. Prepare a plugin's interpreter environment again after it failed, without reloading the plugin itself. Replying means preparation started; its progress arrives as `Plugin.Event.Updated`. Fails with not found when no plugin in the current inventory declares a runtime.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("plugin.inbox.list", "/api/experimental/plugin/inbox", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Plugin.InboxRecord)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.plugin.inbox.list",
          summary: "List plugin inbox messages",
          description:
            "Experimental: may change without compatibility guarantees. Every message plugins published into the app's inbox in this location, with the plugin that published it. The app shows one list across plugins; a plugin only sees its own messages through `ctx.inbox.list`.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.inbox.mark", "/api/experimental/plugin/inbox/mark", {
      query: LocationQuery,
      payload: Schema.Struct({ id: Schema.String }),
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.plugin.inbox.mark",
          summary: "Mark a plugin inbox message read",
          description:
            "Experimental: may change without compatibility guarantees. Marks one published message read on the user's behalf and notifies its publisher's `ctx.inbox.onSeen`. An id no message owns is a no-op.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("plugin.inbox.delete", "/api/experimental/plugin/inbox/delete", {
      query: LocationQuery,
      payload: Schema.Struct({ id: Schema.String }),
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.plugin.inbox.delete",
          summary: "Delete a plugin inbox message",
          description:
            "Experimental: may change without compatibility guarantees. Deletes one published message on the user's behalf, whichever plugin it came from, together with its `externalID` and owner indexes. An id no message owns is a no-op, so deleting twice is safe. A plugin must not assume the messages it published still exist: the user may delete any of them at any time, and `ctx.inbox.list` is the only source of truth. The platform does not keep a deleted `externalID` deleted; publishing it again creates a new message, and a plugin that must not re-notify tracks that in its own state.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "plugin",
      description: "Experimental plugin routes.",
    }),
  )
