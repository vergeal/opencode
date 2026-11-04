import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { InlineInput } from "@opencode/ui/inline-input"
import { getFilename } from "@opencode/util/path"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { displayName } from "@opencode/ui/project-avatar"
import { errorMessage } from "@/shell/layout/helpers"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { showToast } from "@/shell/notifications/toast"
import { ContextMenu } from "@opencode/ui/context-menu"
import { ProjectOptions, projectMenuItems } from "./project-options"

export function SettingsProjectRow(props: {
  project: LocalProject
  server: ServerConnection.Any
  onOpen: (project: LocalProject) => void
}) {
  const language = useLanguage()
  const global = useGlobal()
  const platform = usePlatform()

  const [store, setStore] = createStore({
    menu: false,
    editor: undefined as { draft: string; saving: boolean } | undefined,
  })

  let button: HTMLButtonElement | undefined
  let input: HTMLInputElement | undefined

  const openEditor = () => {
    setStore("editor", { draft: displayName(props.project), saving: false })
    requestAnimationFrame(() => {
      input?.focus()
      input?.select()
    })
  }

  const closeEditor = () => {
    if (store.editor?.saving) return
    setStore("editor", undefined)
  }

  const saveEditor = async () => {
    if (!store.editor || store.editor.saving) return
    const name = store.editor.draft.trim()

    if (!name || name === displayName(props.project)) {
      closeEditor()
      requestAnimationFrame(() => button?.focus())

      return
    }

    setStore("editor", "saving", true)
    const context = global.ensureServerCtx(props.server)
    const value = name === getFilename(props.project.worktree) ? "" : name

    const saved = await (
      props.project.id && props.project.id !== "global"
        ? context.sdk.api.project
            .update({ projectID: props.project.id, name: value })
            .then((project) => context.sync.project.update(project))
        : Promise.resolve(context.sync.project.meta(props.project.worktree, { name: value }))
    )
      .then(() => true)
      .catch((cause: unknown) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        })

        return false
      })

    const restore = document.activeElement === document.body || document.activeElement === input

    if (saved) setStore("editor", undefined)

    if (!saved) setStore("editor", "saving", false)

    if (!restore) return
    requestAnimationFrame(() => (saved ? button : input)?.focus())
  }

  const deleteProject = () => global.ensureServerCtx(props.server).projects.hide(props.project)

  const items = projectMenuItems({
    server: props.server,
    project: props.project,
    onEdit: () => props.onOpen(props.project),
    onRename: openEditor,
    onDelete: deleteProject,
  })

  // Desktop draws the platform menu; only the web build needs the in-app one.
  const showNativeMenu = async (position: { x: number; y: number }) => {
    const show = platform.showContextMenu

    if (!show) return
    const menu = items()

    const chosen = await show(
      menu.flatMap((item) => [
        ...(item.separated ? [{ type: "separator" as const }] : []),
        { id: item.id, label: item.label, enabled: !item.disabled },
      ]),
      position,
    )

    menu.find((item) => item.id === chosen)?.onSelect()
  }

  const row = () => (
    <div
      role="listitem"
      data-component="settings-project-card"
      data-menu={store.menu ? "true" : undefined}
      class="settings-project-card"
    >
      <Show
        when={!store.editor}
        fallback={
          <div class="flex h-full min-w-0 flex-1 items-center gap-2">
            <ProjectIcon project={props.project} class="shrink-0" />
            <InlineInput
              ref={input}
              aria-label={language.t("common.rename")}
              dir="auto"
              value={store.editor?.draft ?? ""}
              disabled={store.editor?.saving}
              class="w-full text-[15px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none"
              style={{ "--inline-input-shadow": "none", "border-radius": "0", "text-align": "start" }}
              onInput={(event) => setStore("editor", "draft", event.currentTarget.value)}
              onKeyDown={(event) => {
                event.stopPropagation()

                if (event.isComposing || event.keyCode === 229) return

                if (event.key === "Enter") {
                  event.preventDefault()
                  void saveEditor()

                  return
                }

                if (event.key !== "Escape") return
                event.preventDefault()
                closeEditor()
                requestAnimationFrame(() => button?.focus())
              }}
              onBlur={closeEditor}
            />
          </div>
        }
      >
        <button
          ref={button}
          type="button"
          aria-label={displayName(props.project)}
          title={props.project.worktree}
          class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-[4px] bg-transparent text-start focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)]"
          onClick={() => props.onOpen(props.project)}
        >
          <ProjectIcon project={props.project} class="shrink-0" />
          <bdi class="truncate text-[15px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base">
            {displayName(props.project)}
          </bdi>
        </button>
        <ProjectOptions
          server={props.server}
          project={props.project}
          open={store.menu}
          onOpenChange={(open) => setStore("menu", open)}
          onEdit={() => props.onOpen(props.project)}
          onRename={openEditor}
          onDelete={deleteProject}
        />
      </Show>
    </div>
  )

  return (
    <Show
      when={!platform.showContextMenu}
      fallback={
        <div
          onContextMenu={(event) => {
            event.preventDefault()
            void showNativeMenu({ x: event.clientX, y: event.clientY })
          }}
        >
          {row()}
        </div>
      }
    >
      <ContextMenu>
        <ContextMenu.Trigger class="settings-project-row-shell">{row()}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content>
            {items().map((item) => (
              <>
                {item.separated ? <ContextMenu.Separator /> : null}
                <ContextMenu.Item disabled={item.disabled} onSelect={item.onSelect}>
                  <ContextMenu.ItemLabel>{item.label}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </>
            ))}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  )
}
