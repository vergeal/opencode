import { Checkbox } from "@opencode/ui/checkbox"
import { Icon } from "@opencode/ui/icon"
import { For, Show } from "solid-js"
import { useKnowledge } from "@/knowledge/context"
import { FILE_ICONS, groupLabel, isConverted, sourceExtension } from "@/knowledge/display"
import type { KnowledgeLibrary } from "@/knowledge/store"
import { useLanguage } from "@/runtime/i18n/language"
import { HEADER, ICON_BUTTON, LIST, PRIMARY, ROW, SEARCH, TITLE } from "./sidebar-tokens"

/** The knowledge navigation column: libraries first, then the files of the open library. */
export function KnowledgeNav() {
  const knowledge = useKnowledge()

  return (
    <Show when={knowledge.library()} fallback={<LibraryNav />}>
      {(library) => <FileNav library={library()} />}
    </Show>
  )
}

function LibraryNav() {
  const language = useLanguage()
  const knowledge = useKnowledge()
  const libraries = () => knowledge.libraries.libraries()

  const items = () =>
    libraries().filter((library) => {
      const needle = knowledge.query().trim().toLocaleLowerCase()

      if (!needle) return true

      return `${library.name}\n${library.summary ?? ""}\n${library.description ?? ""}`
        .toLocaleLowerCase()
        .includes(needle)
    })

  return (
    <>
      <div data-slot="replica-sidebar-header" data-ui="sidebar-header" class={HEADER}>
        <h1 data-slot="replica-sidebar-title" class={TITLE}>
          {language.t("replica.nav.title.explore")}
        </h1>
      </div>

      <button
        type="button"
        data-replica-control
        data-slot="replica-new-chat"
        class={PRIMARY}
        onClick={knowledge.openNewLibrary}
      >
        <Icon name="plus" class="shrink-0 text-[var(--color-icon-secondary)]" />
        <span class="min-w-0 truncate">{language.t("replica.nav.newLibrary")}</span>
      </button>

      <label class={`${SEARCH} mt-2`}>
        <Icon name="magnifying-glass" size="small" class="shrink-0 text-[var(--color-icon-secondary)]" />
        <input
          type="search"
          data-replica-control
          class="min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-[var(--color-text-primary)] outline-none"
          placeholder={language.t("replica.nav.search")}
          aria-label={language.t("replica.nav.search")}
          value={knowledge.query()}
          onInput={(event) => knowledge.setQuery(event.currentTarget.value)}
        />
      </label>

      <div data-slot="replica-sidebar-scroll" class="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <Show
          when={items().length > 0}
          fallback={
            <p class="px-2 py-6 text-center text-[12px] leading-[var(--line-height-compact)] text-[var(--color-text-secondary)]">
              {language.t(libraries().length ? "knowledge.files.noResults" : "knowledge.empty")}
            </p>
          }
        >
          <div class={LIST}>
            <For each={items()}>
              {(library) => (
                <button
                  type="button"
                  data-slot="replica-row"
                  data-ui="library-row"
                  data-state={knowledge.library()?.id === library.id ? "pressed" : undefined}
                  class={ROW}
                  onClick={() => knowledge.openLibrary(library)}
                >
                  <Icon name="file-document" class="size-4 shrink-0 text-[var(--color-icon-secondary)]" />
                  <span class="min-w-0 flex-1 truncate">{library.name}</span>
                  <span class="shrink-0 text-[11px] tabular-nums text-[var(--color-text-faint)]">
                    {library.files.length}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </>
  )
}

function FileNav(props: { library: KnowledgeLibrary }) {
  const language = useLanguage()
  const knowledge = useKnowledge()

  const files = () => knowledge.visibleFiles()
  const selected = () => knowledge.selectedFiles()
  const flagged = () => knowledge.flaggedIn(props.library, selected()).length

  return (
    <>
      <div data-slot="replica-sidebar-header" data-ui="sidebar-header" class={HEADER}>
        <button
          type="button"
          data-replica-control
          aria-label={language.t("replica.nav.back")}
          class={ICON_BUTTON}
          onClick={() => knowledge.closeLibrary()}
        >
          <Icon name="outline-arrow-left" size="small" />
        </button>
        <h1 data-slot="replica-sidebar-title" class={`${TITLE} px-0`}>
          {props.library.name}
        </h1>
      </div>

      <label class={`${SEARCH} mt-1`}>
        <Icon name="magnifying-glass" size="small" class="shrink-0 text-[var(--color-icon-secondary)]" />
        <input
          type="search"
          data-replica-control
          class="min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-[var(--color-text-primary)] outline-none"
          placeholder={language.t("knowledge.files.search")}
          aria-label={language.t("knowledge.files.search")}
          value={knowledge.query()}
          onInput={(event) => knowledge.setQuery(event.currentTarget.value)}
        />
      </label>

      <Show when={props.library.files.length > 0}>
        <div class="mt-1 flex h-7 shrink-0 items-center gap-2 px-2">
          <Checkbox
            checked={knowledge.allVisibleSelected()}
            onChange={(checked) => knowledge.toggleVisible(checked)}
          >
            <span class="truncate text-[12px] leading-[var(--line-height-compact)] text-[var(--color-text-secondary)]">
              {language.t("knowledge.files.select")}
            </span>
          </Checkbox>
          <Show when={selected().length > 0}>
            <span class="ms-auto shrink-0 text-[11px] tabular-nums text-[var(--color-text-faint)]">
              {language.plural("knowledge.files.selected", selected().length, { count: selected().length })}
            </span>
          </Show>
        </div>
      </Show>

      <div
        data-slot="replica-sidebar-scroll"
        class="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        onKeyDown={(event) => {
          const keys = ["ArrowDown", "ArrowUp", "Home", "End"]

          if (!keys.includes(event.key)) return

          const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-ui="file-row"]')]
          const index = rows.findIndex((row) => row === document.activeElement)

          if (index === -1) return
          event.preventDefault()

          const last = rows.length - 1
          const go = (to: number) => rows[Math.min(Math.max(to, 0), last)]?.focus()

          if (event.key === "Home") return go(0)

          if (event.key === "End") return go(last)

          go(index + (event.key === "ArrowDown" ? 1 : -1))
        }}
      >
        <Show
          when={files().length > 0}
          fallback={
            <p class="px-2 py-6 text-center text-[12px] leading-[var(--line-height-compact)] text-[var(--color-text-secondary)]">
              {language.t(props.library.files.length ? "knowledge.files.noResults" : "knowledge.files.empty")}
            </p>
          }
        >
          <For each={knowledge.fileGroups()}>
            {([directory, group]) => (
              <div class="mb-1">
                <Show when={directory}>
                  <div class="truncate px-2 pt-1 pb-0.5 text-[11px] text-[var(--color-text-faint)]" dir="auto">
                    {groupLabel(directory)}
                  </div>
                </Show>
                <div class={LIST}>
                  <For each={group}>
                    {(file) => (
                      <div class="flex items-center gap-1">
                        <Checkbox
                          hideLabel
                          checked={selected().includes(file.path)}
                          onChange={(checked) => knowledge.toggleFile(file.path, checked)}
                        >
                          {file.name}
                        </Checkbox>
                        <button
                          type="button"
                          data-slot="replica-row"
                          data-ui="file-row"
                          data-state={knowledge.previewPath() === file.path ? "pressed" : undefined}
                          class={`${ROW} min-w-0 flex-1`}
                          title={file.source || file.path}
                          onClick={() => void knowledge.openFile(props.library, file)}
                        >
                          <Icon name={FILE_ICONS[file.kind]} size="small" class="shrink-0" />
                          <span dir="auto" class="min-w-0 flex-1 truncate">
                            {file.name}
                          </span>
                          <Show when={isConverted(file)}>
                            <span class="knowledge-ext-badge shrink-0">{sourceExtension(file)}</span>
                          </Show>
                        </button>
                        <Show when={knowledge.flagOf(props.library, file.path)}>
                          {(flag) => (
                            <button
                              type="button"
                              data-replica-control
                              class="knowledge-flag shrink-0"
                              title={flag().reason || language.t("knowledge.flags.irrelevant")}
                              onClick={() => knowledge.openFlag(props.library, file, flag())}
                            >
                              {language.t("knowledge.flags.irrelevant")}
                            </button>
                          )}
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show when={selected().length > 0}>
        <div class="mx-2 mb-2 flex shrink-0 items-center gap-1 rounded-[var(--radius-row)] border border-[var(--color-divider)] bg-[var(--color-main)] px-1.5 py-1">
          <span class="min-w-0 flex-1 truncate px-1 text-[12px] leading-[var(--line-height-compact)] text-[var(--color-text-secondary)]">
            {language.plural("knowledge.files.selected", selected().length, { count: selected().length })}
          </span>
          <Show when={selected().some((path) => !knowledge.flagOf(props.library, path))}>
            <button
              type="button"
              data-replica-control
              class={ICON_BUTTON}
              title={language.t("knowledge.flags.mark")}
              aria-label={language.t("knowledge.flags.mark")}
              onClick={() => knowledge.markSelection()}
            >
              <Icon name="outline-hexagonal-warning" size="small" />
            </button>
          </Show>
          <Show when={flagged() > 0}>
            <button
              type="button"
              data-replica-control
              class={ICON_BUTTON}
              title={language.t("knowledge.flags.unmark")}
              aria-label={language.t("knowledge.flags.unmark")}
              onClick={() => knowledge.unmarkSelection()}
            >
              <Icon name="outline-xmark" size="small" />
            </button>
          </Show>
          <button
            type="button"
            data-replica-control
            class={ICON_BUTTON}
            title={language.t("knowledge.files.delete")}
            aria-label={language.t("knowledge.files.delete")}
            onClick={() => knowledge.confirmRemoveFiles()}
          >
            <Icon name="trash" size="small" />
          </button>
        </div>
      </Show>
    </>
  )
}
