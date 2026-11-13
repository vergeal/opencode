export * as SessionsTool from "./sessions.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { DateTime, Effect, Schema } from "effect"
import { Git } from "../../git.js"
import { AbsolutePath } from "../../schema.js"
import { SessionSchema } from "../../session/schema.js"

export const name = "sessions"

const DEFAULT_LIMIT = 40
const MAX_LIMIT = 200
const DEFAULT_BASE = "lts/ocdev"

export const description = [
  "List sessions with the worktree and branch each one runs in, so one call answers who is where and what they are doing.",
  "Each row carries the session id, title, agent, running or idle status, timestamps, working directory, and the worktree it lives in: path, branch, short HEAD, dirty state, and commits ahead and behind `base`.",
  "`base` defaults to `lts/ocdev` and is read from local git refs only: nothing is fetched, checked out or written.",
  "`worktree` is null when the directory is not inside a git worktree or the repository could not be read. `directory` is empty when the session does not report one.",
  "Rows are newest first by update time and `limit` (default 40, maximum 200) truncates the result. `search` matches titles and ids. Pass `parentID: null` to list only root sessions.",
].join("\n")

export const Input = Schema.Struct({
  limit: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: MAX_LIMIT })),
  ).annotate({ description: "Maximum rows to return. Defaults to 40, maximum 200." }),
  search: Schema.optionalKey(Schema.String).annotate({
    description: "Filter by session title or id.",
  }),
  parentID: Schema.optionalKey(Schema.NullOr(SessionSchema.ID)).annotate({
    description: "Filter by parent session. Null returns only root sessions.",
  }),
  archived: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Whether to list archived sessions. Defaults to false.",
  }),
  base: Schema.optionalKey(Schema.String).annotate({
    description: "Branch used for ahead and behind counts. Defaults to lts/ocdev.",
  }),
})

const WorktreeStatus = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  head: Schema.String,
  dirty: Schema.Boolean,
  ahead: Schema.Int,
  behind: Schema.Int,
})

export const Output = Schema.Struct({
  sessions: Schema.Array(
    Schema.Struct({
      id: SessionSchema.ID,
      title: Schema.optional(Schema.String),
      agent: Schema.optional(Schema.String),
      parentID: Schema.optional(SessionSchema.ID),
      status: Schema.Literals(["running", "idle"]),
      created: Schema.String,
      updated: Schema.String,
      directory: Schema.String,
      worktree: Schema.NullOr(WorktreeStatus),
    }),
  ),
})

/**
 * `busy` is written when an execution starts and `idle` when one ends, so a live execution can have a
 * `busy` newer than its `idle` or no `idle` at all. Presence of `busy` alone decides; `idle` is read only
 * so a caller can pass the whole `time` record.
 */
export function sessionStatus(time: { readonly busy?: unknown; readonly idle?: unknown }) {
  return time.busy === undefined ? ("idle" as const) : ("running" as const)
}

export const Plugin = {
  id: "opencode.tool.sessions",
  effect: Effect.fn("SessionsTool.Plugin")(function* (ctx: Context) {
    const git = yield* Git.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, _context) =>
            Effect.gen(function* () {
              const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
              const base = input.base ?? DEFAULT_BASE
              const listed = yield* ctx.session
                .list({
                  limit,
                  order: "desc",
                  ...(input.search === undefined ? {} : { search: input.search }),
                  ...(input.parentID === undefined ? {} : { parentID: input.parentID }),
                  archived: input.archived ?? false,
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: "Could not list sessions", error }),
                  ),
                )
              const sessions = listed.data.slice(0, limit)

              // One git lookup per directory, and one per worktree after that: sessions in the same
              // worktree share a branch, a HEAD and a dirty state.
              const directories = [...new Set(sessions.map((session) => session.location.directory))]
              const repositories = new Map<string, Git.Repository>()
              yield* Effect.forEach(
                directories,
                (directory) =>
                  git.repo
                    .discover(AbsolutePath.make(directory))
                    .pipe(Effect.map((repository) => repository && repositories.set(directory, repository))),
                { concurrency: 6, discard: true },
              )

              const worktrees = new Map<string, typeof WorktreeStatus.Type>()
              const missing = { count: 0 }
              yield* Effect.forEach(
                [...new Map([...repositories.values()].map((repository) => [repository.worktree, repository])).values()],
                (repository) =>
                  Effect.gen(function* () {
                    const [branch, head, dirty] = yield* Effect.all(
                      [git.history.branch(repository), git.history.head(repository), git.status.dirty(repository)],
                      { concurrency: "unbounded" },
                    )
                    // A local branch is the expected base; a clone that only has the remote ref still gets counts.
                    const divergence =
                      (yield* git.history.divergence(repository, base)) ??
                      (yield* git.history.divergence(repository, `origin/${base}`))
                    if (!divergence) missing.count++

                    worktrees.set(repository.worktree, {
                      path: repository.worktree,
                      branch: branch ?? "(detached)",
                      head: head?.slice(0, 7) ?? "",
                      dirty,
                      ahead: divergence?.ahead ?? 0,
                      behind: divergence?.behind ?? 0,
                    })
                  }),
                { concurrency: 4, discard: true },
              )

              const rows = sessions.map((session) => {
                const repository = repositories.get(session.location.directory)

                return {
                  id: session.id,
                  title: session.title,
                  agent: session.agent,
                  parentID: session.parentID,
                  status: sessionStatus(session.time),
                  created: DateTime.formatIso(session.time.created),
                  updated: DateTime.formatIso(session.time.updated),
                  directory: session.location.directory,
                  worktree: repository ? (worktrees.get(repository.worktree) ?? null) : null,
                }
              })

              return {
                output: { sessions: rows },
                content: [
                  `Sessions (newest first, ${rows.length} shown, limit ${limit}, base ${base}):`,
                  ...rows.map((row) => {
                    const agent = row.agent ? ` · ${row.agent}` : ""
                    const position = row.worktree
                      ? `${row.worktree.branch} ${row.worktree.head}${row.worktree.dirty ? " dirty" : ""} +${row.worktree.ahead}/-${row.worktree.behind}`
                      : "no worktree"
                    const directory = row.directory || "(no directory)"

                    return `- ${row.id} · ${row.title ?? "Untitled"}${agent} · ${row.status} · ${position} · ${directory}`
                  }),
                  ...(missing.count > 0
                    ? [
                        `${missing.count} worktree(s) do not resolve ${base} (or origin/${base}); their ahead and behind are reported as 0.`,
                      ]
                    : []),
                ].join("\n"),
                metadata: { count: rows.length },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
