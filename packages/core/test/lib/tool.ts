import { Agent } from "@aicraft/core/agent"
import { CodeModeCatalog } from "@aicraft/core/codemode/catalog"
import type { Permission } from "@aicraft/core/permission"
import { SessionMessage } from "@aicraft/core/session/message"
import { toSessionError } from "@aicraft/core/session/to-session-error"
import type { SessionError } from "@aicraft/schema/session-error"
import { Tool } from "@aicraft/core/tool"
import type { Context } from "@aicraft/aix/effect/plugin"
import { Effect, type Scope } from "effect"
import { host } from "../plugin/host"

export const toolIdentity = {
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_tool_test"),
}

export const toolDefinitions = (registry: Tool.Interface, permissions?: Permission.Ruleset) =>
  registry.snapshot(permissions).pipe(Effect.map((toolSet) => toolSet.definitions))

/**
 * Every Code Mode tool with the line the model would receive from `search`. The catalog itself no longer
 * inlines signatures, so these tests read them from the inventory — the same source `search` answers from.
 */
export const codeModeListings = (catalog: CodeModeCatalog.Inventory) =>
  catalog.tools.flatMap((entry) =>
    entry.type === "namespace"
      ? entry.tools.flatMap((tool) =>
          tool.type === "namespace"
            ? []
            : [{ path: `${entry.name}.${tool.name}`, line: `  - ${tool.signature}` }],
        )
      : [{ path: entry.name, line: `  - ${entry.signature}` }],
  )

export function waitForTool(registry: Tool.Interface, name: string, remaining = 1000): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    if ((yield* toolDefinitions(registry)).some((tool) => tool.name === name)) return
    if (remaining === 0) {
      yield* Effect.fail(new Error(`Timed out waiting for tool: ${name}`))
      return
    }
    yield* Effect.promise(() => Bun.sleep(1))
    yield* waitForTool(registry, name, remaining - 1)
  })
}

/**
 * Registers a core tool plugin's tools against the real registry without booting the
 * full plugin host. Only the tool domain is live; focused tool tests exercise
 * registration, snapshots, and execution through the same path production uses.
 */
export const registerToolPlugin = <R>(
  plugin: {
    readonly id: string
    readonly effect: (context: Context) => Effect.Effect<void, never, R>
  },
  overrides: Parameters<typeof host>[0] = {},
  hook?: Context["tool"]["hook"],
): Effect.Effect<void, never, R | Tool.Service | Scope.Scope> =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    const context = host({
      ...overrides,
      session: {
        ...overrides.session,
        hook: overrides.session?.hook ?? (() => Effect.succeed({ dispose: Effect.void })),
      },
      tool: {
        transform: tools.transform,
        reload: tools.reload,
        list: tools.list,
        hook: hook ?? (() => Effect.die("registerToolPlugin does not support tool hooks")),
      },
    })
    yield* plugin.effect(context)
  })

export interface ToolExecution {
  readonly status: "completed" | "error"
  readonly output?: any
  readonly content?: ReadonlyArray<Tool.Content>
  readonly metadata?: Tool.Metadata
  readonly error?: SessionError.Error
}

export const executeTool = (
  registry: Tool.Interface,
  input: Parameters<Tool.Snapshot["execute"]>[0],
): Effect.Effect<ToolExecution> =>
  registry.snapshot().pipe(
    Effect.flatMap((tools) => tools.execute(input)),
    Effect.map((result) => ({ status: "completed" as const, ...result }) satisfies ToolExecution),
    Effect.catchTag("Tool.Error", (error) =>
      Effect.succeed({ status: "error" as const, error: toSessionError(error) } satisfies ToolExecution),
    ),
  )
