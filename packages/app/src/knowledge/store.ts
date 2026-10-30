import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"

export type KnowledgeFileKind = "document" | "spreadsheet" | "text"

export type KnowledgeFile = {
  path: string
  name: string
  size: number
  kind: KnowledgeFileKind
}

export type KnowledgeLibrary = {
  id: string
  name: string
  /** Absolute directory the files were imported from; empty until a directory is imported. */
  root: string
  summary: string
  createdAt: number
  files: KnowledgeFile[]
}

const LibraryFile = Persistence.struct({
  path: Schema.String,
  name: Schema.String,
  size: Schema.Finite,
  kind: Schema.Literals(["document", "spreadsheet", "text"]),
})

const Library = Persistence.struct({
  id: Schema.String,
  name: Schema.String,
  root: Schema.String,
  summary: Schema.String,
  createdAt: Schema.Finite,
  files: Persistence.array(LibraryFile),
})

const Libraries = Persistence.struct({ libraries: Persistence.array(Library) })

// One store for every surface: the navigation entry, the library grid and the browser all read the same list.
export function useKnowledgeLibraries() {
  const [state, setState] = persisted({ ...Persist.global("knowledge.libraries"), sync: true }, Libraries, {
    libraries: [],
  })

  const update = (id: string, patch: Partial<Omit<KnowledgeLibrary, "id">>) =>
    setState("libraries", (current) =>
      current.map((library) => (library.id === id ? { ...library, ...patch } : library)),
    )

  return {
    libraries: () => state.libraries,
    get: (id: string) => state.libraries.find((library) => library.id === id),
    create: (name: string) => {
      const library: KnowledgeLibrary = {
        id: crypto.randomUUID(),
        name,
        root: "",
        summary: "",
        createdAt: Date.now(),
        files: [],
      }

      setState("libraries", (current) => [...current, library])

      return library.id
    },
    rename: (id: string, name: string) => update(id, { name }),
    remove: (id: string) => setState("libraries", (current) => current.filter((library) => library.id !== id)),
    setImported: (id: string, root: string, files: ReadonlyArray<KnowledgeFile>) =>
      update(id, { root, files: [...files] }),
    setSummary: (id: string, summary: string) => update(id, { summary }),
  }
}
