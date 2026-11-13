import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const dist = join(root, "dist")
const manifest = await Bun.file(join(root, "ocplugin.json")).json()

await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, "server"), { recursive: true })
await mkdir(join(dist, "assets", "dbro"), { recursive: true })

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

// The Python gate and the three executors are vendored in `python/`, mirroring the layout they were developed in, so
// a clone builds without an external tools checkout.
const toolsRoot = join(root, "python")
const assets = join(dist, "assets", "dbro")
const gate = join(toolsRoot, "dbro", "dbro.py")
if (!(await Bun.file(gate).exists()))
  throw new Error(`找不到 ${gate}。Python 脚本应当由仓库内的 python/ 目录提供。`)

// dbro.py resolves the executors from its parent directory in the source layout. The bundle flattens all four files
// into assets/dbro, so prefer the script's own directory and keep the old layout as the fallback.
const marker = "TOOLS = Path(__file__).resolve().parent.parent"
const source = await Bun.file(gate).text()
if (!source.includes(marker)) throw new Error(`${gate} 的 TOOLS 定位方式变了，更新 script/build.ts 里的补丁。`)
await Bun.write(
  join(assets, "dbro.py"),
  source.replace(
    marker,
    [
      "# 插件把四个脚本平铺在 assets/dbro/；源码目录里执行器在 dbro.py 的上一级。",
      "TOOLS = Path(__file__).resolve().parent",
      'if not (TOOLS / "dm8_exec.py").exists():',
      "    TOOLS = TOOLS.parent",
    ].join("\n"),
  ),
)

for (const name of ["dm8_exec.py", "mysql_exec.py", "pgsql_exec.py"]) {
  const file = join(toolsRoot, name)
  if (!(await Bun.file(file).exists())) throw new Error(`找不到执行器 ${file}。`)
  await cp(file, join(assets, name))
}

// Drivers are platform-specific wheels and cannot live inside the bundle; the list ships with the bundle so the
// installed plugin can tell a user exactly what to install when `dbro.doctor` reports a missing import.
await cp(join(toolsRoot, "requirements.txt"), join(assets, "requirements.txt"))

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
