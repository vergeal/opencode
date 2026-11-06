import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { Knowledge } from "@opencode/schema/knowledge"
import { Timestamps } from "../database/schema.sql.js"
import { ProjectTable } from "../project/sql.js"
import type { ProjectSchema } from "../project/schema.js"

export const KnowledgeLibraryTable = sqliteTable("knowledge_library", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text(),
  summary: text(),
  keywords: text({ mode: "json" }).$type<string[]>(),
  status: text().$type<Knowledge.Status>().notNull().default("empty"),
  model: text(),
  document_count: integer().notNull().default(0),
  chunk_count: integer().notNull().default(0),
  indexed_at: integer(),
  ...Timestamps,
})

export const KnowledgeDocumentTable = sqliteTable(
  "knowledge_document",
  {
    library_id: text()
      .notNull()
      .references(() => KnowledgeLibraryTable.id, { onDelete: "cascade" }),
    path: text().notNull(),
    name: text().notNull(),
    kind: text().$type<Knowledge.DocumentKind>().notNull(),
    size: integer().notNull(),
    hash: text().notNull(),
    text: text().notNull(),
  },
  (table) => [primaryKey({ columns: [table.library_id, table.path] })],
)

export const KnowledgeChunkTable = sqliteTable(
  "knowledge_chunk",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    library_id: text()
      .notNull()
      .references(() => KnowledgeLibraryTable.id, { onDelete: "cascade" }),
    path: text().notNull(),
    ordinal: integer().notNull(),
    text: text().notNull(),
  },
  (table) => [index("knowledge_chunk_library_idx").on(table.library_id)],
)

export const ProjectKnowledgeTable = sqliteTable(
  "project_knowledge",
  {
    project_id: text()
      .$type<ProjectSchema.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    library_id: text()
      .notNull()
      .references(() => KnowledgeLibraryTable.id, { onDelete: "cascade" }),
    time_created: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.library_id] })],
)
