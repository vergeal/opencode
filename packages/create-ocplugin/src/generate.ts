export * as Generate from "./generate.js"

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

/** The parts a generated plugin ships. `server` is always there; the others add their folder and entry. */
export type Template = "server" | "gui" | "tui"

export const Templates: readonly Template[] = ["server", "gui", "tui"]

export type Selected = {
  /** The directory written, absolute. */
  readonly directory: string
  /** The plugin id written into `ocplugin.json`, such as `opencode.notes`. */
  readonly id: string
  /** Every file written, relative to `directory`. */
  readonly files: readonly string[]
}

/**
 * Writes a plugin skeleton that the host already accepts: `ocplugin.json` declares `server/main` (and `gui/main`),
 * every declared entry exists, and the TypeScript config extends the repository's Bun preset. The generated package
 * declares its OpenCode dependencies with `workspace:` and `catalog:` entries, so it type-checks inside this
 * repository without installing anything.
 *
 * @param input - Where to write, which template, and the plugin's display name.
 * @returns The directory written and every file in it.
 */
export async function generate(input: {
  readonly directory: string
  readonly template: Template
  readonly name?: string
}): Promise<Selected> {
  const directory = path.resolve(input.directory)
  const slug = slugOf(path.basename(directory))
  if (!slug) throw new Error(`Cannot derive a plugin name from "${path.basename(directory)}". Use a name with letters or digits.`)
  const id = `opencode.${slug}`
  const label = input.name?.trim() || titleOf(slug)

  if (!(await workspaceRoot(directory)))
    throw new Error(
      "create-ocplugin writes workspace dependencies (workspace:* and catalog:), so it only creates plugins inside the opencode repository. Pass a directory under packages/.",
    )

  const files: Record<string, string> = {
    "package.json": packageManifest(slug, input.template),
    "ocplugin.json": pluginManifest(id, input.template, label),
    "tsconfig.json": tsconfig(input.template),
    "server/main.ts": serverMain(id),
    "README.md": readme(label, id, input.template),
    ".gitignore": ["node_modules", "dist", ""].join("\n"),
  }
  if (input.template === "gui") {
    files["gui/main.tsx"] = guiMain()
    files["vite.config.ts"] = guiViteConfig()
  }
  if (input.template === "tui") files["tui/main.tsx"] = tuiMain(id)

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(directory, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  return { directory, id, files: Object.keys(files).sort() }
}

/** A package name from a directory name, so `My Plugin` and `my-plugin` both become `my-plugin`. */
export function slugOf(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^plugin-/, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
}

/** The nearest ancestor package.json that lists `workspaces`, or undefined outside the monorepo. */
async function workspaceRoot(directory: string): Promise<string | undefined> {
  const manifest = Bun.file(path.join(directory, "package.json"))
  if (await manifest.exists()) {
    const json = (await manifest.json()) as { workspaces?: unknown }
    if (json.workspaces) return directory
  }

  const parent = path.dirname(directory)
  if (parent === directory) return undefined
  return workspaceRoot(parent)
}

function titleOf(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ")
}

function packageManifest(slug: string, template: Template) {
  return (
    JSON.stringify(
      {
        $schema: "https://json.schemastore.org/package.json",
        name: `@opencode/plugin-${slug}`,
        version: "0.0.0",
        private: true,
        type: "module",
        files: [
          "ocplugin.json",
          "server",
          ...(template === "gui" ? ["gui", "dist"] : []),
          ...(template === "tui" ? ["tui"] : []),
        ],
        scripts: {
          typecheck: "bun check --no-script",
          ...(template === "gui" ? { build: "vite build" } : {}),
        },
        dependencies: {
          "@opencode/plugin": "workspace:*",
          effect: "catalog:",
        },
        devDependencies: {
          "@tsconfig/bun": "catalog:",
          "@types/bun": "catalog:",
          "@typescript/native": "catalog:",
          ...(template === "gui" ? { vite: "catalog:" } : {}),
        },
      },
      null,
      2,
    ) + "\n"
  )
}

function pluginManifest(id: string, template: Template, label: string) {
  const entry: Record<string, string> = { server: "server/main" }
  if (template === "gui") entry.gui = "gui/main"
  if (template === "tui") entry.tui = "tui/main"
  return (
    JSON.stringify(
      {
        apiVersion: 1,
        id,
        version: "0.0.0",
        entry,
        externals: ["@opencode/plugin"],
        display: {
          name: label,
          description: `${label} adds tools to OpenCode.`,
          category: "developer-tools",
        },
      },
      null,
      2,
    ) + "\n"
  )
}

function tsconfig(template: Template) {
  const include = ["server", ...(template === "gui" ? ["gui", "vite.config.ts"] : []), ...(template === "tui" ? ["tui"] : [])]
  return (
    JSON.stringify(
      {
        $schema: "https://json.schemastore.org/tsconfig.json",
        extends: "@tsconfig/bun/tsconfig.json",
        compilerOptions: {
          types: ["bun"],
          noEmit: true,
          noUncheckedIndexedAccess: false,
        },
        include,
      },
      null,
      2,
    ) + "\n"
  )
}

function serverMain(id: string) {
  return `import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: ${JSON.stringify(id)},
  async setup(ctx) {
    // Register tools, commands, skills or providers here.
  },
})
`
}

function guiMain() {
  return `import { Plugin } from "@opencode/plugin/gui"

export default Plugin.define({
  // The window setup runs in every desktop app window; add commands, panels, keybindings or translations here.
  setup(ctx) {
    void ctx
  },
})
`
}

function tuiMain(id: string) {
  return `import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: ${JSON.stringify(id)},
  setup(ctx) {
    // Append a view to a slot, for example "sidebar.content".
    void ctx
  },
})
`
}

function guiViteConfig() {
  return `import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

// Writes the one CommonJS bundle the app evaluates: dist/gui/main.cjs.
export default defineConfig({ plugins: [gui()] })
`
}

function readme(label: string, id: string, template: Template) {
  const build = template === "gui" ? "\n## Build\n\n```sh\nbun run build\n```\n\nThis writes `dist/gui/main.cjs`, the bundle the app loads.\n" : ""
  return `# ${label}

An OpenCode plugin (\`${id}\`).

## Install

Install the directory from the project's \`opencode.jsonc\`:

\`\`\`jsonc
{
  "plugins": ["./path/to/${path.basename(id)}"]
}
\`\`\`

Or from this repository, add the directory to \`plugins\` and reload the server.

## Entry

\`ocplugin.json\` declares where each part starts. Every part lives in its own folder with a file named \`main\`:

- \`server/main.ts\` runs in the OpenCode server.
${template === "gui" ? "- `gui/main.tsx` is the desktop app's window, bundled into `dist/gui/main.cjs` and declared as `entry.gui`.\n" : ""}${template === "tui" ? "- `tui/main.tsx` runs in the TUI, declared as `entry.tui`.\n" : ""}
The file extension is chosen by the host: \`.ts\`, \`.tsx\`, \`.js\` then \`.mjs\` for the server and TUI; \`.js\` then \`.cjs\` for the GUI.

## Runtime

If the plugin needs Python, declare it in \`ocplugin.json\`:

\`\`\`json
{
  "runtime": {
    "python": ">=3.10",
    "dependencies": ["pymysql>=1.0"]
  }
}
\`\`\`

The host prepares an isolated environment per plugin in \`~/.opencode/plugin-runtime/<id>\` and reports its state on the
plugin's page in Explore.
${build}`
}
