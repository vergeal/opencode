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

export type ContextMenuEntry = {
  readonly id?: string
  readonly label?: string
  readonly type?: "normal" | "separator"
  readonly enabled?: boolean
  /** Electron accelerator rendered at the trailing edge of the row, e.g. "Alt+CmdOrCtrl+R". */
  readonly accelerator?: string
  /** Key into the main process' menu glyph table; the renderer never ships image bytes over IPC. */
  readonly icon?: string
  /** Entries nested under this one; the menu shows a submenu instead of a click target. */
  readonly submenu?: ReadonlyArray<ContextMenuEntry>
}

const ContextMenuEntrySchema: Schema.Codec<ContextMenuEntry> = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  label: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.Literals(["normal", "separator"])),
  enabled: Schema.optionalKey(Schema.Boolean),
  accelerator: Schema.optionalKey(Schema.String),
  icon: Schema.optionalKey(Schema.String),
  submenu: Schema.optionalKey(
    Schema.Array(Schema.suspend((): Schema.Codec<ContextMenuEntry> => ContextMenuEntrySchema)),
  ),
})

/** A native context menu built by the main process; the chosen entry's id comes back, or nothing when dismissed. */
export const MenuShowContext = Rpc.make("MenuShowContext", {
  payload: {
    items: Schema.Array(ContextMenuEntrySchema),
    /** Window-relative point to open at; the pointer position is used when omitted. */
    x: Schema.optionalKey(Schema.Number),
    y: Schema.optionalKey(Schema.Number),
  },
  success: Schema.Struct({ id: Schema.optionalKey(Schema.String) }),
})

export const MenuRpcs = RpcGroup.make(MenuRunAction, MenuShowContext)
