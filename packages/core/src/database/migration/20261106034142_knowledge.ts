import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261106034142_knowledge",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`knowledge_chunk\` (
          \`id\` integer PRIMARY KEY AUTOINCREMENT,
          \`library_id\` text NOT NULL,
          \`path\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`text\` text NOT NULL,
          CONSTRAINT \`fk_knowledge_chunk_library_id_knowledge_library_id_fk\` FOREIGN KEY (\`library_id\`) REFERENCES \`knowledge_library\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`knowledge_document\` (
          \`library_id\` text NOT NULL,
          \`path\` text NOT NULL,
          \`name\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`size\` integer NOT NULL,
          \`hash\` text NOT NULL,
          \`text\` text NOT NULL,
          CONSTRAINT \`knowledge_document_pk\` PRIMARY KEY(\`library_id\`, \`path\`),
          CONSTRAINT \`fk_knowledge_document_library_id_knowledge_library_id_fk\` FOREIGN KEY (\`library_id\`) REFERENCES \`knowledge_library\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`knowledge_library\` (
          \`id\` text PRIMARY KEY,
          \`name\` text NOT NULL,
          \`description\` text,
          \`summary\` text,
          \`keywords\` text,
          \`status\` text DEFAULT 'empty' NOT NULL,
          \`model\` text,
          \`document_count\` integer DEFAULT 0 NOT NULL,
          \`chunk_count\` integer DEFAULT 0 NOT NULL,
          \`indexed_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_knowledge\` (
          \`project_id\` text NOT NULL,
          \`library_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_knowledge_pk\` PRIMARY KEY(\`project_id\`, \`library_id\`),
          CONSTRAINT \`fk_project_knowledge_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_project_knowledge_library_id_knowledge_library_id_fk\` FOREIGN KEY (\`library_id\`) REFERENCES \`knowledge_library\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`knowledge_chunk_library_idx\` ON \`knowledge_chunk\` (\`library_id\`);`)
    })
  },
}

export default migration
