import { dialog } from "electron"
import { Effect } from "effect"
import { KnowledgeRpcs } from "../../shared/ipc-rpc"
import { KnowledgeImportProgress } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import { DesktopKnowledge } from "../knowledge"
import { IpcPortHandoff } from "../ipc-transport"
import { nativeT } from "../native/translations"
import { sender } from "./context"

/** Documents a library can hold; the picker still lets folders through. */
const DOCUMENT_EXTENSIONS = ["docx", "pptx", "pdf", "xlsx", "csv", "tsv", "txt", "md", "markdown", "mdx"]

export const knowledgeHandlers = KnowledgeRpcs.toLayer(
  Effect.gen(function* () {
    const knowledge = yield* DesktopKnowledge.Service
    const handoff = yield* IpcPortHandoff

    return KnowledgeRpcs.of({
      // One picker for both: macOS allows files and folders in the same panel, so the user decides
      // what to import instead of choosing a mode first.
      KnowledgePickSources: () =>
        Effect.promise(async () => {
          const result = await dialog.showOpenDialog({
            properties: ["openFile", "openDirectory", "multiSelections"],
            title: nativeT("desktop.dialog.chooseSources"),
            filters: [{ name: nativeT("desktop.dialog.files"), extensions: DOCUMENT_EXTENSIONS }],
          })

          return { paths: result.canceled ? [] : result.filePaths }
        }).pipe(Effect.orDie),
      KnowledgeImportPaths: ({ libraryID, paths }, context) => {
        // Progress goes to the window that asked for the import, so two windows do not cross-talk.
        const contents = sender(handoff, context)

        return knowledge
          .importPaths({ libraryID, paths }, (progress) =>
            Effect.sync(() => {
              if (contents.isDestroyed()) return
              // Desktop events are class instances; encoding a plain object fails and would end the stream.
              emitIpcEvent(contents, new KnowledgeImportProgress({ libraryID, ...progress }))
            }),
          )
          .pipe(Effect.orDie)
      },
      KnowledgeReadFile: ({ libraryID, path }) => knowledge.read(libraryID, path).pipe(Effect.orDie),
      KnowledgeDeleteFiles: ({ libraryID, paths }) => knowledge.deleteFiles(libraryID, paths).pipe(Effect.orDie),
      KnowledgeListFiles: ({ libraryID }) =>
        knowledge.entries(libraryID).pipe(
          Effect.map((files) => ({ files })),
          Effect.orDie,
        ),
      KnowledgeImportStatus: ({ libraryID }) =>
        knowledge.status(libraryID).pipe(
          Effect.map((progress) => ({ progress })),
          Effect.orDie,
        ),
    })
  }),
)
