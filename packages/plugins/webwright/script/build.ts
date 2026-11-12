import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")
const manifest = await Bun.file(join(root, "ocplugin.json")).json()

await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, "server"), { recursive: true })

const build = await Bun.build({
  entrypoints: [join(root, "src", "index.ts")],
  target: "bun",
  format: "esm",
  outdir: join(dist, "server"),
  naming: "index.js",
  // Host modules stay external so the plugin shares the host's module instances. Playwright is not bundled either:
  // its driver resolves files relative to its own package, so the package ships under assets/ instead.
  external: [...manifest.externals, "node:*"],
})
if (!build.success) {
  for (const log of build.logs) console.error(log)
  process.exit(1)
}

// Resolve through the package manifest so a hoisted workspace install still copies the version this package builds
// against, not a stale nested copy.
const require = createRequire(import.meta.url)
const playwright = dirname(require.resolve("playwright-core/package.json"))
await cp(playwright, join(dist, "assets", "playwright-core"), { recursive: true })

for (const item of ["skills", "ocplugin.json", "README.md"]) {
  await cp(join(root, item), join(dist, item), { recursive: true })
}

// The unpacked bundle is a plugin directory, so its manifest names the plugin id and points at the built entry.
await writeFile(
  join(dist, "package.json"),
  JSON.stringify(
    {
      name: manifest.id,
      version: manifest.version,
      type: "module",
      license: "MIT",
      main: "./server/index.js",
      exports: { ".": "./server/index.js" },
    },
    null,
    2,
  ) + "\n",
)

console.log(`built ${manifest.id} ${manifest.version} into ${dist}`)
