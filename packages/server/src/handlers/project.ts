import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { ProjectNotFoundError } from "@opencode/protocol/errors"

function missingProject(projectID: Project.ID) {
  return new ProjectNotFoundError({ projectID, message: `Project not found: ${projectID}` })
}

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const project = yield* Project.Service
    const session = yield* Session.Service

    // Session.remove first, so a running turn is interrupted and clients see session.deleted; the project row's
    // cascade then sweeps anything the list did not reach.
    const removeSessions = (projectID: Project.ID): Effect.Effect<void> =>
      session.list({ project: projectID, limit: 200 }).pipe(
        Effect.orDie,
        Effect.flatMap((page) => {
          if (page.data.length === 0) return Effect.void

          return Effect.forEach(
            page.data,
            (item) => session.remove(item.id).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.void)),
            { concurrency: 1, discard: true },
          ).pipe(Effect.flatMap(() => removeSessions(projectID)))
        }),
      )

    return handlers
      .handle("project.list", (ctx) => project.list(ctx.query))
      .handle("project.update", (ctx) =>
        project.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
          Effect.mapError(
            () =>
              new ProjectNotFoundError({
                projectID: ctx.params.projectID,
                message: `Project not found: ${ctx.params.projectID}`,
              }),
          ),
        ),
      )
      .handle(
        "project.remove",
        Effect.fn(function* (ctx) {
          const projectID = ctx.params.projectID
          const existing = yield* project.get(projectID)

          if (!existing) return yield* missingProject(projectID)

          yield* removeSessions(projectID)
          yield* project.remove(projectID).pipe(Effect.mapError(() => missingProject(projectID)))

          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
