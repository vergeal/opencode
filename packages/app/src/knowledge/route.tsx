import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { importKnowledgeDirectory } from "./import"
import { useKnowledgeLibraries, type KnowledgeFile, type KnowledgeLibrary } from "./store"
import { generateLibrarySummary } from "./summary"
import "./knowledge.css"

const TONE_COUNT = 6

const FILE_ICONS: Record<KnowledgeFile["kind"], string> = {
  document: "file-document",
  spreadsheet: "review",
  text: "outline-text",
}

export function KnowledgeScreen() {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const global = useGlobal()
  const libraries = useKnowledgeLibraries()
  const [state, setState] = createStore({
    selected: "",
    query: "",
    fileName: "",
    fileText: "",
    loadingFile: false,
    importing: false,
    creating: false,
    draftName: "",
  })

  const selected = createMemo(() => (state.selected ? libraries.get(state.selected) : undefined))

  const visibleFiles = createMemo(() => {
    const query = state.query.trim().toLocaleLowerCase()

    return [...(selected()?.files ?? [])]
      .filter((file) => !query || file.path.toLocaleLowerCase().includes(query))
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

  const createLibrary = () => {
    const name = state.draftName.trim()
    if (!name) return
    const id = libraries.create(name)
    setState({ draftName: "", creating: false, selected: id })
  }

  const startCreating = () => setState({ creating: true, draftName: "" })

  const removeLibrary = (library: KnowledgeLibrary) => {
    libraries.remove(library.id)
    setState({ selected: "", fileName: "", fileText: "" })
  }

  const importDirectory = async () => {
    const library = selected()
    if (!library || state.importing) return
    setState("importing", true)

    try {
      const imported = await importKnowledgeDirectory({ platform, title: language.t("knowledge.import.title") })
      if (!imported) return

      libraries.setImported(library.id, imported.root, imported.files)
      setState({ fileName: "", fileText: "" })

      const connection = servers.list[0]
      const summary = connection
        ? await generateLibrarySummary({
            api: global.ensureServerCtx(connection).sdk.api,
            name: library.name,
            files: imported.files,
          })
        : undefined

      libraries.setSummary(
        library.id,
        summary ??
          language.plural("knowledge.summary.fallback", imported.files.length, { count: imported.files.length }),
      )
    } finally {
      setState("importing", false)
    }
  }

  const openFile = async (library: KnowledgeLibrary, file: KnowledgeFile) => {
    setState({ fileName: file.path, loadingFile: true, fileText: "" })
    const result = await platform.readKnowledgeFile?.(library.root, file.path)
    setState({ fileText: result?.text ?? "", loadingFile: false })
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
          <button
            type="button"
            class="flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border border-v2-border-border-muted px-2.5 text-[13px] leading-[var(--line-height-compact)] hover:bg-v2-background-bg-layer-02"
            onClick={startCreating}
          >
            <Icon name="plus" size="small" />
            {language.t("knowledge.new")}
          </button>
        </header>
        <div class="knowledge-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4" data-scrollable>
          <Show
            when={libraries.libraries().length > 0 || state.creating}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Icon name="folder" class="text-v2-text-text-faint" />
                <p class="text-[15px] leading-[var(--line-height-base)]">{language.t("knowledge.empty")}</p>
                <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                  {language.t("knowledge.empty.hint")}
                </p>
                <button
                  type="button"
                  class="flex h-7 items-center gap-1.5 rounded-[6px] border border-v2-border-border-muted px-2.5 text-[13px] leading-[var(--line-height-compact)] hover:bg-v2-background-bg-layer-02"
                  onClick={startCreating}
                >
                  <Icon name="plus" size="small" />
                  {language.t("knowledge.new")}
                </button>
              </div>
            }
          >
            <div class="knowledge-grid">
              <For each={libraries.libraries()}>
                {(library, index) => (
                  <button
                    type="button"
                    class="knowledge-card"
                    data-tone={index() % TONE_COUNT}
                    onClick={() => setState({ selected: library.id, query: "", fileName: "", fileText: "" })}
                  >
                    <span class="knowledge-card-icon">
                      <Icon name="file-document" />
                    </span>
                    <span class="min-w-0 truncate text-[15px] leading-[var(--line-height-base)] font-medium">
                      {library.name}
                    </span>
                    <span class="line-clamp-2 min-h-8 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                      {library.summary || language.t("knowledge.summary.empty")}
                    </span>
                    <span class="mt-auto text-[12px] text-v2-text-text-faint">
                      {language.plural("knowledge.files", library.files.length, { count: library.files.length })}
                    </span>
                  </button>
                )}
              </For>
              <Show
                when={state.creating}
                fallback={
                  <button type="button" class="knowledge-card-add" onClick={startCreating}>
                    <Icon name="plus" />
                    <span class="text-[15px] leading-[var(--line-height-base)]">{language.t("knowledge.new")}</span>
                  </button>
                }
              >
                <form
                  class="knowledge-card-add flex-col items-stretch justify-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    createLibrary()
                  }}
                >
                  <TextInput
                    autofocus
                    value={state.draftName}
                    placeholder={language.t("knowledge.name.placeholder")}
                    aria-label={language.t("knowledge.name.placeholder")}
                    onInput={(event) => setState("draftName", event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setState({ creating: false, draftName: "" })
                    }}
                  />
                  <button
                    type="submit"
                    class="h-7 rounded-[6px] bg-v2-background-bg-layer-03 px-3 text-[13px] leading-[var(--line-height-compact)] font-medium disabled:opacity-50"
                    disabled={!state.draftName.trim()}
                  >
                    {language.t("knowledge.create")}
                  </button>
                </form>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    )
  }

  function LibraryDetail(props: { library: KnowledgeLibrary }) {
    return (
      <div class="flex min-h-0 flex-1 flex-col">
        <header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-v2-border-border-muted px-4 py-3">
          <button
            type="button"
            class="flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted hover:text-v2-text-text-base"
            onClick={() => setState({ selected: "", query: "", fileName: "", fileText: "" })}
          >
            <Icon name="outline-arrow-left" size="small" />
            {language.t("knowledge.back")}
          </button>
          <div class="mx-1 h-5 w-px bg-v2-border-border-muted" aria-hidden="true" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="min-w-0 truncate text-[15px] leading-[var(--line-height-base)] font-medium">
              {props.library.name}
            </span>
            <span class="min-w-0 truncate text-[12px] text-v2-text-text-faint">
              {props.library.root || language.t("knowledge.summary.empty")}
            </span>
          </div>
          <button
            type="button"
            class="flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border border-v2-border-border-muted px-2.5 text-[13px] leading-[var(--line-height-compact)] hover:bg-v2-background-bg-layer-02 disabled:opacity-50"
            disabled={state.importing || platform.platform !== "desktop"}
            onClick={() => void importDirectory()}
          >
            <Show when={state.importing} fallback={<Icon name="folder-add-left" size="small" />}>
              <Loader />
            </Show>
            {props.library.root ? language.t("knowledge.reimport") : language.t("knowledge.import")}
          </button>
          <button
            type="button"
            class="flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted hover:text-v2-text-text-base"
            aria-label={language.t("knowledge.delete")}
            onClick={() => removeLibrary(props.library)}
          >
            <Icon name="trash" size="small" />
          </button>
        </header>

        <div class="flex shrink-0 items-center gap-3 px-4 py-2 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
          <span class="min-w-0 flex-1 truncate">{props.library.summary || language.t("knowledge.summary.empty")}</span>
          <Show when={platform.platform !== "desktop"}>
            <span class="shrink-0 text-[12px] text-v2-text-text-faint">
              {language.t("knowledge.import.desktopOnly")}
            </span>
          </Show>
        </div>

        <div class="flex min-h-0 flex-1 border-t border-v2-border-border-muted">
          <aside class="flex w-72 shrink-0 flex-col border-e border-v2-border-border-muted">
            <div class="shrink-0 p-2">
              <TextInput
                type="search"
                value={state.query}
                placeholder={language.t("knowledge.files.search")}
                aria-label={language.t("knowledge.files.search")}
                onInput={(event) => setState("query", event.currentTarget.value)}
              />
            </div>
            <div class="knowledge-scroll min-h-0 flex-1 overflow-y-auto px-1 pb-2" data-scrollable>
              <Show
                when={visibleFiles().length > 0}
                fallback={
                  <p class="px-2 py-6 text-center text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
                    {props.library.files.length
                      ? language.t("knowledge.files.noResults")
                      : language.t("knowledge.files.empty")}
                  </p>
                }
              >
                <For each={fileGroups()}>
                  {([directory, files]) => (
                    <div class="mb-1">
                      <Show when={directory}>
                        <div class="truncate px-2 pt-1 pb-0.5 text-[11px] text-v2-text-text-faint" dir="auto">
                          {directory}
                        </div>
                      </Show>
                      <For each={files}>
                        {(file) => (
                          <button
                            type="button"
                            class="knowledge-file-row"
                            data-selected={state.fileName === file.path ? "" : undefined}
                            onClick={() => void openFile(props.library, file)}
                          >
                            <Icon name={FILE_ICONS[file.kind]} size="small" class="shrink-0" />
                            <span
                              dir="auto"
                              class="min-w-0 flex-1 truncate text-[13px] leading-[var(--line-height-compact)]"
                            >
                              {file.name}
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </aside>
          <section class="knowledge-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3" data-scrollable>
            <Show
              when={state.fileName}
              fallback={
                <div class="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                    {props.library.files.length
                      ? language.t("knowledge.preview.empty")
                      : language.t("knowledge.files.empty.hint")}
                  </p>
                </div>
              }
            >
              <div class="mb-2 flex items-center gap-2 text-[12px] text-v2-text-text-faint">
                <span dir="auto" class="min-w-0 truncate">
                  {state.fileName}
                </span>
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
        </div>
      </div>
    )
  }
}
