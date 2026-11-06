export * as Knowledge from "./knowledge.js"

import { and, eq, inArray } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Node, makeGlobalNode } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Knowledge as KnowledgeSchema } from "@opencode/schema/knowledge"
import { Agent } from "./agent.js"
import { Database } from "./database/database.js"
import {
  KnowledgeChunkTable,
  KnowledgeDocumentTable,
  KnowledgeLibraryTable,
  ProjectKnowledgeTable,
} from "./knowledge/sql.js"
import { Location } from "./location.js"
import { LocationServiceMap } from "./location-service-map.js"
import { Model } from "./model.js"
import { Project } from "./project.js"
import { Session } from "./session.js"

const CHUNK_SIZE = 1000

const CHUNK_OVERLAP = 100

/** Keep the prompt a small model sees bounded, no matter how large the library is. */
const SUMMARY_BUDGET = 12_000

const SUMMARY_DOCUMENT = 600

const DEFAULT_LIMIT = 6

const MAX_CANDIDATES = 2_000

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<KnowledgeSchema.Info>>
  /** Stores the desktop copy of a library and rebuilds its deterministic index. */
  readonly sync: (libraryID: string, input: KnowledgeSchema.SyncInput) => Effect.Effect<KnowledgeSchema.Info>
  readonly remove: (libraryID: string) => Effect.Effect<void>
  readonly assign: (input: { projectID: Project.ID; libraryID: string }) => Effect.Effect<void>
  readonly unassign: (input: { projectID: Project.ID; libraryID: string }) => Effect.Effect<void>
  readonly assigned: (projectID: Project.ID) => Effect.Effect<ReadonlyArray<KnowledgeSchema.Info>>
  /** Chunks from the libraries assigned to one Project, best match first. */
  readonly search: (input: {
    projectID: Project.ID
    query: string
    limit?: number
  }) => Effect.Effect<ReadonlyArray<KnowledgeSchema.SearchHit>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Knowledge") {}

type LibraryRow = typeof KnowledgeLibraryTable.$inferSelect

const toInfo = (row: LibraryRow): KnowledgeSchema.Info => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  summary: row.summary ?? undefined,
  keywords: row.keywords ?? [],
  status: row.status,
  model: row.model ?? undefined,
  documentCount: row.document_count,
  chunkCount: row.chunk_count,
  indexedAt: row.indexed_at === null ? undefined : DateTime.makeUnsafe(row.indexed_at),
  time: { created: DateTime.makeUnsafe(row.time_created), updated: DateTime.makeUnsafe(row.time_updated) },
})

/** A deterministic, dependency-free hash: the same text always maps to the same chunk set. */
function hash(text: string) {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(16)
}

function chunks(text: string) {
  const characters = Array.from(text)
  if (characters.length === 0) return []
  const result: string[] = []
  let start = 0
  while (start < characters.length) {
    result.push(characters.slice(start, start + CHUNK_SIZE).join(""))
    if (start + CHUNK_SIZE >= characters.length) break
    start += CHUNK_SIZE - CHUNK_OVERLAP
  }
  return result
}

/** Latin words plus CJK bigrams, which is enough to rank passages without a tokenizer dependency. */
export function queryTokens(query: string) {
  const normalized = query.toLocaleLowerCase()
  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1)
  const cjk = Array.from(normalized.replace(/[^\u3400-\u9fff]/gu, ""))
  const bigrams = cjk.flatMap((character, index) => {
    const next = cjk[index + 1]
    return next === undefined ? [] : [character + next]
  })
  return [...new Set([...words, ...bigrams])]
}

const excerpt = (text: string, tokens: ReadonlyArray<string>) => {
  const lower = text.toLocaleLowerCase()
  const at = tokens.reduce((found, token) => (found === -1 ? lower.indexOf(token) : found), -1)
  if (at <= 200) return text.slice(0, 400)
  return `…${text.slice(at - 120, at + 280)}`
}

const Summary = Schema.Struct({
  summary: Schema.String,
  keywords: Schema.Array(Schema.String),
})

/** Small models often wrap JSON in a Markdown fence even when told not to. */
function stripFence(text: string) {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const scope = yield* Effect.scope
    const projects = yield* Project.Service
    const sessions = yield* Session.Service
    const locations = yield* LocationServiceMap.Service

    // An index run dies with the process, so a library left `indexing` can never finish. Marking it
    // failed stops the settings page polling and lets the next sync retry it.
    yield* db
      .update(KnowledgeLibraryTable)
      .set({ status: "failed" })
      .where(eq(KnowledgeLibraryTable.status, "indexing"))
      .run()
      .pipe(Effect.orDie)

    const lookup = (libraryID: string) =>
      db
        .select()
        .from(KnowledgeLibraryTable)
        .where(eq(KnowledgeLibraryTable.id, libraryID))
        .get()
        .pipe(Effect.orDie, Effect.map(Option.fromNullishOr))

    const find = (libraryID: string) =>
      lookup(libraryID).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.die(new Error(`Knowledge library ${libraryID} is missing`)),
            onSome: Effect.succeed,
          }),
        ),
      )

    /** A free text model first; a paid default only when nothing free is enabled. */
    const summaryModel = Effect.fn("Knowledge.summaryModel")(function* (project: Project.Info) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          // The model catalog belongs to a Location, so borrow the assigned Project's own services.
          const context = yield* locations.contextEffect(Location.Ref.make({ directory: project.canonical }))
          const models = Context.get(context, Model.Service)
          const available = yield* models.available().pipe(Effect.provideContext(context))
          const free = available.find(
            (model) =>
              model.capabilities.input.some((item) => item.startsWith("text")) &&
              model.capabilities.output.some((item) => item.startsWith("text")) &&
              model.cost.length > 0 &&
              model.cost.every((cost) => cost.input === 0 && cost.output === 0),
          )
          if (free) return free
          return yield* models.default().pipe(Effect.provideContext(context))
        }),
      )
    })

    /** The stored text of a library, in the shape an index run consumes. */
    const readBack = (libraryID: string) =>
      Effect.gen(function* () {
        const library = yield* find(libraryID)
        const documents = yield* db
          .select({
            path: KnowledgeDocumentTable.path,
            name: KnowledgeDocumentTable.name,
            kind: KnowledgeDocumentTable.kind,
            size: KnowledgeDocumentTable.size,
            text: KnowledgeDocumentTable.text,
          })
          .from(KnowledgeDocumentTable)
          .where(eq(KnowledgeDocumentTable.library_id, libraryID))
          .all()
          .pipe(Effect.orDie)

        return { library, input: { name: library.name, description: library.description ?? undefined, documents } }
      })

    const markReady = (libraryID: string) =>
      db
        .update(KnowledgeLibraryTable)
        .set({ status: "ready", indexed_at: Date.now(), time_updated: Date.now() })
        .where(eq(KnowledgeLibraryTable.id, libraryID))
        .run()
        .pipe(Effect.orDie)

    const markFailed = (libraryID: string) =>
      db
        .update(KnowledgeLibraryTable)
        .set({ status: "failed", time_updated: Date.now() })
        .where(eq(KnowledgeLibraryTable.id, libraryID))
        .run()
        .pipe(Effect.orDie)

    /** One hidden Session per index run, using the cheapest model available, removed afterwards. */
    const summarize = Effect.fn("Knowledge.summarize")(function* (
      libraryID: string,
      input: KnowledgeSchema.SyncInput,
      project: Project.Info,
    ) {
      const model = yield* summaryModel(project).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!model) return false

      const documents = input.documents.slice(0, 24)
      const body = documents
        .map((document) => `## ${document.name} (${document.path})\n${document.text.slice(0, SUMMARY_DOCUMENT)}`)
        .join("\n\n")
        .slice(0, SUMMARY_BUDGET)

      const created = yield* sessions
        .create({
          location: { directory: project.canonical },
          agent: Agent.ID.make("knowledge"),
          model: { id: model.id, providerID: model.providerID },
          title: `Knowledge index: ${input.name}`,
        })
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!created) return false

      const generated = yield* sessions
        .generate({
          sessionID: created.id,
          prompt: [
            `Library: ${input.name}`,
            input.description ? `Purpose: ${input.description}` : "",
            "Documents:",
            body,
            'Reply with JSON only: {"summary": "one or two sentences about what this library covers", "keywords": ["up to", "eight", "short", "terms"]}.',
          ]
            .filter(Boolean)
            .join("\n\n"),
        })
        .pipe(Effect.catch(() => Effect.succeed("")))

      yield* sessions.remove(created.id).pipe(Effect.catch(() => Effect.void))

      const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Summary))(stripFence(generated))
      const written = Option.getOrUndefined(decoded)
      yield* db
        .update(KnowledgeLibraryTable)
        .set({
          status: "ready",
          model: `${model.providerID}/${model.id}`,
          indexed_at: Date.now(),
          time_updated: Date.now(),
          ...(written ? { summary: written.summary, keywords: written.keywords.slice(0, 8) } : {}),
        })
        .where(eq(KnowledgeLibraryTable.id, libraryID))
        .run()
        .pipe(Effect.orDie)

      return true
    })

    /**
     * Runs in the background after content changes or a first assignment. A library with no assigned
     * Project still indexes its chunks, so a later assignment only adds the summary.
     */
    const index = Effect.fn("Knowledge.index")(function* (libraryID: string) {
      const linked = yield* db
        .select({ projectID: ProjectKnowledgeTable.project_id })
        .from(ProjectKnowledgeTable)
        .where(eq(ProjectKnowledgeTable.library_id, libraryID))
        .all()
        .pipe(Effect.orDie)
      const project =
        linked.length === 0
          ? undefined
          : yield* projects.get(linked[0].projectID).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!project) {
        yield* markReady(libraryID)
        return
      }

      const { input } = yield* readBack(libraryID)
      const indexed = yield* summarize(libraryID, input, project).pipe(
        Effect.catch(() => Effect.succeed(false)),
      )
      if (!indexed) yield* markFailed(libraryID)
    })

    return Service.of({
      list: Effect.fn("Knowledge.list")(function* () {
        const rows = yield* db.select().from(KnowledgeLibraryTable).all().pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
      sync: Effect.fn("Knowledge.sync")(function* (libraryID, input) {
        const now = Date.now()
        const existing = yield* lookup(libraryID)
        const previous = yield* db
          .select({ path: KnowledgeDocumentTable.path, hash: KnowledgeDocumentTable.hash })
          .from(KnowledgeDocumentTable)
          .where(eq(KnowledgeDocumentTable.library_id, libraryID))
          .all()
          .pipe(Effect.orDie)
        const known = new Map(previous.map((row) => [row.path, row.hash]))
        const changed =
          Option.isNone(existing) ||
          previous.length !== input.documents.length ||
          input.documents.some((document) => known.get(document.path) !== hash(document.text))

        const rows = input.documents.map((document) => ({
          library_id: libraryID,
          path: document.path,
          name: document.name,
          kind: document.kind,
          size: document.size,
          hash: hash(document.text),
          text: document.text,
        }))
        const pieces = input.documents.flatMap((document) =>
          chunks(document.text).map((text, ordinal) => ({ library_id: libraryID, path: document.path, ordinal, text })),
        )
        // An unchanged library keeps the status it already reached; changed content or a retried
        // failure waits for an index run.
        const retry = Option.match(existing, {
          onNone: () => false,
          onSome: (row) => row.status === "failed",
        })
        const reindex = rows.length > 0 && (changed || retry)
        const status: KnowledgeSchema.Status =
          rows.length === 0
            ? "empty"
            : reindex
              ? "indexing"
              : Option.match(existing, {
                  onNone: () => "ready" as const,
                  onSome: (row) => row.status,
                })

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .insert(KnowledgeLibraryTable)
              .values({
                id: libraryID,
                name: input.name,
                description: input.description ?? null,
                keywords: [],
                status,
                document_count: rows.length,
                chunk_count: pieces.length,
                time_created: now,
                time_updated: now,
              })
              .onConflictDoUpdate({
                target: KnowledgeLibraryTable.id,
                set: {
                  name: input.name,
                  description: input.description ?? null,
                  document_count: rows.length,
                  chunk_count: pieces.length,
                  status,
                  time_updated: now,
                },
              })
              .run()
            yield* tx.delete(KnowledgeDocumentTable).where(eq(KnowledgeDocumentTable.library_id, libraryID)).run()
            yield* tx.delete(KnowledgeChunkTable).where(eq(KnowledgeChunkTable.library_id, libraryID)).run()
            if (rows.length > 0) yield* tx.insert(KnowledgeDocumentTable).values(rows).run()
            if (pieces.length > 0) yield* tx.insert(KnowledgeChunkTable).values(pieces).run()
          }),
        ).pipe(Effect.orDie)

        // Indexing continues after the upload returns, on the service's process lifetime.
        if (reindex) yield* index(libraryID).pipe(Effect.forkIn(scope), Effect.asVoid)

        return toInfo(yield* find(libraryID))
      }),
      remove: Effect.fn("Knowledge.remove")(function* (libraryID) {
        yield* db.delete(KnowledgeLibraryTable).where(eq(KnowledgeLibraryTable.id, libraryID)).run().pipe(Effect.orDie)
      }),
      assign: Effect.fn("Knowledge.assign")(function* (input) {
        yield* db
          .insert(ProjectKnowledgeTable)
          .values({ project_id: input.projectID, library_id: input.libraryID, time_created: Date.now() })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)

        // A library synced before anyone assigned it has chunks but no summary; assignment adds that context.
        const row = yield* lookup(input.libraryID)
        if (Option.isSome(row) && row.value.document_count > 0 && (!row.value.indexed_at || !row.value.model))
          yield* index(input.libraryID).pipe(Effect.forkIn(scope), Effect.asVoid)
      }),
      unassign: Effect.fn("Knowledge.unassign")(function* (input) {
        yield* db
          .delete(ProjectKnowledgeTable)
          .where(
            and(
              eq(ProjectKnowledgeTable.project_id, input.projectID),
              eq(ProjectKnowledgeTable.library_id, input.libraryID),
            ),
          )
          .run()
          .pipe(Effect.orDie)
      }),
      assigned: Effect.fn("Knowledge.assigned")(function* (projectID) {
        const rows = yield* db
          .select({ library: KnowledgeLibraryTable })
          .from(ProjectKnowledgeTable)
          .innerJoin(
            KnowledgeLibraryTable,
            eq(KnowledgeLibraryTable.id, ProjectKnowledgeTable.library_id),
          )
          .where(eq(ProjectKnowledgeTable.project_id, projectID))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => toInfo(row.library))
      }),
      search: Effect.fn("Knowledge.search")(function* (input) {
        const tokens = queryTokens(input.query)
        if (tokens.length === 0) return []
        const libraryIDs = yield* db
          .select({ libraryID: ProjectKnowledgeTable.library_id })
          .from(ProjectKnowledgeTable)
          .where(eq(ProjectKnowledgeTable.project_id, input.projectID))
          .all()
          .pipe(Effect.orDie)
        if (libraryIDs.length === 0) return []

        const ids = libraryIDs.map((row) => row.libraryID)
        const rows = yield* db
          .select({
            libraryID: KnowledgeChunkTable.library_id,
            path: KnowledgeChunkTable.path,
            ordinal: KnowledgeChunkTable.ordinal,
            text: KnowledgeChunkTable.text,
            libraryName: KnowledgeLibraryTable.name,
            documentName: KnowledgeDocumentTable.name,
          })
          .from(KnowledgeChunkTable)
          .innerJoin(KnowledgeLibraryTable, eq(KnowledgeLibraryTable.id, KnowledgeChunkTable.library_id))
          .leftJoin(
            KnowledgeDocumentTable,
            and(
              eq(KnowledgeDocumentTable.library_id, KnowledgeChunkTable.library_id),
              eq(KnowledgeDocumentTable.path, KnowledgeChunkTable.path),
            ),
          )
          .where(inArray(KnowledgeChunkTable.library_id, ids))
          .limit(MAX_CANDIDATES)
          .all()
          .pipe(Effect.orDie)

        const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 20)
        return rows
          .map((row) => {
            const lower = row.text.toLocaleLowerCase()
            const score = tokens.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0)
            const name = row.documentName ?? row.path.split("/").pop() ?? row.path
            return {
              libraryID: row.libraryID,
              libraryName: row.libraryName,
              path: row.path,
              name,
              ordinal: row.ordinal,
              text: excerpt(row.text, tokens),
              score,
              matches: name.toLocaleLowerCase().includes(tokens[0] ?? "") ? score + 1 : score,
            }
          })
          .filter((hit) => hit.matches > 0)
          .toSorted((left, right) => right.matches - left.matches)
          .slice(0, limit)
          .map(({ matches: _matches, ...hit }) => hit)
      }),
    })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, Project.node, Session.node, LocationServiceMap.node],
})
