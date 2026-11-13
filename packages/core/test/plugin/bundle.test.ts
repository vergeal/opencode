import { expect, spyOn } from "bun:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { PluginBundle } from "@opencode/core/plugin/bundle"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const base = {
  apiVersion: 1,
  id: "test.bundle",
  version: "1.0.0",
  entry: { server: "server/main" },
} satisfies Record<string, unknown>

async function publish(input: {
  readonly home: string
  readonly manifest: Record<string, unknown>
  readonly files?: Record<string, string>
  /** The server file the bundle ships by default; tests about legacy layouts replace it so no `main` exists. */
  readonly entryFile?: string
}) {
  const directory = path.join(input.home, ".ocplugins-local", String(input.manifest.id), String(input.manifest.version))
  await mkdir(directory, { recursive: true })
  const archive = new Bun.Archive({
    "ocplugin.json": JSON.stringify(input.manifest),
    [input.entryFile ?? "server/main.js"]: "export default { id: 'test.bundle', effect: () => {} }",
    ...input.files,
  })
  await writeFile(path.join(directory, "bundle.ocplugin"), await archive.bytes())
}

const install = (input: {
  readonly home: string
  readonly version: string
  readonly id?: string
  readonly opencodeVersion?: string
}) =>
  PluginBundle.install({
    id: input.id ?? "test.bundle",
    version: input.version,
    config: path.join(input.home, "config"),
    cwd: input.home,
    home: input.home,
    opencodeVersion: input.opencodeVersion,
  })

it.effect("refuses a bundle that needs a newer OpenCode", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({ home: temp.path, manifest: { ...base, requires: { opencode: "^9.0.0" } } }),
    )

    const exit = yield* Effect.promise(() =>
      install({ home: temp.path, version: "1.0.0", opencodeVersion: "2.0.0" }).then(
        () => "installed",
        (cause: unknown) => String(cause),
      ),
    )

    expect(exit).toContain("OpenCode >= 9.0.0")
  }),
)

it.effect("accepts a bundle whose requirement is met", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest: { ...base, requires: { opencode: "^1.0.0" }, configuration: { properties: {} } },
      }),
    )

    const installed = yield* Effect.promise(() =>
      install({ home: temp.path, version: "1.0.0", opencodeVersion: "2.0.0" }),
    )

    expect(installed).toMatchObject({ id: "test.bundle", version: "1.0.0" })
  }),
)

it.effect("rejects a configuration with nested values", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest: {
          ...base,
          configuration: { properties: { sources: { type: "object", default: {} } } },
        },
      }),
    )

    const message = yield* Effect.promise(() =>
      install({ home: temp.path, version: "1.0.0", opencodeVersion: "2.0.0" }).then(
        () => "installed",
        (cause: unknown) => String(cause),
      ),
    )

    expect(message).toContain("invalid configuration")
  }),
)

it.effect("rejects a skill whose path is not in the bundle", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest: {
          ...base,
          skills: [{ id: "demo", name: "Demo", description: "Demo", path: "skills/demo/SKILL.md" }],
        },
      }),
    )

    const message = yield* Effect.promise(() =>
      install({ home: temp.path, version: "1.0.0", opencodeVersion: "2.0.0" }).then(
        () => "installed",
        (cause: unknown) => String(cause),
      ),
    )

    expect(message).toContain("skills/demo/SKILL.md")
  }),
)

it.effect("installs the webwright manifest as it ships", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    const manifest = JSON.parse(
      yield* Effect.promise(() =>
        readFile(path.resolve(import.meta.dir, "../../../plugins/webwright/ocplugin.json"), "utf8"),
      ),
    ) as { id: string; version: string; entry: { server: string }; skills?: { path: string }[] }
    // The manifest may still point at a file with its extension, so add one only when it has none.
    const entry = /\.[cm]?jsx?$|\.tsx?$/.test(manifest.entry.server) ? manifest.entry.server : `${manifest.entry.server}.js`

    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest,
        files: {
          [entry]: "export default { id: 'opencode.webwright', effect: () => {} }",
          ...Object.fromEntries((manifest.skills ?? []).map((skill) => [skill.path, "# Webwright"])),
        },
      }),
    )

    const installed = yield* Effect.promise(() =>
      install({
        home: temp.path,
        id: manifest.id,
        version: manifest.version,
        opencodeVersion: "2.2.5",
      }),
    )

    expect(installed).toMatchObject({ id: manifest.id, version: manifest.version })
  }),
)

it.effect("installs a bundle that ships only a main entry, without a warning", () =>
  Effect.gen(function* () {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const temp = yield* tmpdirScoped()
      yield* Effect.promise(() => publish({ home: temp.path, manifest: base }))

      expect(yield* Effect.promise(() => install({ home: temp.path, version: "1.0.0" }))).toMatchObject({
        id: "test.bundle",
        version: "1.0.0",
      })
      expect(warn).toHaveBeenCalledTimes(0)
    } finally {
      warn.mockRestore()
    }
  }),
)

it.effect("installs a bundle that ships only a legacy entry, with a deprecation warning", () =>
  Effect.gen(function* () {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const temp = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        publish({
          home: temp.path,
          manifest: { ...base, entry: { server: "server/index.js" } },
          entryFile: "server/index.js",
        }),
      )

      const installed = yield* Effect.promise(() => install({ home: temp.path, version: "1.0.0" }))
      expect(installed).toMatchObject({ id: "test.bundle", version: "1.0.0" })
      // The warning names the plugin and the path its author has to create.
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain("test.bundle")
      expect(String(warn.mock.calls[0]?.[0])).toContain("server/main")
    } finally {
      warn.mockRestore()
    }
  }),
)

it.effect("prefers a main entry over a legacy file, without a warning", () =>
  Effect.gen(function* () {
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const temp = yield* tmpdirScoped()
      yield* Effect.promise(() =>
        publish({
          home: temp.path,
          manifest: base,
          files: { "server/index.js": "export default { id: 'legacy', effect: () => {} }" },
        }),
      )

      expect(yield* Effect.promise(() => install({ home: temp.path, version: "1.0.0" }))).toMatchObject({
        id: "test.bundle",
      })
      // A warning is the observable proof a legacy path matched, so zero warnings here means `main` won.
      expect(warn).toHaveBeenCalledTimes(0)
    } finally {
      warn.mockRestore()
    }
  }),
)

it.effect("accepts only CommonJS files for a GUI entry", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest: { ...base, entry: { server: "server/main", gui: "gui/main" } },
        files: { "gui/main.js": "module.exports = {}" },
      }),
    )
    expect(yield* Effect.promise(() => install({ home: temp.path, version: "1.0.0" }))).toMatchObject({
      id: "test.bundle",
    })

    // The app evaluates the GUI entry as CommonJS text, so a TypeScript source is refused like a missing file.
    const rejected = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: rejected.path,
        manifest: { ...base, entry: { server: "server/main", gui: "gui/main" } },
        files: { "gui/main.ts": "export default {}" },
      }),
    )
    const message = yield* Effect.promise(() =>
      install({ home: rejected.path, version: "1.0.0" }).then(
        () => "installed",
        (cause: unknown) => String(cause),
      ),
    )
    expect(message).not.toBe("installed")
    expect(message).toContain("gui/main.cjs")
    expect(message).not.toContain("gui/main.ts")
  }),
)

it.effect("refuses a bundle with no server entry, naming the path to create", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest: { ...base, entry: undefined },
        files: { "server/main.js": "" },
      }),
    )

    const message = yield* Effect.promise(() =>
      install({ home: temp.path, version: "1.0.0" }).then(
        () => "installed",
        (cause: unknown) => String(cause),
      ),
    )

    expect(message).toContain("server/main")
  }),
)

it.effect("refuses a declared part whose file the bundle does not ship", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest: { ...base, entry: { server: "server/main", tui: "tui/main" } },
      }),
    )

    const message = yield* Effect.promise(() =>
      install({ home: temp.path, version: "1.0.0" }).then(
        () => "installed",
        (cause: unknown) => String(cause),
      ),
    )

    expect(message).toContain("tui/main")
  }),
)

it.effect("refuses a runtime field it cannot read", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest: { ...base, runtime: { dependencies: "pymysql" } },
      }),
    )

    const message = yield* Effect.promise(() =>
      install({ home: temp.path, version: "1.0.0" }).then(
        () => "installed",
        (cause: unknown) => String(cause),
      ),
    )

    expect(message).toContain("invalid runtime")
  }),
)

it.effect("installs a bundle that declares a Python runtime", () =>
  Effect.gen(function* () {
    const temp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      publish({
        home: temp.path,
        manifest: { ...base, runtime: { python: ">=3.10", dependencies: ["pymysql>=1.0"] } },
      }),
    )

    const installed = yield* Effect.promise(() => install({ home: temp.path, version: "1.0.0" }))
    expect(installed).toMatchObject({ id: "test.bundle", version: "1.0.0" })
  }),
)
