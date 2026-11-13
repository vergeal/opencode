import { Plugin } from "@opencode/plugin"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { join } from "node:path"
import manifest from "../ocplugin.json" with { type: "json" }
import { Collect } from "../src/collect.js"
import { createDispatcher } from "../src/dispatch.js"
import { Git } from "../src/git.js"
import { Ledger } from "../src/ledger.js"
import * as OrchestratorSkill from "../src/skill.js"
import { Tools } from "../src/tools.js"
import { Watch } from "../src/watch.js"

/** `idle` is last on purpose: it is the fallback, not the signal. */
const TYPES = [
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.idle",
] as const

export default Plugin.define({
  id: manifest.id,
  display: {
    name: manifest.display.name,
    description: manifest.display.description,
    category: manifest.display.category,
    skills: manifest.skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description })),
    tools: manifest.display.tools,
  },
  async activate(ctx) {
    const config = await ctx.config.get()
    const idleGraceMs = number(config.idleGraceMs, 60_000)
    const timeoutMs = number(config.timeoutMs, 7_200_000)
    const verifyTimeoutMs = number(config.verifyTimeoutMs, 600_000)
    const notifySessionID = typeof config.notifySessionID === "string" ? config.notifySessionID.trim() : ""

    const store = Ledger.createStore(ctx.paths.data)
    const git = Git.create(ctx.location.project.directory)
    const now = () => new Date().toISOString()

    // Notifications are opt-in and only carry the three kinds `collect` forwards.
    const notify = notifySessionID
      ? async (text: string) => {
          await ctx.session.prompt({ sessionID: Session.ID.make(notifySessionID), text, delivery: "queue" })
        }
      : undefined

    const dispatcher = createDispatcher({
      store,
      git,
      worktrees: join(ctx.paths.data, "worktrees"),
      now,
      session: {
        create: async ({ title }) => (await ctx.session.create({ title })).id,
        move: async ({ sessionID, directory }) => {
          await ctx.session.move({ sessionID: Session.ID.make(sessionID), directory: AbsolutePath.make(directory) })
        },
        prompt: async ({ sessionID, text }) => {
          await ctx.session.prompt({ sessionID: Session.ID.make(sessionID), text, delivery: "queue" })
        },
        remove: async ({ sessionID }) => {
          await ctx.session.remove({ sessionID: Session.ID.make(sessionID) })
        },
      },
    })

    const collect: Collect.Ports = {
      store,
      git,
      now,
      verifyTimeoutMs,
      resume: (planID) => dispatcher.resume(planID),
      notify,
    }

    const toolDeps: Tools.Deps = {
      store,
      now,
      approve: (input) => dispatcher.approve(input),
      resolve: async (input) => {
        const result = await Collect.resolve(collect, input)
        // Merging or unblocking frees a slot, so a task that was already approved may now be dispatchable.
        if (input.decision !== "merged" && input.decision !== "unblock") return result
        const planID = (await store.read()).tasks[input.taskID]?.planID
        if (planID) await dispatcher.resume(planID)
        return result
      },
    }

    const ports: Watch.Ports = {
      store,
      now,
      graceMs: idleGraceMs,
      timeoutMs,
      sessions: {
        alive: async (sessionID) => {
          try {
            await ctx.session.get({ sessionID: Session.ID.make(sessionID) })
            return true
          } catch {
            return false
          }
        },
      },
      collect: (taskID) => Collect.collect(collect, taskID),
      markMissing: (taskID) => Collect.markMissing(collect, taskID),
      markExecutionFailed: (taskID, detail, kind) => Collect.markExecutionFailed(collect, taskID, detail, kind),
    }

    const skill = await OrchestratorSkill.load()
    await ctx.skill.transform((editor) => {
      if (!editor.get(skill.id)) editor.add(skill)
    })
    await ctx.tool.transform((editor) => Tools.register(editor, toolDeps))

    const runner = Watch.start(ports, (signal) => subscription(ctx.event.subscribe({ types: TYPES, signal })))
    // Startup recovery: collect what finished while the app was down, then sweep for the rest.
    await Watch.reconcile(ports).catch((error) => console.error(`[orchestrator] reconcile 失败：${message(error)}`))

    console.log(`[orchestrator] loaded ${manifest.version}`)

    return async () => {
      await runner.stop()
    }
  },
})

async function* subscription(
  source: AsyncIterable<{ readonly type: string; readonly data: { readonly sessionID: string } }>,
): AsyncIterable<Watch.Event> {
  for await (const event of source) {
    const mapped = toWatch(event)
    if (mapped) yield mapped
  }
}

/**
 * The shared event stream carries the payload under `data`, and only these four types reach the plugin. Anything else
 * is passed over rather than treated as an unknown state.
 */
function toWatch(event: {
  readonly type: string
  readonly data: { readonly sessionID: string }
}): Watch.Event | undefined {
  const sessionID = event.data.sessionID
  if (event.type === "session.execution.succeeded") return { type: event.type, sessionID }
  if (event.type === "session.execution.failed") {
    const error = (event.data as { readonly error?: unknown }).error
    return { type: event.type, sessionID, error }
  }
  if (event.type === "session.execution.interrupted") {
    const reason = (event.data as { readonly reason?: unknown }).reason
    return { type: event.type, sessionID, reason: typeof reason === "string" ? reason : "unknown" }
  }
  if (event.type === "session.idle") return { type: event.type, sessionID }
  return undefined
}

function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
