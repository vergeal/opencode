export type FontOption = {
  family: string
  /** The family advances every glyph by the same width, so it suits code and the terminal. */
  monospace: boolean
}

/**
 * The faces `../../index.css` ships. The picker offers these and the system stack instead of the system's font
 * list: the app then renders the same on every machine, and the list stays short instead of listing icon,
 * symbol and legacy bitmap faces the UI can never use.
 */
export const bundledFonts = [
  { family: "Inter", monospace: false },
  { family: "IBM Plex Mono", monospace: true },
  { family: "JetBrains Mono", monospace: true },
  { family: "JetBrainsMono Nerd Font Mono", monospace: true },
] as const satisfies readonly FontOption[]

/** Whether a stored family outside {@link bundledFonts} advances narrow and wide glyphs by the same width. */
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
