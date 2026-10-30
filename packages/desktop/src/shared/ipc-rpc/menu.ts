import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

const DesktopMenuAction = Schema.Literals([
  "app.installCli",
  "app.relaunch",
  "edit.undo",
  "edit.redo",
  "edit.cut",
  "edit.copy",
  "edit.paste",
  "edit.delete",
  "edit.selectAll",
  "view.reload",
  "view.toggleDevTools",
  "view.resetZoom",
  "view.zoomIn",
  "view.zoomOut",
  "view.toggleFullscreen",
  "window.new",
  "window.close",
  "window.minimize",
  "window.toggleMaximize",
])

export const MenuRunAction = Rpc.make("MenuRunAction", {
  payload: { action: DesktopMenuAction },
})

const ContextMenuEntry = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.Literals(["normal", "separator"])),
  enabled: Schema.optionalKey(Schema.Boolean),
})

/** A native context menu built by the main process; the chosen entry's id comes back, or nothing when dismissed. */
export const MenuShowContext = Rpc.make("MenuShowContext", {
  payload: {
    items: Schema.Array(ContextMenuEntry),
    /** Window-relative point to open at; the pointer position is used when omitted. */
    x: Schema.optionalKey(Schema.Number),
    y: Schema.optionalKey(Schema.Number),
  },
  success: Schema.Struct({ id: Schema.optionalKey(Schema.String) }),
})

export const MenuRpcs = RpcGroup.make(MenuRunAction, MenuShowContext)
