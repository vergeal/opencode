import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

it.live("rejects assigning a library the server has no copy of and lists a synced library once assigned", () =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-knowledge-api-")).path
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: dir, project: true, claude: false },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const api = client(handler)
    const route = (method: string, path: string) =>
      handler(new Request(`http://opencode.local${path}`, { method }))

    yield* Effect.promise(async () => {
      // A Session creates the Project that knowledge assignments hang off.
      const session = await api.session.create({ location: { directory: dir } })
      const projectID = session.projectID

      // project_knowledge's foreign key rejects a library the server has no copy of, which must read as a bad request.
      const missing = await route("PUT", `/api/experimental/knowledge/assigned/${projectID}/missing-library`)
      expect(missing.status).toBe(400)
      expect(await missing.json()).toMatchObject({
        _tag: "InvalidRequestError",
        kind: "knowledge",
        message: "Knowledge library not found: missing-library",
      })
      const unassigned = await route("DELETE", `/api/experimental/knowledge/assigned/${projectID}/missing-library`)
      expect(unassigned.status).toBe(400)

      // A library synced first has a server copy, so assigning it succeeds and the Project lists it.
      await api.experimental["server.knowledge"].sync({
        libraryID: "synced-library",
        name: "Synced",
        documents: [{ path: "guide.md", name: "guide", kind: "document", size: 11, text: "hello world" }],
      })
      const assigned = await route("PUT", `/api/experimental/knowledge/assigned/${projectID}/synced-library`)
      expect(assigned.status).toBe(204)
      expect(await api.experimental["server.knowledge"].assigned({ projectID })).toMatchObject([
        { id: "synced-library" },
      ])
    })
  }).pipe(Effect.scoped),
)
