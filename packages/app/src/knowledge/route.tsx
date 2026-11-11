import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { ContextMenu } from "@opencode/ui/context-menu"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform, type KnowledgeDiscard, type KnowledgeDiscardReason } from "@/runtime/platform/platform"
import { useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { importKnowledge, pickKnowledgeSources } from "./import"
import { NewLibraryDialog } from "./new-library-dialog"
import { useKnowledgeLibraries, type KnowledgeFile, type KnowledgeFlag, type KnowledgeLibrary } from "./store"
import { reviewLibrary } from "./summary"
import "./knowledge.css"

const TONE_COUNT = 6

const LIST_WIDTH_MIN = 200

const LIST_WIDTH_MAX = 560

const FILE_ICONS: Record<KnowledgeFile["kind"], string> = {
  document: "file-document",
  spreadsheet: "review",
  text: "outline-text",
}

type ImportStage = "scan" | "convert" | "dedupe" | "summarize"

/** The three reasons a library explains in one list each. */
type DiscardGroup = "duplicate" | "similar" | "ignored"

const DISCARD_GROUPS: ReadonlyArray<DiscardGroup> = ["duplicate", "similar", "ignored"]

const EMPTY_PROGRESS = { current: "", processed: 0, total: 0, kept: 0, duplicates: 0, similar: 0, skipped: 0 }

/** Duplicates and near-duplicates are explained one by one; everything else shares one list. */
function discardGroup(reason: KnowledgeDiscardReason): DiscardGroup {
  if (reason === "duplicate" || reason === "similar") return reason

  return "ignored"
}

/** The source format a converted document came from, shown as a compact badge. */
function sourceExtension(file: KnowledgeFile) {
  const dot = file.source.lastIndexOf(".")

  return dot === -1 ? "" : file.source.slice(dot + 1).toUpperCase()
}

/** Converted documents are stored as Markdown, so their library name differs from the original. */
function isConverted(file: KnowledgeFile) {
  const name = file.name.toLowerCase()
  const source = file.source.toLowerCase()

  return name.endsWith(".md") && !source.endsWith(".md")
}

export function KnowledgeScreen() {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const global = useGlobal()
  const dialog = useDialog()
  const libraries = useKnowledgeLibraries()
  const [state, setState] = createStore({
    selected: "",
    query: "",
    fileName: "",
    fileText: "",
    loadingFile: false,
    /** Which import step is running; empty when nothing is importing. */
    importStage: "" as "" | ImportStage,
    progress: { ...EMPTY_PROGRESS },
    importError: "",
    selectedFiles: [] as string[],
    listWidth: 280,
  })

  const importing = () => state.importStage !== ""

  const selected = createMemo(() => (state.selected ? libraries.get(state.selected) : undefined))

  const visibleFiles = createMemo(() => {
    const query = state.query.trim().toLocaleLowerCase()

    return [...(selected()?.files ?? [])]
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

  const previewFile = createMemo(() => selected()?.files.find((file) => file.path === state.fileName))

  const allVisibleSelected = createMemo(() => {
    const files = visibleFiles()

    return files.length > 0 && files.every((file) => state.selectedFiles.includes(file.path))
  })

  // Progress arrives while the import promise is still pending, so it cannot be read from its result.
  onMount(() => {
    const stop = platform.onKnowledgeImportProgress?.((progress) => {
      if (progress.libraryID !== state.selected || progress.stage === "done") return

      setState({
        importStage: progress.stage,
        progress: {
          current: progress.current,
          processed: progress.processed,
          total: progress.total,
          kept: progress.kept,
          duplicates: progress.duplicates,
          similar: progress.similar,
          skipped: progress.skipped,
        },
      })
    })

    onCleanup(() => stop?.())
  })

  const openNewLibrary = () =>
    void dialog.show(() => (
      <NewLibraryDialog
        onCreate={(name, description) => {
          const id = libraries.create(name, description)
          setState({ selected: id, query: "", fileName: "", fileText: "", selectedFiles: [] })
        }}
      />
    ))

  /** Libraries imported before the detail list existed only have counts, so their chips stay read-only. */
  const discardsOf = (library: KnowledgeLibrary, group: DiscardGroup) =>
    (library.discards ?? []).filter((discard) => discardGroup(discard.reason) === group)

  /** The chip counts what the detail list can show, so the number and the list always agree. */
  const skipCount = (library: KnowledgeLibrary, group: DiscardGroup) => {
    if (library.discards?.length) return discardsOf(library, group).length
    if (group === "duplicate") return library.stats?.duplicates ?? 0
    if (group === "similar") return library.stats?.similar ?? 0

    return library.stats?.skipped ?? 0
  }

  const flagOf = (library: KnowledgeLibrary, path: string) => (library.flags ?? []).find((flag) => flag.path === path)

  const openDiscards = (library: KnowledgeLibrary, group: DiscardGroup) => {
    const discards = library.discards ?? []
    if (!discards.some((discard) => discardGroup(discard.reason) === group)) return

    void dialog.show(() => <DiscardsDialog discards={discards} initial={group} />)
  }

  /** Library content lives in desktop storage; dropping it must never touch the imported folder. */
  const forgetFiles = (library: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    const remove = platform.deleteKnowledgeFiles
    if (platform.platform !== "desktop" || !remove) return
    void remove(library.id, [...paths]).catch(() => undefined)
  }

  /** The user decides: a flagged document stays unless they remove it, and the flag can be cleared. */
  const openFlag = (library: KnowledgeLibrary, file: KnowledgeFile, flag: KnowledgeFlag) =>
    void dialog.show(() => (
      <FlaggedFileDialog
        name={file.name}
        reason={flag.reason}
        onKeep={() => libraries.clearFlag(library.id, file.path)}
        onRemove={() => {
          forgetFiles(library, [file.path])
          libraries.removeFiles(library.id, [file.path])
          if (state.fileName === file.path) setState({ fileName: "", fileText: "" })
        }}
      />
    ))

  /** Documents an import judged off-topic stay in the library until someone removes them. */
  const flaggedPaths = (library: KnowledgeLibrary) => (library.flags ?? []).map((flag) => flag.path)

  const flaggedIn = (library: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    const flagged = new Set(flaggedPaths(library))

    return paths.filter((path) => flagged.has(path))
  }

  /** Marking by hand leaves the reason empty, so the row keeps the generic label. */
  const markPaths = (library: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    if (!paths.length) return

    libraries.setFlags(
      library.id,
      paths.map((path) => ({ path, reason: "" })),
    )
  }

  const unmarkPaths = (library: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    if (!paths.length) return

    libraries.clearFlags(library.id, paths)
  }

  const removePaths = (library: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    if (!paths.length) return

    forgetFiles(library, paths)
    libraries.removeFiles(library.id, paths)
    setState({
      selectedFiles: state.selectedFiles.filter((path) => !paths.includes(path)),
      fileName: paths.includes(state.fileName) ? "" : state.fileName,
      fileText: paths.includes(state.fileName) ? "" : state.fileText,
    })
  }

  const confirmRemovePaths = (library: KnowledgeLibrary, paths: ReadonlyArray<string>) => {
    if (!paths.length) return

    void dialog.show(() => <RemoveFilesDialog count={paths.length} onConfirm={() => removePaths(library, paths)} />)
  }

  /** One action for everything the library marked, instead of deleting them one by one. */
  const confirmRemoveFlagged = (library: KnowledgeLibrary) => {
    const paths = flaggedPaths(library)
    if (!paths.length) return

    void dialog.show(() => (
      <RemoveFilesDialog count={paths.length} flagged onConfirm={() => removePaths(library, paths)} />
    ))
  }

  const removeLibrary = (library: KnowledgeLibrary) => {
    forgetFiles(
      library,
      library.files.map((file) => file.path),
    )
    libraries.remove(library.id)
    setState({ selected: "", fileName: "", fileText: "", selectedFiles: [] })
  }

  /** One entry point: the picker accepts folders and files together, several at a time. */
  const runImport = async () => {
    const library = selected()
    if (!library || importing()) return
    const paths = await pickKnowledgeSources(platform)
    if (!paths.length) return

    setState({ importStage: "scan", importError: "", progress: { ...EMPTY_PROGRESS } })

    try {
      const imported = await importKnowledge({ platform, libraryID: library.id, paths })
      if (!imported) return

      libraries.addImported(library.id, {
        files: imported.files,
        sources: paths,
        stats: imported.stats,
        discards: imported.discards,
      })
      setState({ fileName: "", fileText: "", selectedFiles: [], importStage: "summarize" })

      // Re-importing a folder adds nothing, and an empty excerpt set cannot describe the library.
      // Keep the summary that already explains it.
      if (imported.files.length > 0 || !library.summary) {
        const connection = servers.list[0]
        // One small call covers both: the description of the library and the documents that do not
        // fit the description the user wrote when creating it.
        const review = connection
          ? await reviewLibrary({
              api: global.ensureServerCtx(connection).sdk.api,
              name: library.name,
              description: library.description ?? "",
              excerpts: imported.excerpts,
            })
          : undefined
        const total = library.files.length + imported.files.length

        libraries.setSummary(
          library.id,
          review?.summary ?? language.plural("knowledge.summary.fallback", total, { count: total }),
        )
        if (review?.irrelevant.length) libraries.setFlags(library.id, review.irrelevant)
      }
    } catch (error) {
      setState("importError", error instanceof Error ? error.message : String(error))
    } finally {
      setState({ importStage: "", progress: { ...EMPTY_PROGRESS } })
    }
  }

  const openFile = async (library: KnowledgeLibrary, file: KnowledgeFile) => {
    setState({ fileName: file.path, loadingFile: true, fileText: "" })
    const result = await platform.readKnowledgeFile?.({ libraryID: library.id, path: file.path })
    setState({ fileText: result?.text ?? "", loadingFile: false })
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

  const removeSelectedFiles = (library: KnowledgeLibrary) => {
    const paths = [...state.selectedFiles]
    if (!paths.length) return

    forgetFiles(library, paths)
    libraries.removeFiles(library.id, paths)
    setState({
      selectedFiles: [],
      fileName: paths.includes(state.fileName) ? "" : state.fileName,
      fileText: paths.includes(state.fileName) ? "" : state.fileText,
    })
  }

  const confirmRemoveFiles = (library: KnowledgeLibrary) => {
    const count = state.selectedFiles.length
    if (!count) return

    void dialog.show(() => <RemoveFilesDialog count={count} onConfirm={() => removeSelectedFiles(library)} />)
  }

  return (
    <div
      data-slot="knowledge-panel"
      class="mx-[var(--shell-inline-inset,8px)] mb-[var(--shell-bottom-inset,8px)] mt-[var(--shell-top-inset,8px)] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
    >
      <Show when={selected()} fallback={<LibraryGrid />}>
        {(library) => <LibraryDetail library={library()} />}
      </Show>
    </div>
  )

  function LibraryGrid() {
    return (
      <div class="flex min-h-0 flex-1 flex-col">
        <header class="flex shrink-0 items-center gap-3 border-b border-v2-border-border-muted px-5 py-4">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <h1 class="text-[17px] leading-[var(--line-height-base)] font-medium">{language.t("knowledge.title")}</h1>
            <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
              {language.t("knowledge.description")}
            </p>
          </div>
          <button type="button" class="knowledge-toolbar-button" onClick={openNewLibrary}>
            <Icon name="plus" size="small" />
            {language.t("knowledge.new")}
          </button>
        </header>
        <div class="knowledge-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4" data-scrollable>
          <Show
            when={libraries.libraries().length > 0}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Icon name="folder" class="text-v2-text-text-faint" />
                <p class="text-[15px] leading-[var(--line-height-base)]">{language.t("knowledge.empty")}</p>
                <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                  {language.t("knowledge.empty.hint")}
                </p>
                <button type="button" class="knowledge-toolbar-button" onClick={openNewLibrary}>
                  <Icon name="plus" size="small" />
                  {language.t("knowledge.new")}
                </button>
              </div>
            }
          >
            <div class="knowledge-grid">
              <For each={libraries.libraries()}>
                {(library, index) => (
                  <ContextMenu>
                    <ContextMenu.Trigger class="flex min-w-0">
                      <button
                        type="button"
                        class="knowledge-card flex-1"
                        data-tone={index() % TONE_COUNT}
                        onClick={() =>
                          setState({ selected: library.id, query: "", fileName: "", fileText: "", selectedFiles: [] })
                        }
                      >
                        <span class="flex min-w-0 items-center gap-2">
                          <span class="knowledge-card-icon">
                            <Icon name="file-document" size="small" />
                          </span>
                          <span class="min-w-0 truncate text-[15px] leading-[var(--line-height-base)]">
                            {library.name}
                          </span>
                        </span>
                        <span class="line-clamp-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                          {library.summary || library.description || language.t("knowledge.summary.empty")}
                        </span>
                        <span class="mt-auto text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                          {language.plural("knowledge.files", library.files.length, { count: library.files.length })}
                        </span>
                      </button>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Content>
                        <ContextMenu.Item
                          onSelect={() =>
                            setState({
                              selected: library.id,
                              query: "",
                              fileName: "",
                              fileText: "",
                              selectedFiles: [],
                            })
                          }
                        >
                          <ContextMenu.ItemLabel>{language.t("knowledge.files.menu.open")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                        <ContextMenu.Item onSelect={() => removeLibrary(library)}>
                          <ContextMenu.ItemLabel>{language.t("knowledge.delete")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu>
                )}
              </For>
              <button type="button" class="knowledge-card-add" onClick={openNewLibrary}>
                <Icon name="plus" />
                <span class="text-[15px] leading-[var(--line-height-base)]">{language.t("knowledge.new")}</span>
              </button>
            </div>
          </Show>
        </div>
      </div>
    )
  }

  function LibraryDetail(props: { library: KnowledgeLibrary }) {
    const intro = () => props.library.summary || props.library.description || language.t("knowledge.summary.empty")

    return (
      <div class="flex min-h-0 flex-1 flex-col">
        <header class="shrink-0 border-b border-v2-border-border-muted px-4 py-3">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="knowledge-ghost-button"
              onClick={() => setState({ selected: "", query: "", fileName: "", fileText: "", selectedFiles: [] })}
            >
              <Icon name="outline-arrow-left" size="small" />
              {language.t("knowledge.back")}
            </button>
            <div class="ms-auto flex items-center gap-2">
              <button
                type="button"
                class="knowledge-toolbar-button"
                disabled={importing() || platform.platform !== "desktop"}
                onClick={() => void runImport()}
              >
                <Show when={importing()} fallback={<Icon name="folder-add-left" size="small" />}>
                  <Loader class="size-3.5" />
                </Show>
                {language.t("knowledge.import")}
              </button>
              <Show when={!importing() && flaggedPaths(props.library).length}>
                {(count) => (
                  <button
                    type="button"
                    class="knowledge-ghost-button knowledge-flag-action"
                    onClick={() => confirmRemoveFlagged(props.library)}
                  >
                    <Icon name="outline-hexagonal-warning" size="small" />
                    {language.plural("knowledge.flags.removeAll", count(), { count: count() })}
                  </button>
                )}
              </Show>
              <button
                type="button"
                class="knowledge-ghost-button"
                aria-label={language.t("knowledge.delete")}
                onClick={() => removeLibrary(props.library)}
              >
                <Icon name="trash" size="small" />
              </button>
            </div>
          </div>
          <div class="mt-2 min-w-0">
            <h1 class="min-w-0 truncate text-[17px] leading-[var(--line-height-base)] font-medium">
              {props.library.name}
            </h1>
            <p
              dir="auto"
              class="mt-1 line-clamp-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted"
              title={intro()}
            >
              {intro()}
            </p>
            <p
              class="mt-1.5 min-w-0 truncate text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint"
              dir="auto"
              title={props.library.sources.join("\n")}
            >
              {sourceLabel(props.library, language)}
            </p>
          </div>
        </header>

        <Show
          when={
            !importing() &&
            (skipCount(props.library, "duplicate") ||
              skipCount(props.library, "similar") ||
              skipCount(props.library, "ignored") ||
              platform.platform !== "desktop")
          }
        >
          <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
            <Show when={skipCount(props.library, "duplicate")}>
              {(count) => (
                <DiscardChip
                  label={language.plural("knowledge.import.duplicates", count(), { count: count() })}
                  onOpen={
                    discardsOf(props.library, "duplicate").length
                      ? () => openDiscards(props.library, "duplicate")
                      : undefined
                  }
                />
              )}
            </Show>
            <Show when={skipCount(props.library, "similar")}>
              {(count) => (
                <DiscardChip
                  label={language.plural("knowledge.import.similar", count(), { count: count() })}
                  onOpen={
                    discardsOf(props.library, "similar").length
                      ? () => openDiscards(props.library, "similar")
                      : undefined
                  }
                />
              )}
            </Show>
            <Show when={skipCount(props.library, "ignored")}>
              {(count) => (
                <DiscardChip
                  label={language.plural("knowledge.import.ignored", count(), { count: count() })}
                  onOpen={
                    discardsOf(props.library, "ignored").length
                      ? () => openDiscards(props.library, "ignored")
                      : undefined
                  }
                />
              )}
            </Show>
            <Show when={platform.platform !== "desktop"}>
              <span class="knowledge-chip">{language.t("knowledge.import.desktopOnly")}</span>
            </Show>
          </div>
        </Show>

        <Show when={state.importError}>
          {(message) => (
            <div class="knowledge-error" role="alert">
              <Icon name="circle-xmark" size="small" class="shrink-0" />
              <span class="min-w-0 flex-1 break-words">
                {language.t("knowledge.import.failed", { message: message() })}
              </span>
              <button
                type="button"
                class="knowledge-ghost-button"
                onClick={() => setState("importError", "")}
                aria-label={language.t("common.dismiss")}
              >
                <Icon name="xmark" size="small" />
              </button>
            </div>
          )}
        </Show>

        <div class="flex min-h-0 flex-1">
          <Show
            when={importing()}
            fallback={
              <>
                <aside
                  class="relative flex shrink-0 flex-col border-e border-v2-border-border-muted"
                  style={{ width: `${state.listWidth}px` }}
                >
                  <div class="shrink-0 p-2">
                    <TextInput
                      type="search"
                      class="knowledge-file-search"
                      value={state.query}
                      placeholder={language.t("knowledge.files.search")}
                      aria-label={language.t("knowledge.files.search")}
                      onInput={(event) => setState("query", event.currentTarget.value)}
                    />
                  </div>
                  <Show when={props.library.files.length > 0}>
                    <div class="flex h-7 shrink-0 items-center gap-2 px-2 pb-1">
                      <div class="knowledge-select-all">
                        <Checkbox checked={allVisibleSelected()} onChange={(checked) => toggleVisible(checked)}>
                          <span class="truncate text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                            {language.t("knowledge.files.select")}
                          </span>
                        </Checkbox>
                      </div>
                      <Show when={state.selectedFiles.length > 0}>
                        <span class="min-w-0 flex-1 truncate text-end text-[12px] text-v2-text-text-faint">
                          {language.plural("knowledge.files.selected", state.selectedFiles.length, {
                            count: state.selectedFiles.length,
                          })}
                        </span>
                        <Show when={state.selectedFiles.some((path) => !flagOf(props.library, path))}>
                          <button
                            type="button"
                            class="knowledge-icon-button"
                            title={language.t("knowledge.flags.mark")}
                            aria-label={language.t("knowledge.flags.mark")}
                            onClick={() => markPaths(props.library, state.selectedFiles)}
                          >
                            <Icon name="outline-hexagonal-warning" size="small" />
                          </button>
                        </Show>
                        <Show when={flaggedIn(props.library, state.selectedFiles).length > 0}>
                          <button
                            type="button"
                            class="knowledge-icon-button"
                            title={language.t("knowledge.flags.unmark")}
                            aria-label={language.t("knowledge.flags.unmark")}
                            onClick={() => unmarkPaths(props.library, state.selectedFiles)}
                          >
                            <Icon name="outline-xmark" size="small" />
                          </button>
                        </Show>
                        <button
                          type="button"
                          class="knowledge-icon-button"
                          title={language.t("knowledge.files.delete")}
                          aria-label={language.t("knowledge.files.delete")}
                          onClick={() => confirmRemoveFiles(props.library)}
                        >
                          <Icon name="trash" size="small" />
                        </button>
                      </Show>
                    </div>
                  </Show>
                  <div class="knowledge-scroll min-h-0 flex-1 overflow-y-auto px-1 pb-2" data-scrollable>
                    <Show
                      when={visibleFiles().length > 0}
                      fallback={
                        <div class="flex flex-col items-center gap-2 px-3 py-8 text-center">
                          <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                            {props.library.files.length
                              ? language.t("knowledge.files.noResults")
                              : language.t("knowledge.files.empty")}
                          </p>
                          <Show when={!props.library.files.length}>
                            <p class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                              {language.t("knowledge.files.empty.hint")}
                            </p>
                          </Show>
                        </div>
                      }
                    >
                      <For each={fileGroups()}>
                        {([directory, files]) => (
                          <div class="mb-1">
                            <Show when={directory}>
                              <div class="truncate px-2 pt-1 pb-0.5 text-[11px] text-v2-text-text-faint" dir="auto">
                                {groupLabel(directory)}
                              </div>
                            </Show>
                            <For each={files}>
                              {(file) => (
                                <ContextMenu>
                                  <ContextMenu.Trigger class="block min-w-0">
                                    <div
                                      class="knowledge-file-item"
                                      data-selected={state.fileName === file.path ? "" : undefined}
                                    >
                                      <Checkbox
                                        hideLabel
                                        checked={state.selectedFiles.includes(file.path)}
                                        onChange={(checked) => toggleFile(file.path, checked)}
                                      >
                                        {file.name}
                                      </Checkbox>
                                      <button
                                        type="button"
                                        class="knowledge-file-row"
                                        title={file.source || file.path}
                                        onClick={() => void openFile(props.library, file)}
                                      >
                                        <Icon name={FILE_ICONS[file.kind]} size="small" class="shrink-0" />
                                        <span
                                          dir="auto"
                                          class="min-w-0 flex-1 truncate text-[13px] leading-[var(--line-height-compact)]"
                                        >
                                          {file.name}
                                        </span>
                                        <Show when={isConverted(file)}>
                                          <span class="knowledge-ext-badge">{sourceExtension(file)}</span>
                                        </Show>
                                      </button>
                                      <Show when={flagOf(props.library, file.path)}>
                                        {(flag) => (
                                          <button
                                            type="button"
                                            class="knowledge-flag"
                                            title={flag().reason || language.t("knowledge.flags.irrelevant")}
                                            onClick={() => openFlag(props.library, file, flag())}
                                          >
                                            {language.t("knowledge.flags.irrelevant")}
                                          </button>
                                        )}
                                      </Show>
                                    </div>
                                  </ContextMenu.Trigger>
                                  <ContextMenu.Portal>
                                    <ContextMenu.Content>
                                      <ContextMenu.Item onSelect={() => void openFile(props.library, file)}>
                                        <ContextMenu.ItemLabel>
                                          {language.t("knowledge.files.menu.open")}
                                        </ContextMenu.ItemLabel>
                                      </ContextMenu.Item>
                                      <Show
                                        when={flagOf(props.library, file.path)}
                                        fallback={
                                          <ContextMenu.Item onSelect={() => markPaths(props.library, [file.path])}>
                                            <ContextMenu.ItemLabel>
                                              {language.t("knowledge.flags.mark")}
                                            </ContextMenu.ItemLabel>
                                          </ContextMenu.Item>
                                        }
                                      >
                                        <ContextMenu.Item onSelect={() => unmarkPaths(props.library, [file.path])}>
                                          <ContextMenu.ItemLabel>
                                            {language.t("knowledge.flags.unmark")}
                                          </ContextMenu.ItemLabel>
                                        </ContextMenu.Item>
                                      </Show>
                                      <ContextMenu.Separator />
                                      <ContextMenu.Item onSelect={() => confirmRemovePaths(props.library, [file.path])}>
                                        <ContextMenu.ItemLabel>
                                          {language.t("knowledge.files.menu.remove")}
                                        </ContextMenu.ItemLabel>
                                      </ContextMenu.Item>
                                    </ContextMenu.Content>
                                  </ContextMenu.Portal>
                                </ContextMenu>
                              )}
                            </For>
                          </div>
                        )}
                      </For>
                    </Show>
                  </div>
                  <ResizeHandle
                    direction="horizontal"
                    edge="end"
                    size={state.listWidth}
                    min={LIST_WIDTH_MIN}
                    max={LIST_WIDTH_MAX}
                    onResize={(width) => setState("listWidth", width)}
                  />
                </aside>
                <section class="knowledge-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3" data-scrollable>
                  <Show
                    when={state.fileName}
                    fallback={
                      <div class="flex h-full flex-col items-center justify-center gap-2 text-center">
                        <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                          {language.t("knowledge.preview.empty")}
                        </p>
                      </div>
                    }
                  >
                    <div class="mb-2 flex items-center gap-2 text-[12px] text-v2-text-text-faint">
                      <span dir="auto" class="min-w-0 truncate">
                        {state.fileName}
                      </span>
                      <Show when={previewFile() && isConverted(previewFile()!)}>
                        <span class="knowledge-ext-badge">{language.t("knowledge.preview.converted")}</span>
                      </Show>
                    </div>
                    <Show
                      when={!state.loadingFile}
                      fallback={
                        <div class="flex justify-center py-8">
                          <Loader />
                        </div>
                      }
                    >
                      <pre class="knowledge-file-preview font-mono text-[13px] leading-[var(--line-height-base)]">
                        {state.fileText || language.t("knowledge.preview.unreadable")}
                      </pre>
                    </Show>
                  </Show>
                </section>
              </>
            }
          >
            <ImportPanel stage={state.importStage} progress={state.progress} />
          </Show>
        </div>
      </div>
    )
  }
}

/**
 * The header second line. A long list of absolute paths would be unreadable, so the folders and files
 * are shortened to their own names and the whole set is available as the tooltip.
 */
function sourceLabel(library: KnowledgeLibrary, language: ReturnType<typeof useLanguage>) {
  if (!library.sources.length) {
    return language.plural("knowledge.files", library.files.length, { count: library.files.length })
  }

  const names = library.sources.map((source) => source.split(/[\\/]/).filter(Boolean).pop() ?? source)
  const shown = names.slice(0, 2).join(" · ")

  return names.length > 2
    ? `${shown} · ${language.plural("knowledge.sources", names.length, { count: names.length })}`
    : shown
}

/** The last folder in a library path: the imported root already names the library. */
function groupLabel(directory: string) {
  return directory.split("/").filter(Boolean).pop() ?? directory
}

/** Shows the import pipeline: which step runs, the file being read and what has been kept so far. */
function ImportPanel(props: {
  stage: "" | ImportStage
  progress: {
    current: string
    processed: number
    total: number
    kept: number
    duplicates: number
    similar: number
    skipped: number
  }
}) {
  const language = useLanguage()
  const stage = () => (props.stage === "" ? "scan" : props.stage)
  const stageLabel = (id: ImportStage) => language.t(`knowledge.import.stage.${id}`)
  const share = () => {
    const total = props.progress.total
    if (!total) return undefined

    return Math.min(1, props.progress.processed / total)
  }

  return (
    <div class="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
      <div class="knowledge-progress-card">
        <div class="flex items-center gap-2">
          <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 flex-1 truncate text-[13px] leading-[var(--line-height-compact)]">
            {stageLabel(stage())}
          </span>
          <Show when={share() !== undefined}>
            {(value) => (
              <span class="shrink-0 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                {language.t("knowledge.import.progress", {
                  processed: props.progress.processed,
                  total: props.progress.total,
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
            when={props.progress.current}
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
            {language.plural("knowledge.import.added", props.progress.kept, { count: props.progress.kept })}
          </span>
          <Show when={props.progress.duplicates}>
            {(count) => (
              <span class="knowledge-chip">
                {language.plural("knowledge.import.duplicates", count(), { count: count() })}
              </span>
            )}
          </Show>
          <Show when={props.progress.similar}>
            {(count) => (
              <span class="knowledge-chip">
                {language.plural("knowledge.import.similar", count(), { count: count() })}
              </span>
            )}
          </Show>
          <Show when={props.progress.skipped}>
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
function DiscardChip(props: { label: string; onOpen?: () => void }) {
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
        <Button variant="ghost" autofocus onClick={() => dialog.close()}>
          {language.t("common.close")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Asks before dropping library entries; the imported folder always keeps its files. */
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
        <Button variant="ghost" autofocus onClick={() => dialog.close()}>
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
          variant="ghost"
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
