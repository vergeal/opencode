import type { JSX } from "solid-js"
import type { OpenCodeClient } from "@opencode/client/promise"
import type { Cleanup } from "./core.js"
import type { Context } from "./context.js"

/** A window box in DIP, the unit `screen` and `BrowserWindow.setBounds` use on every platform. */
export interface OverlayBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * How far an overlay rises.
 * - `floating`: above normal windows, below system UI.
 * - `screen-saver`: above full-screen apps and the system UI. Requires the `window.overlay.elevated` permission.
 */
export type OverlayLevel = "floating" | "screen-saver"

/** What an overlay window is created with. */
export interface OverlayOptions {
  /** The overlay's id, unique within the plugin; a second create with the same id returns the existing handle. */
  readonly id: string
  /** Its first box, in DIP. The host clamps it to the display's work area. */
  readonly bounds: OverlayBounds
  /** The display id the box is measured on. Omit it to use the display that contains the box. */
  readonly display?: string
  /** A frameless window with no background. Defaults to true. */
  readonly transparent?: boolean
  /** Stays above other windows. Defaults to true. */
  readonly alwaysOnTop?: boolean
  /** See `OverlayLevel`. Defaults to `floating`. */
  readonly level?: OverlayLevel
  /** Clicks pass through to the app underneath. Defaults to true. */
  readonly clickThrough?: boolean
  /** Takes keyboard focus. Defaults to false, so clicking the overlay does not leave the app behind. */
  readonly focusable?: boolean
  /** Shows at once. Defaults to true. */
  readonly show?: boolean
}

/**
 * One overlay window, as the main entry controls it. The plugin's `overlay` render runs inside it.
 *
 * @example
 * ```ts
 * const pet = await ctx.overlay.create({ id: "pet", bounds: { x: 1200, y: 700, width: 220, height: 220 } })
 * pet.setClickThrough(false)
 * ```
 */
export interface OverlayHandle {
  readonly id: string
  /** The current box, in DIP. */
  bounds(): OverlayBounds
  setBounds(bounds: OverlayBounds, display?: string): void
  /** Clicks pass through while enabled. Flip it as the pointer crosses the overlay's own hit area. */
  setClickThrough(enabled: boolean): void
  setAlwaysOnTop(enabled: boolean, level?: OverlayLevel): void
  show(): void
  hide(): void
  close(): void
  on(event: "closed", handler: () => void): Cleanup
}

/** The overlay windows a plugin created. They close when the plugin stops. */
export interface Overlay {
  create(options: OverlayOptions): Promise<OverlayHandle>
  get(id: string): OverlayHandle | undefined
  list(): readonly OverlayHandle[]
}

/**
 * The overlay window's own handle, inside `overlay` renders. Every method crosses to main and returns at once; the
 * box is the last one main reported.
 */
export interface OverlaySelf {
  readonly id: string
  /** The last box main reported for this window, in DIP. */
  bounds(): OverlayBounds | undefined
  setBounds(bounds: OverlayBounds): void
  setClickThrough(enabled: boolean): void
  close(): void
}

/**
 * The context an overlay render receives. It is not a window `SetupContext`: an overlay has no shell, so it offers
 * neither registries nor routing, sessions, tabs or dialogs. It keeps what works without a shell.
 */
export type OverlayContext = Pick<
  Context,
  | "id"
  | "options"
  | "signal"
  | "storage"
  | "client"
  | "main"
  | "provide"
  | "use"
  | "ui"
  | "app"
  | "locale"
  | "appearance"
  | "system"
  | "desktop"
> & {
  /** This window. */
  readonly overlay: OverlaySelf
}

/** A plugin's overlay render: the root of one overlay window. Runs under the plugin's Solid owner. */
export type OverlayRender = (ctx: OverlayContext) => JSX.Element

export type { OpenCodeClient }
