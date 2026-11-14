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

// The GUI bundle runs in the desktop app's main process and in every window; the host resolves `@opencode/plugin/gui`
// to the main SDK in one and to the window SDK in the other. A CommonJS file is what a manifest's gui entry accepts.
await mkdir(join(dist, "gui"), { recursive: true })
const gui = await Bun.build({
  entrypoints: [join(root, "gui", "main.tsx")],
  target: "node",
  format: "cjs",
  // Solid's JSX. `solid-js/h` is a thin `h()` over the `solid-js/web` instance the app provides, so its runtime is
  // inlined below; `solid-js` itself would map to the whole Solid DOM runtime, which a window cannot load.
  jsx: { runtime: "automatic", importSource: "solid-js/h" },
  outdir: join(dist, "gui"),
  naming: "main.js",
  external: [
    "effect",
    "@opencode/plugin/gui",
    "@opencode/plugin/gui/main",
    "@opencode/plugin",
    "solid-js",
    "solid-js/web",
    "solid-js/store",
    "node:*",
  ],
  // `external` matches subpaths, so `solid-js` would externalize the JSX runtime too and a window would fail to
  // require it. Resolve those three to their files so they are bundled instead.
  plugins: [
    {
      name: "inline-solid-h",
      setup(build) {
        build.onResolve({ filter: /^solid-js\/h(\/jsx(-dev)?-runtime)?$/ }, (args) => ({
          path: Bun.resolveSync(args.path, root),
        }))
      },
    },
  ],
})
if (!gui.success) {
  for (const log of gui.logs) console.error(log)
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
