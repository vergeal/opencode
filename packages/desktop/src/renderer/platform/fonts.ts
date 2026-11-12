type LocalFontData = {
  family: string
}

type LocalFontWindow = {
  queryLocalFonts?: () => Promise<LocalFontData[]>
}

export function createDesktopFonts() {
  return {
    /**
     * Chromium's Local Font Access API. It is the platform enumeration the renderer exposes; the main
     * process grants the `local-fonts` permission to app windows in windows/security.ts. A call made
     * without a user gesture is rejected, so the font picker asks again when the user opens it.
     */
    listSystemFonts: async (): Promise<readonly string[]> => {
      // SAFETY: Chromium exposes queryLocalFonts on Window; lib.dom does not declare it yet.
      const query = (window as LocalFontWindow).queryLocalFonts

      if (!query) return []

      const fonts = await query.call(window)

      return [...new Set(fonts.map((font) => font.family))]
    },
  }
}
