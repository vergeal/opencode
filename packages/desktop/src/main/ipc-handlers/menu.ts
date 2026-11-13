import { BrowserWindow, Menu, nativeImage, nativeTheme, type MenuItemConstructorOptions } from "electron"
import { Effect } from "effect"
import { MenuRpcs } from "../../shared/ipc-rpc"
import type { ContextMenuEntry } from "../../shared/ipc-rpc/menu"
import { IpcPortHandoff } from "../ipc-transport"
import { ApplicationLifecycle } from "../lifecycle"
import { MENU_ICONS } from "../native/menu-icons"
import { runDesktopMenuAction } from "../native/menu-actions"
import { sender } from "./context"

const menuIcons = new Map<string, Electron.NativeImage>()

/** Glyphs ship as 32px PNGs, so the scale factor pins each row icon to 16pt like the system menus. */
function menuIcon(key: string | undefined) {
  if (!key) return undefined

  // AppKit tints template images for the current appearance, but Windows and Linux draw the PNG as-is. Key the cache
  // by tone so a theme switch regenerates the dark-mode glyph instead of reusing the black one.
  const dark = process.platform !== "darwin" && nativeTheme.shouldUseDarkColors
  const cacheKey = `${dark ? "dark" : "light"}:${key}`
  const cached = menuIcons.get(cacheKey)

  if (cached) return cached

  const encoded = MENU_ICONS[key]

  if (!encoded) return undefined

  const image = nativeImage.createFromBuffer(Buffer.from(encoded, "base64"), { scaleFactor: 2 })
  const result = process.platform === "darwin" ? image : dark ? whiteGlyph(image) : image
  // The glyph is a mask: AppKit tints it for the current appearance instead of drawing fixed black pixels.
  if (process.platform === "darwin") result.setTemplateImage(true)
  menuIcons.set(cacheKey, result)

  return result
}

/** Turn the black mask into white pixels while keeping the antialiased alpha, for dark system menus. */
function whiteGlyph(image: Electron.NativeImage) {
  const scaleFactor = image.getScaleFactors()[0] ?? 1
  const bitmap = image.toBitmap()
  for (let i = 0; i < bitmap.length; i += 4) {
    bitmap[i] = 255
    bitmap[i + 1] = 255
    bitmap[i + 2] = 255
  }
  const { width, height } = image.getSize()
  return nativeImage.createFromBitmap(bitmap, {
    width: width * scaleFactor,
    height: height * scaleFactor,
    scaleFactor,
  })
}

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

            // Resolve once the menu is gone, not from the item's click handler: the renderer acts on the
            // result immediately, and anything that takes focus while the native menu still holds it (a
            // rename editor, a dialog) is dismissed by the menu closing a moment later.
            let chosen: { id?: string } = {}

            const build = (entries: ReadonlyArray<ContextMenuEntry>): MenuItemConstructorOptions[] =>
              entries.map((item) => {
                if (item.type === "separator") return { type: "separator" }

                const entry: MenuItemConstructorOptions = {
                  id: item.id,
                  label: item.label,
                  enabled: item.enabled ?? true,
                  accelerator: item.accelerator,
                  icon: menuIcon(item.icon),
                }

                // A submenu owns its rows; the parent never becomes the chosen entry.
                if (item.submenu) return { ...entry, submenu: build(item.submenu) }

                return {
                  ...entry,
                  click: () => {
                    chosen = { id: item.id }
                  },
                }
              })

            const menu = Menu.buildFromTemplate(build(items))
            // Electron reads `x`/`y` as window-relative DIP points, but the renderer reports CSS pixels, which shrink
            // by the window's zoom factor. Without the conversion the menu drifts toward the window origin at any
            // zoom other than 100%. One point without the other is rejected.

            const factor = win.webContents.getZoomFactor()

            const point =
              x !== undefined && y !== undefined
                ? { x: Math.round(x * factor), y: Math.round(y * factor) }
                : undefined

            menu.popup({
              window: win,
              ...point,
              callback: () => {
                resolve(chosen)
              },
            })
          })
        }),
    })
  }),
)
