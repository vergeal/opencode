import { Button } from "@opencode/ui/button"
import { ContextMenu } from "@opencode/ui/context-menu"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider } from "@opencode/session-ui/context/markdown"
import { For, Show, createMemo } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useKnowledge } from "./context"
import { DiscardChip, ImportPanel } from "./model"
import { isMarkdown } from "./display"
import type { KnowledgeLibrary } from "./store"
import "./knowledge.css"

const TONE_COUNT = 6

/**
 * The knowledge workspace: the navigation column owns the library and file lists, so this surface is the library
 * overview or the open document.
 */
export function KnowledgeScreen() {
  const language = useLanguage()
  const platform = usePlatform()
  const knowledge = useKnowledge()

  return (
    <div data-slot="knowledge-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden bg-v2-background-bg-base">
      <Show when={knowledge.library()} fallback={<LibraryGrid />}>
        {(library) => <Surface library={library()} />}
      </Show>
    </div>
  )

  function Surface(props: { library: KnowledgeLibrary }) {
    const intro = () => props.library.summary || props.library.description || language.t("knowledge.summary.empty")

    return (
      <div data-ui="workspace-content" class="flex min-h-0 flex-1 flex-col">
        <header class="shrink-0 border-b border-v2-border-border-muted px-6 py-4">
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <h1 class="min-w-0 truncate text-[19px] leading-6 font-semibold">{props.library.name}</h1>
              <p
                dir="auto"
                class="mt-1 line-clamp-2 text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted"
                title={intro()}
              >
                {intro()}
              </p>
              <p
                class="mt-1 min-w-0 truncate text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint"
                dir="auto"
                title={props.library.sources.join("\n")}
              >
                {sourceLabel(props.library, language)}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                size="small"
                variant="contrast"
                disabled={knowledge.importing() || platform.platform !== "desktop"}
                onClick={() => void knowledge.runImport()}
              >
                <Show when={knowledge.importing()} fallback={<Icon name="folder-add-left" size="small" />}>
                  <Loader class="size-3.5" />
                </Show>
                {language.t("knowledge.import")}
              </Button>
              <Show when={!knowledge.importing() && knowledge.flaggedPaths(props.library).length}>
                {(count) => (
                  <button
                    type="button"
                    class="knowledge-ghost-button knowledge-flag-action"
                    onClick={() => knowledge.confirmRemoveFlagged(props.library)}
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
                onClick={() => knowledge.removeLibrary(props.library)}
              >
                <Icon name="trash" size="small" />
              </button>
            </div>
          </div>

          <Show
            when={
              !knowledge.importing() &&
              (knowledge.skipCount(props.library, "duplicate") ||
                knowledge.skipCount(props.library, "similar") ||
                knowledge.skipCount(props.library, "ignored") ||
                platform.platform !== "desktop")
            }
          >
            <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
              <Show when={knowledge.skipCount(props.library, "duplicate")}>
                {(count) => (
                  <DiscardChip
                    label={language.plural("knowledge.import.duplicates", count(), { count: count() })}
                    onOpen={
                      knowledge.discardsOf(props.library, "duplicate").length
                        ? () => knowledge.openDiscards(props.library, "duplicate")
                        : undefined
                    }
                  />
                )}
              </Show>
              <Show when={knowledge.skipCount(props.library, "similar")}>
                {(count) => (
                  <DiscardChip
                    label={language.plural("knowledge.import.similar", count(), { count: count() })}
                    onOpen={
                      knowledge.discardsOf(props.library, "similar").length
                        ? () => knowledge.openDiscards(props.library, "similar")
                        : undefined
                    }
                  />
                )}
              </Show>
              <Show when={knowledge.skipCount(props.library, "ignored")}>
                {(count) => (
                  <DiscardChip
                    label={language.plural("knowledge.import.ignored", count(), { count: count() })}
                    onOpen={
                      knowledge.discardsOf(props.library, "ignored").length
                        ? () => knowledge.openDiscards(props.library, "ignored")
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
        </header>

        <Show when={knowledge.importError()}>
          {(message) => (
            <div class="knowledge-error mx-6 mt-3" role="alert">
              <Icon name="circle-xmark" size="small" class="shrink-0" />
              <span class="min-w-0 flex-1 break-words">
                {language.t("knowledge.import.failed", { message: message() })}
              </span>
              <button
                type="button"
                class="knowledge-ghost-button"
                onClick={knowledge.dismissImportError}
                aria-label={language.t("common.dismiss")}
              >
                <Icon name="xmark" size="small" />
              </button>
            </div>
          )}
        </Show>

        <Show
          when={knowledge.job()}
          fallback={
            <section
              class="knowledge-scroll knowledge-preview min-h-0 flex-1 overflow-y-auto"
              data-scrollable
              aria-label={language.t("knowledge.preview.empty")}
            >
              <Show
                when={knowledge.previewPath()}
                fallback={
                  <div class="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <span class="flex size-9 items-center justify-center rounded-[9px] bg-[var(--color-hover)] text-v2-text-text-faint">
                      <Icon name="file-document" />
                    </span>
                    <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                      {language.t("knowledge.preview.empty")}
                    </p>
                  </div>
                }
              >
                <Show
                  when={knowledge.preview().status !== "loading"}
                  fallback={
                    <div class="flex justify-center py-8">
                      <Loader />
                    </div>
                  }
                >
                  <Show
                    when={knowledge.preview().status === "failed"}
                    fallback={
                      <Show
                        when={isMarkdown(knowledge.previewPath())}
                        fallback={
                          <pre class="knowledge-file-preview font-mono text-[13px] leading-[var(--line-height-base)]">
                            {knowledge.previewText() || language.t("knowledge.preview.unreadable")}
                          </pre>
                        }
                      >
                        <KnowledgeDocument text={knowledge.previewText()} cacheKey={knowledge.previewPath()} />
                      </Show>
                    }
                  >
                    <div class="knowledge-preview-error" role="alert">
                      <span class="knowledge-preview-error-message">
                        {language.t("knowledge.preview.failed", { message: knowledge.previewMessage() })}
                      </span>
                      <Button size="small" variant="neutral" onClick={knowledge.retryPreview}>
                        {language.t("knowledge.preview.retry")}
                      </Button>
                    </div>
                  </Show>
                </Show>
              </Show>
            </section>
          }
        >
          {(job) => <ImportPanel job={job()} />}
        </Show>
      </div>
    )
  }

  function LibraryGrid() {
    const libraries = createMemo(() => knowledge.libraries.libraries())

    return (
      <div data-ui="workspace-content" class="flex min-h-0 flex-1 flex-col">
        <header class="shrink-0 px-6 pt-5 pb-3">
          <div class="flex items-start gap-4">
            <div class="min-w-0 flex-1">
              <h1 class="text-[19px] leading-6 font-semibold">{language.t("knowledge.title")}</h1>
              <p class="mt-1 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                {language.t("knowledge.description")}
              </p>
            </div>
            <Button variant="contrast" size="small" icon="plus" onClick={knowledge.openNewLibrary}>
              {language.t("knowledge.new")}
            </Button>
          </div>
        </header>
        <div class="knowledge-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6" data-scrollable>
          <Show
            when={libraries().length > 0}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Icon name="folder" class="text-v2-text-text-faint" />
                <p class="text-[13px] leading-[var(--line-height-base)]">{language.t("knowledge.empty")}</p>
                <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                  {language.t("knowledge.empty.hint")}
                </p>
                <Button variant="neutral" size="small" icon="plus" onClick={knowledge.openNewLibrary}>
                  {language.t("knowledge.new")}
                </Button>
              </div>
            }
          >
            <div
              class="knowledge-grid"
              onKeyDown={(event) => {
                const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]

                if (!keys.includes(event.key)) return

                const cards = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button.knowledge-card")]
                const index = cards.findIndex((card) => card === document.activeElement)

                if (index === -1) return
                event.preventDefault()

                const last = cards.length - 1
                const go = (to: number) => cards[Math.min(Math.max(to, 0), last)]?.focus()

                if (event.key === "Home") return go(0)

                if (event.key === "End") return go(last)

                // auto-fill 的列数来自计算后的轨道数，垂直移动一次跨一行。
                const horizontal = event.key === "ArrowRight" || event.key === "ArrowLeft"
                const columns = getComputedStyle(event.currentTarget)
                  .gridTemplateColumns.split(" ")
                  .filter(Boolean).length
                const step = horizontal ? 1 : Math.max(columns, 1)

                go(index + (event.key === "ArrowRight" || event.key === "ArrowDown" ? step : -step))
              }}
            >
              <For each={libraries()}>
                {(library, index) => (
                  <ContextMenu>
                    <ContextMenu.Trigger class="flex min-w-0">
                      <button
                        type="button"
                        class="knowledge-card flex-1"
                        data-tone={index() % TONE_COUNT}
                        onClick={() => knowledge.openLibrary(library)}
                      >
                        <span class="flex min-w-0 items-center gap-2">
                          <span class="knowledge-card-icon">
                            <Icon name="file-document" size="small" />
                          </span>
                          <span class="min-w-0 truncate text-[16px] leading-[var(--line-height-base)] font-medium">
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
                        <ContextMenu.Item onSelect={() => knowledge.openLibrary(library)}>
                          <ContextMenu.ItemLabel>{language.t("knowledge.files.menu.open")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                        <ContextMenu.Separator />
                        <ContextMenu.Item onSelect={() => knowledge.removeLibrary(library)}>
                          <ContextMenu.ItemLabel>{language.t("knowledge.delete")}</ContextMenu.ItemLabel>
                        </ContextMenu.Item>
                      </ContextMenu.Content>
                    </ContextMenu.Portal>
                  </ContextMenu>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    )
  }
}

/** A stored Markdown document reads as a page: the artifact view's surface, sized to an A4 sheet. */
function KnowledgeDocument(props: { text: string; cacheKey?: string }) {
  return (
    <div data-slot="knowledge-document">
      <div data-slot="artifact-markdown-page" data-component="document-surface">
        <div data-slot="artifact-markdown-content">
          <MarkdownProvider>
            <Markdown text={props.text} cacheKey={props.cacheKey} />
          </MarkdownProvider>
        </div>
      </div>
    </div>
  )
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
