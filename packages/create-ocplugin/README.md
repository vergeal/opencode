# @opencode/create-ocplugin

Scaffolds an OpenCode plugin inside this repository. The generated directory is a workspace package, so it
type-checks with `workspace:*` and `catalog:` versions without installing anything.

```sh
bun packages/create-ocplugin/src/cli.ts plugins/notes
bun packages/create-ocplugin/src/cli.ts plugins/notes-panel --template gui --name "Notes Panel"
```

## Templates

| Template | Writes                                                          |
| -------- | --------------------------------------------------------------- |
| `server` | `server/main.ts`, `ocplugin.json`, `tsconfig.json`, `README.md` |
| `gui`    | `server`, plus `gui/main.tsx` and `vite.config.ts`               |
| `tui`    | `server`, plus `tui/main.tsx`                                    |

Every entry follows the entry standard: the file is named `main`, it sits in the folder named after its part, and
`ocplugin.json` declares it without an extension (for example `server/main`). A GUI entry is bundled by
`@opencode/plugin/gui/vite` into `dist/gui/main.cjs`, which is the CommonJS file the app evaluates.

## Why only inside the repository

The generated `package.json` uses `workspace:*` and `catalog:` versions. Those only resolve in this workspace, so the
generator refuses any directory outside it instead of writing a package that cannot install.
