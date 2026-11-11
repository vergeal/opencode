import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform, type KnowledgeDiscard, type KnowledgeDiscardReason } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useLayout } from "@/shell/state/layout"
import { DISCARD_GROUPS, discardGroup, type DiscardGroup } from "./display"
import { importKnowledge, pickKnowledgeSources } from "./import"
import { knowledgeImports, type KnowledgeImportJob } from "./import-status"
import { NewLibraryDialog } from "./new-library-dialog"
import { previewPath, transition, type PreviewState } from "./preview-machine"
import { useKnowledgeLibraries, type KnowledgeFile, type KnowledgeFlag, type KnowledgeLibrary } from "./store"
import { isKnowledgeLibraryOnServer, removeKnowledgeLibraryFromServer, syncKnowledgeLibrary } from "./sync"
import { reviewLibrary } from "./summary"

/**
 * The knowledge model: the libraries, the open one, the file selection and the preview. The navigation column and
 * the workspace share one instance, so the file list, the bulk actions and the preview always agree.
 */
export function createKnowledge() {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const global = useGlobal()
  const dialog = useDialog()
  const layout = useLayout()
  const libraries = useKnowledgeLibraries()

  // SAFETY: an empty array literal has no element to infer from, and every write below stores a knowledge-file path.
  const [state, setState] = createStore({
    query: "",
    importError: "",
    selectedFiles: [] as string[],
  })

  // The preview is its own lifecycle: opening a file must never look like an idle pane with stale text.
  const [preview, setPreview] = createSignal<PreviewState>({ status: "idle" })

  const closePreview = () => setPreview((current) => transition(current, { type: "file.closed" }))

  const previewText = () => {
    const current = preview()

    return current.status === "ready" ? current.text : ""
  }

  const previewMessage = () => {
    const current = preview()

    return current.status === "failed" ? current.message : ""
  }

  const library = createMemo(() => {
    const id = layout.destination.knowledge.library()

    return id ? libraries.get(id) : undefined
  })

  const importing = () => {
    const current = library()

    return current ? !!knowledgeImports.get(current.id) : false
  }

  /** The running import for the open library, whose pipeline the workspace renders. */
  const job = () => {
    const current = library()

    return current ? knowledgeImports.get(current.id) : undefined
  }

  const visibleFiles = createMemo(() => {
    const query = state.query.trim().toLocaleLowerCase()

    return [...(library()?.files ?? [])]
      .filter(
        (file) =>
          !query || file.path.toLocaleLowerCase().includes(query) || file.source.toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => a.path.localeCompare(b.path))
  })

  const fileGroups = createMemo(() => {
    const groups = new Map<string, KnowledgeFile[]>()

    for (const file of visibleFiles()) {
      const slash = file.path.lastIndexOf("/")
      const directory = slash === -1 ? "" : file.path.slice(0, slash)
      const files = groups.get(directory)

      if (files) files.push(file)
      else groups.set(directory, [file])
    }

    return [...groups.entries()]
  })

  const previewFile = createMemo(() => library()?.files.find((file) => file.path === previewPath(preview())))

  const allVisibleSelected = createMemo(() => {
    const files = visibleFiles()

    return files.length > 0 && files.every((file) => state.selectedFiles.includes(file.path))
  })

  // Progress arrives while the import promise is still pending, so it cannot be read from its result.
  onMount(() => {
    const stop = platform.onKnowledgeImportProgress?.((progress) => {
      if (progress.stage === "done") return

      knowledgeImports.update(progress)
    })

    onCleanup(() => stop?.())
  })

  const openNewLibrary = () =>
    void dialog.show(() => (
      <NewLibraryDialog
        onCreate={(name, description) => {
          const id = libraries.create(name, description)
          layout.destination.knowledge.setLibrary(id)
          setState({ query: "", selectedFiles: [] })
          closePreview()
        }}
      />
    ))

  /**
   * Opening a library reads its files back from the desktop store, which owns them, and rejoins an
   * import that kept running after the user left the workspace.
   */
  const openLibrary = (target: KnowledgeLibrary) => {
    layout.destination.knowledge.setLibrary(target.id)
    setState({ query: "", selectedFiles: [] })
    closePreview()

    void platform
      .listKnowledgeFiles?.({ libraryID: target.id })
      .then((stored) => {
        if (stored) libraries.setFiles(target.id, stored.files)
      })
      .catch(() => undefined)

    void platform
      .knowledgeImportStatus?.(target.id)
      .then((result) => {
        if (!result) return

        if (!result.progress || result.progress.stage === "done") {
          knowledgeImports.end(target.id)

          return
        }

        knowledgeImports.update(result.progress)
      })
      .catch(() => undefined)
  }

  const closeLibrary = () => {
    layout.destination.knowledge.setLibrary(undefined)
    setState({ query: "", selectedFiles: [] })
    closePreview()
  }

  /** Libraries imported before the detail list existed only have counts, so their chips stay read-only. */
  const discardsOf = (target: KnowledgeLibrary, group: DiscardGroup) =>
    (target.discards ?? []).filter((discard) => discardGroup(discard.reason) === group)

  /** The chip counts what the detail list can show, so the number and the list always agree. */
  const skipCount = (target: KnowledgeLibrary, group: DiscardGroup) => {
    if (target.discards?.length) return discardsOf(target, group).length

    if (group === "duplicate") return target.stats?.duplicates ?? 0

    if (group === "similar") return target.stats?.similar ?? 0

    return target.stats?.skipped ?? 0
  }

  const flagOf = (target: KnowledgeLibrary, path: string) => (target.flags ?? []).find((flag) => flag.path === path)

  const openDiscards = (target: KnowledgeLibrary, group: DiscardGroup) => {
    const discards = target.discards ?? []

    if (!discards.some((discard) => discardGroup(discard.reason) === group)) return

    void dialog.show(() => <DiscardsDialog discards={discards} initial={group} />)
  }

  /** Library content lives in desktop storage; dropping it must never touch the imported folder. */
  const forgetFiles = (target: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    const remove = platform.deleteKnowledgeFiles

    if (platform.platform !== "desktop" || !remove) return
    void remove(target.id, [...paths]).catch(() => undefined)
  }

  const knowledgeApi = () => {
    const connection = servers.list[0]

    return connection ? global.serverCtx(ServerConnection.key(connection))?.sdk.api : undefined
  }

  /**
   * A server copy exists only after a project linked the library. Edits keep that copy current, and
   * libraries nobody linked stay local.
   */
  const mirrorServerCopy = (libraryID: string) => {
    const api = knowledgeApi()
    const target = libraries.get(libraryID)

    if (!api || !target || platform.platform !== "desktop" || !platform.readKnowledgeFile) return

    void (async () => {
      if (!(await isKnowledgeLibraryOnServer(api, libraryID))) return
      await syncKnowledgeLibrary({ api, platform, library: target })
    })().catch(() => undefined)
  }

  const dropServerCopy = (libraryID: string) => {
    const api = knowledgeApi()

    if (!api) return
    void removeKnowledgeLibraryFromServer(api, libraryID).catch(() => undefined)
  }

  /** The user decides: a flagged document stays unless they remove it, and the flag can be cleared. */
  const openFlag = (target: KnowledgeLibrary, file: KnowledgeFile, flag: KnowledgeFlag) =>
    void dialog.show(() => (
      <FlaggedFileDialog
        name={file.name}
        reason={flag.reason}
        onKeep={() => libraries.clearFlag(target.id, file.path)}
        onRemove={() => {
          forgetFiles(target, [file.path])
          libraries.removeFiles(target.id, [file.path])
          mirrorServerCopy(target.id)

          if (previewPath(preview()) === file.path) closePreview()
        }}
      />
    ))

  /** Documents an import judged off-topic stay in the library until someone removes them. */
  const flaggedPaths = (target: KnowledgeLibrary) => (target.flags ?? []).map((flag) => flag.path)

  const flaggedIn = (target: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    const flagged = new Set(flaggedPaths(target))

    return paths.filter((path) => flagged.has(path))
  }

  /** Marking by hand leaves the reason empty, so the row keeps the generic label. */
  const markPaths = (target: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    if (!paths.length) return

    libraries.setFlags(
      target.id,
      paths.map((path) => ({ path, reason: "" })),
    )
  }

  const unmarkPaths = (target: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    if (!paths.length) return

    libraries.clearFlags(target.id, paths)
  }

  const removePaths = (target: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    if (!paths.length) return

    forgetFiles(target, paths)
    libraries.removeFiles(target.id, paths)
    mirrorServerCopy(target.id)

    if (paths.includes(previewPath(preview()))) closePreview()
    setState("selectedFiles", (current) => current.filter((path) => !paths.includes(path)))
  }

  const confirmRemovePaths = (target: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    if (!paths.length) return

    void dialog.show(() => <RemoveFilesDialog count={paths.length} onConfirm={() => removePaths(target, paths)} />)
  }

  /** One action for everything the library marked, instead of deleting them one by one. */
  const confirmRemoveFlagged = (target: KnowledgeLibrary) => {
    const paths = flaggedPaths(target)

    if (!paths.length) return

    void dialog.show(() => (
      <RemoveFilesDialog count={paths.length} flagged onConfirm={() => removePaths(target, paths)} />
    ))
  }

  const removeLibrary = (target: KnowledgeLibrary) => {
    void dialog.show(() => (
      <RemoveLibraryDialog
        name={target.name}
        onConfirm={() => {
          forgetFiles(
            target,
            target.files.map((file) => file.path),
          )
          libraries.remove(target.id)
          dropServerCopy(target.id)
          layout.destination.knowledge.setLibrary(undefined)
          setState("selectedFiles", [])
          closePreview()
        }}
      />
    ))
  }

  /** One entry point: the picker accepts folders and files together, several at a time. */
  const runImport = async () => {
    const target = library()

    if (!target || importing()) return
    const paths = await pickKnowledgeSources(platform)

    if (!paths.length) return

    setState("importError", "")
    knowledgeImports.begin(target.id)

    try {
      const imported = await importKnowledge({ platform, libraryID: target.id, paths })

      if (!imported) return

      libraries.addImported(target.id, {
        files: imported.files,
        sources: paths,
        stats: imported.stats,
        discards: imported.discards,
      })

      // The main process owns the stored files, so reading them back also recovers an earlier run
      // whose result never reached this window.
      const stored = await platform.listKnowledgeFiles?.({ libraryID: target.id }).catch(() => undefined)

      if (stored) libraries.setFiles(target.id, stored.files)

      mirrorServerCopy(target.id)

      setState("selectedFiles", [])
      closePreview()
      knowledgeImports.stage(target.id, "summarize")

      // Re-importing a folder adds nothing, and an empty excerpt set cannot describe the library.
      // Keep the summary that already explains it.
      if (imported.files.length > 0 || !target.summary) {
        const connection = servers.list[0]
        // One small call covers both: the description of the library and the documents that do not
        // fit the description the user wrote when creating it.
        const api = connection ? global.serverCtx(ServerConnection.key(connection))?.sdk.api : undefined

        const review = api
          ? await reviewLibrary({
              api,
              name: target.name,
              description: target.description ?? "",
              excerpts: imported.excerpts,
            })
          : undefined

        const total = stored?.files.length ?? target.files.length + imported.files.length

        libraries.setSummary(
          target.id,
          review?.summary ?? language.plural("knowledge.summary.fallback", total, { count: total }),
        )

        if (review?.irrelevant.length) libraries.setFlags(target.id, review.irrelevant)
      }
    } catch (error) {
      setState("importError", error instanceof Error ? error.message : String(error))
    } finally {
      knowledgeImports.end(target.id)
    }
  }

  const openFile = async (target: KnowledgeLibrary, file: KnowledgeFile) => {
    setPreview((current) => transition(current, { type: "file.opened", path: file.path }))

    try {
      const result = await platform.readKnowledgeFile?.({ libraryID: target.id, path: file.path })
      // The machine drops a read for a file the user already left.
      setPreview((current) => transition(current, { type: "file.loaded", path: file.path, text: result?.text ?? "" }))
    } catch (error) {
      setPreview((current) =>
        transition(current, {
          type: "file.failed",
          path: file.path,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  const retryPreview = () => {
    const target = library()
    const file = previewFile()

    if (target && file) void openFile(target, file)
  }

  const toggleFile = (path: string, checked: boolean) =>
    setState("selectedFiles", (current) =>
      checked ? [...new Set([...current, path])] : current.filter((item) => item !== path),
    )

  const toggleVisible = (checked: boolean) => {
    const paths = visibleFiles().map((file) => file.path)

    setState("selectedFiles", (current) =>
      checked ? [...new Set([...current, ...paths])] : current.filter((path) => !paths.includes(path)),
    )
  }

  const removeSelectedFiles = () => {
    const target = library()
    const paths = [...state.selectedFiles]

    if (!target || !paths.length) return

    forgetFiles(target, paths)
    libraries.removeFiles(target.id, paths)
    mirrorServerCopy(target.id)

    if (paths.includes(previewPath(preview()))) closePreview()
    setState("selectedFiles", [])
  }

  const confirmRemoveFiles = () => {
    const count = state.selectedFiles.length

    if (!count) return

    void dialog.show(() => <RemoveFilesDialog count={count} onConfirm={removeSelectedFiles} />)
  }

  return {
    libraries,
    library,
    query: () => state.query,
    setQuery: (value: string) => setState("query", value),
    selectedFiles: () => state.selectedFiles,
    preview,
    previewPath: () => previewPath(preview()),
    previewText,
    previewMessage,
    previewFile,
    importing,
    job,
    importError: () => state.importError,
    dismissImportError: () => setState("importError", ""),
    visibleFiles,
    fileGroups,
    allVisibleSelected,
    openLibrary,
    closeLibrary,
    openNewLibrary,
    runImport,
    removeLibrary,
    openFile,
    closePreview,
    retryPreview,
    toggleFile,
    toggleVisible,
    markSelection() {
      const target = library()

      if (target) markPaths(target, state.selectedFiles)
    },
    unmarkSelection() {
      const target = library()

      if (target) unmarkPaths(target, state.selectedFiles)
    },
    markPaths,
    unmarkPaths,
    flagOf,
    flaggedIn,
    flaggedPaths,
    openFlag,
    skipCount,
    discardsOf,
    openDiscards,
    confirmRemovePaths,
    confirmRemoveFiles,
    confirmRemoveFlagged,
  }
}

export type Knowledge = ReturnType<typeof createKnowledge>
/** Only ignored kinds carry a reason label; duplicates explain the document they matched instead. */
function ignoredReasonKey(reason: KnowledgeDiscardReason) {
  if (reason === "unsupported") return "knowledge.discards.reason.unsupported" as const

  if (reason === "noise") return "knowledge.discards.reason.noise" as const

  if (reason === "tooLarge") return "knowledge.discards.reason.tooLarge" as const

  return "knowledge.discards.reason.empty" as const
}

function discardCountKey(group: DiscardGroup) {
  if (group === "duplicate") return "knowledge.import.duplicates" as const

  if (group === "similar") return "knowledge.import.similar" as const

  return "knowledge.import.ignored" as const
}

/** A skipped-file chip opens the detail list when the library kept one; older libraries only have counts. */
export function DiscardChip(props: { label: string; onOpen?: () => void }) {
  return (
    <Show when={props.onOpen} fallback={<span class="knowledge-chip">{props.label}</span>}>
      {(onOpen) => {
        const open = onOpen()

        return (
          <button type="button" class="knowledge-chip knowledge-chip-button" onClick={() => open()}>
            {props.label}
          </button>
        )
      }}
    </Show>
  )
}

/**
 * What one import left out, one list per reason. Duplicates name the library document they matched so the
 * user can tell a real copy from a re-export, and ignored files name the rule that dropped them.
 */
function DiscardsDialog(props: { discards: ReadonlyArray<KnowledgeDiscard>; initial: DiscardGroup }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore({ group: props.initial })

  const groups = () => DISCARD_GROUPS.filter((group) => props.discards.some((d) => discardGroup(d.reason) === group))
  const active = () => (groups().includes(state.group) ? state.group : groups()[0])
  const items = () => props.discards.filter((discard) => discardGroup(discard.reason) === active())
  const countOf = (group: DiscardGroup) => props.discards.filter((d) => discardGroup(d.reason) === group).length

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("knowledge.discards.title")}
          description={language.t("knowledge.discards.description")}
        />
      </DialogHeader>
      <DialogBody class="knowledge-discards">
        <div class="knowledge-discard-filters">
          <For each={groups()}>
            {(group) => (
              <button
                type="button"
                class="knowledge-chip knowledge-chip-button"
                data-selected={active() === group ? "" : undefined}
                onClick={() => setState("group", group)}
              >
                {language.plural(discardCountKey(group), countOf(group), { count: countOf(group) })}
              </button>
            )}
          </For>
        </div>
        <div class="knowledge-discard-list" data-scrollable>
          <For each={items()}>
            {(discard) => (
              <div class="knowledge-discard-item">
                <div class="min-w-0 flex-1">
                  <div dir="auto" class="truncate text-[13px] leading-[var(--line-height-compact)]">
                    {discard.name}
                  </div>
                  <div
                    dir="auto"
                    class="truncate text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint"
                    title={discard.path}
                  >
                    {discard.path}
                  </div>
                  <Show when={discard.matched}>
                    {(matched) => (
                      <div
                        dir="auto"
                        class="truncate text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted"
                        title={matched()}
                      >
                        {language.t(
                          discard.reason === "duplicate"
                            ? "knowledge.discards.duplicate"
                            : "knowledge.discards.similar",
                          { path: matched() },
                        )}
                      </div>
                    )}
                  </Show>
                </div>
                <Show when={discardGroup(discard.reason) === "ignored"}>
                  <span class="knowledge-chip">{language.t(ignoredReasonKey(discard.reason))}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" autofocus onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Asks before dropping library entries; the imported folder always keeps its files. */
function RemoveLibraryDialog(props: { name: string; onConfirm: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("knowledge.delete")}
          description={language.t("knowledge.delete.confirm", { name: props.name })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="neutral" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            dialog.close()
            props.onConfirm()
          }}
        >
          {language.t("knowledge.delete")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function RemoveFilesDialog(props: { count: number; flagged?: boolean; onConfirm: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t(props.flagged ? "knowledge.flags.removeAll.title" : "knowledge.files.delete")}
          description={language.plural(
            props.flagged ? "knowledge.flags.removeAll.confirm" : "knowledge.files.delete.confirm",
            props.count,
            { count: props.count },
          )}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="neutral" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            dialog.close()
            props.onConfirm()
          }}
        >
          {language.t("knowledge.files.delete")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** A document the import judged off-topic. Staying in the library is one click away. */
function FlaggedFileDialog(props: { name: string; reason: string; onKeep: () => void; onRemove: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("knowledge.flags.dialog.title")}
          description={language.t("knowledge.flags.dialog.description")}
        />
      </DialogHeader>
      <DialogBody class="flex w-full min-w-0 flex-col gap-2 px-4">
        <div dir="auto" class="truncate text-[13px] leading-[var(--line-height-compact)]">
          {props.name}
        </div>
        <p dir="auto" class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
          {props.reason || language.t("knowledge.flags.irrelevant")}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button
          variant="neutral"
          autofocus
          onClick={() => {
            dialog.close()
            props.onKeep()
          }}
        >
          {language.t("knowledge.flags.keep")}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            dialog.close()
            props.onRemove()
          }}
        >
          {language.t("knowledge.flags.remove")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

type ImportStage = "scan" | "convert" | "dedupe" | "summarize"

/** Shows the import pipeline: which step runs, the file being read and what has been kept so far. */
export function ImportPanel(props: { job: KnowledgeImportJob }) {
  const language = useLanguage()
  const stage = () => (props.job.stage === "done" ? "scan" : props.job.stage)
  const stageLabel = (id: ImportStage) => language.t(`knowledge.import.stage.${id}`)

  const share = () => {
    const total = props.job.total

    if (!total) return undefined

    return Math.min(1, props.job.processed / total)
  }

  return (
    <div class="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
      <div class="knowledge-progress-card">
        <div class="flex items-center gap-2">
          <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 flex-1 truncate text-[13px] leading-[var(--line-height-compact)] font-medium">
            {stageLabel(stage())}
          </span>
          <Show when={share() !== undefined}>
            {(value) => (
              <span class="shrink-0 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                {language.t("knowledge.import.progress", {
                  processed: props.job.processed,
                  total: props.job.total,
                })}
              </span>
            )}
          </Show>
        </div>

        <div class="knowledge-progress-track" data-indeterminate={share() === undefined ? "" : undefined}>
          <div
            class="knowledge-progress-fill"
            style={{ width: share() === undefined ? undefined : `${share()! * 100}%` }}
          />
        </div>

        <div class="flex h-5 min-w-0 items-center gap-2">
          <Show
            when={props.job.current}
            fallback={
              <span class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                {language.t("knowledge.import.stage.hint")}
              </span>
            }
          >
            {(name) => (
              <>
                <Icon name="file-document" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                <span dir="auto" class="min-w-0 flex-1 truncate text-[12px] leading-[var(--line-height-compact)]">
                  {name()}
                </span>
              </>
            )}
          </Show>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <span class="knowledge-chip">
            {language.plural("knowledge.import.added", props.job.kept, { count: props.job.kept })}
          </span>
          <Show when={props.job.duplicates}>
            {(count) => (
              <span class="knowledge-chip">
                {language.plural("knowledge.import.duplicates", count(), { count: count() })}
              </span>
            )}
          </Show>
          <Show when={props.job.similar}>
            {(count) => (
              <span class="knowledge-chip">
                {language.plural("knowledge.import.similar", count(), { count: count() })}
              </span>
            )}
          </Show>
          <Show when={props.job.skipped}>
            {(count) => (
              <span class="knowledge-chip">
                {language.plural("knowledge.import.ignored", count(), { count: count() })}
              </span>
            )}
          </Show>
        </div>

        <p class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
          {language.t("knowledge.import.hint")}
        </p>
      </div>
    </div>
  )
}
