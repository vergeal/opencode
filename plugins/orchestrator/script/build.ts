import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")
const manifest = await Bun.file(join(root, "ocplugin.json")).json()

await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, "server"), { recursive: true })

const build = await Bun.build({
  entrypoints: [join(root, "server", "main.ts")],
  target: "bun",
  format: "esm",
  outdir: join(dist, "server"),
  naming: "main.js",
  // Host modules stay external so the plugin shares the host's module instances.
  external: [...manifest.externals, "node:*"],
})
if (!build.success) {
  for (const log of build.logs) console.error(log)
  process.exit(1)
}

// `skill.ts` reads SKILL.md at activation, so the text travels with the bundle instead of being inlined.
for (const item of ["skills", "ocplugin.json", "README.md"]) {
  await cp(join(root, item), join(dist, item), { recursive: true }).catch(() => undefined)
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
      main: "./server/main.js",
      exports: { ".": "./server/main.js" },
    },
    null,
    2,
  ) + "\n",
)

console.log(`built ${manifest.id} ${manifest.version} into ${dist}`)
