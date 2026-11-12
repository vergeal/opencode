import type { Platform } from "./platform"

export type FontOption = {
  family: string
  /** The family advances every glyph by the same width, so it suits code and the terminal. */
  monospace: boolean
}

/**
 * Faces the app can rely on when the platform cannot enumerate system fonts: the web build and the test
 * environment have no native font list. The bundled faces come first, then common system families.
 */
export const fallbackFonts = [
  "Inter",
  "IBM Plex Mono",
  "JetBrainsMono Nerd Font Mono",
  "SF Pro",
  "SF Mono",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Georgia",
  "Menlo",
  "Monaco",
  "Consolas",
  "Courier New",
  "Liberation Mono",
  "DejaVu Sans Mono",
] as const

let cached: Promise<readonly FontOption[]> | undefined

/**
 * The system fonts, read once per page and shared by every font row. A failed enumeration is not cached:
 * Chromium rejects the local font list until the user acts, so the picker retries when it opens.
 */
export function loadFontOptions(platform: Platform): Promise<readonly FontOption[]> {
  if (cached) return cached

  const settled = readFontOptions(platform).catch(async () => {
    if (cached === settled) cached = undefined

    return measureFonts(fallbackFonts)
  })

  cached = settled
  return settled
}

async function readFontOptions(platform: Platform): Promise<readonly FontOption[]> {
  const system = await platform.listSystemFonts?.()

  return measureFonts(system?.length ? system : fallbackFonts)
}

async function measureFonts(input: readonly string[]): Promise<readonly FontOption[]> {
  const families = uniqueSorted(input)

  if (typeof document === "undefined") return families.map((family) => ({ family, monospace: false }))

  await document.fonts?.ready.catch(() => undefined)

  // Loading the face first keeps a bundled family from being measured through its fallback, which would
  // classify IBM Plex Mono and the terminal face as proportional on a cold page.
  const options: FontOption[] = []

  for (let index = 0; index < families.length; index += 24) {
    const chunk = families.slice(index, index + 24)
    options.push(
      ...(await Promise.all(
        chunk.map(async (family) => {
          await document.fonts?.load(`16px ${quoteFamily(family)}`).catch(() => undefined)

          return { family, monospace: isMonospace(family) }
        }),
      )),
    )
  }

  return options
}

/** Whether a family advances narrow and wide glyphs by the same width; also used for a stored custom value. */
export function isMonospace(family: string) {
  const context = measureContext()

  if (!context) return /mono/i.test(family)

  context.font = `16px ${quoteFamily(family)}`

  const narrow = context.measureText("iiiiiiiiii").width
  const wide = context.measureText("WWWWWWWWWW").width

  return Math.abs(narrow - wide) < 0.5
}

let context: CanvasRenderingContext2D | null | undefined

function measureContext() {
  if (context !== undefined) return context

  if (typeof document === "undefined") return (context = null)

  context = document.createElement("canvas").getContext("2d")
  return context
}

export function quoteFamily(family: string) {
  if (/^[A-Za-z_][\w-]*$/.test(family)) return family

  return `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function uniqueSorted(families: readonly string[]) {
  return [...new Set(families.map((family) => family.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  )
}
