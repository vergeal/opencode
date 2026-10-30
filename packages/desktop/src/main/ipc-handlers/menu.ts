import { BrowserWindow, Menu } from "electron"
import { Effect } from "effect"
import { MenuRpcs } from "../../shared/ipc-rpc"
import { IpcPortHandoff } from "../ipc-transport"
import { ApplicationLifecycle } from "../lifecycle"
import { runDesktopMenuAction } from "../native/menu-actions"
import { sender } from "./context"

export const menuHandlers = MenuRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const lifecycle = yield* ApplicationLifecycle.Service

    return MenuRpcs.of({
      MenuRunAction: ({ action }, context) =>
        Effect.sync(() =>
          runDesktopMenuAction(BrowserWindow.fromWebContents(sender(handoff, context)), action, {
            createWindow: lifecycle.createWindow,
            relaunch: lifecycle.relaunch,
          }),
        ),
      MenuShowContext: ({ items, x, y }, context) =>
        Effect.promise(() => {
          const win = BrowserWindow.fromWebContents(sender(handoff, context))

          return new Promise<{ id?: string }>((resolve) => {
            if (!win) return resolve({})
            const menu = Menu.buildFromTemplate(
              items.map((item) =>
                item.type === "separator"
                  ? { type: "separator" }
                  : {
                      id: item.id,
                      label: item.label,
                      enabled: item.enabled ?? true,
                      click: () => resolve({ id: item.id }),
                    },
              ),
            )
            // Electron reads `x`/`y` as window-relative points and rejects one without the other.
            const point = x !== undefined && y !== undefined ? { x: Math.round(x), y: Math.round(y) } : undefined

            menu.popup({
              window: win,
              ...point,
              callback: () => {
                resolve({})
              },
            })
          })
        }),
    })
  }),
)
