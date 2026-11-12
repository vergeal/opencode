import { execFileSync } from "node:child_process"
import { nativeImage } from "electron"

// The renderer fakes acrylic transparency on its chrome by mixing a mask over what the window shows. That mix only
// needs one number: how bright the desktop behind the window is. Windows keeps the wallpaper path in the registry, so
// a single sample at startup is enough — the wallpaper does not change while the app runs.
export function wallpaperLuma(): number | undefined {
  const file = wallpaperPath()
  if (!file) return undefined

  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return undefined

  // Averaging an 8×8 downsample is enough for a brightness estimate and costs nothing at startup.
  const bitmap = image.resize({ width: 8, height: 8 }).toBitmap()
  let red = 0
  let green = 0
  let blue = 0

  for (let i = 0; i < bitmap.length; i += 4) {
    // Electron's bitmap is BGRA on Windows.
    blue += bitmap[i]
    green += bitmap[i + 1]
    red += bitmap[i + 2]
  }

  const pixels = bitmap.length / 4
  if (pixels === 0) return undefined

  return Math.round((0.2126 * red + 0.7152 * green + 0.0722 * blue) / pixels)
}

function wallpaperPath() {
  const output = queryWallpaper()

  // `reg query` prints "    WallPaper    REG_SZ    C:\path\file.jpg"; the path is the last column.
  const value = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith("wallpaper"))

  return value?.split(/\s{2,}/).at(-1)
}

function queryWallpaper() {
  try {
    return execFileSync("reg", ["query", "HKCU\\Control Panel\\Desktop", "/v", "WallPaper"], {
      encoding: "utf8",
      windowsHide: true,
    })
  } catch {
    return ""
  }
}
