import { createEffect, createMemo, createSignal, Match, onCleanup, Show, Switch, type Accessor } from "solid-js"
import { Schema } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Key } from "@solid-primitives/keyed"
import { useNavigate } from "@solidjs/router"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { usePlatform } from "@/runtime/platform/platform"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { arrayMove } from "@/runtime/array-move"
import { useSettingsSurface } from "@/settings/surface"
import { useCommand } from "@/shell/commands/command"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { usePinnedSessions } from "@/session/pins"
import { sessionLabel } from "@/session/title"
import { SessionMenuCopyID, useCopySessionID } from "@/session/menu-items"
import { SessionSettingsDialog } from "@/session/settings-dialog"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { useTabs } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { createSessionInbox, type InboxEntry, type InboxStatus } from "@/shell/titlebar/inbox-model"
import { InboxNav } from "./sidebar-inbox"
import { ExploreNav } from "./sidebar-explore"
import { KnowledgeNav } from "./sidebar-knowledge"
import { ScheduledNav } from "./sidebar-scheduled"
import { HEADER, LIST, PRIMARY, ROW, SECTION } from "./sidebar-tokens"

const DOT: Record<Exclude<InboxStatus, "ready" | "working">, string> = {
  approval: "bg-[var(--v2-state-fg-warning)]",
  input: "bg-[var(--v2-state-fg-warning)]",
  failed: "bg-[var(--v2-state-fg-danger)]",
  done: "bg-[var(--v2-state-fg-success)]",
}

const STATUS_LABEL = {
  approval: "sidebar.inbox.status.approval",
  input: "sidebar.inbox.status.input",
  working: "sidebar.inbox.status.working",
  failed: "sidebar.inbox.status.failed",
  done: "sidebar.inbox.status.done",
} as const

/** Pinned and recent rows sort inside their own section, so each list owns one sortable group. */
const PINNED_GROUP = "replica-sidebar-pinned"

const RECENT_GROUP = "replica-sidebar-recent"

/** The order a drag leaves the recent list in; pinned order lives in the pin list itself. */
const SidebarSessionOrder = Persistence.struct({
  recent: Persistence.array(Schema.String),
})

/** The run state at the end of a conversation row: a ring while working, one dot once the result lands. */
function StatusMark(props: { status: InboxStatus }) {
  const language = useLanguage()

  const label = () => {
    const value = props.status

    if (value === "ready") return

    return STATUS_LABEL[value]
  }

  return (
    <Show when={label()}>
      {(key) => (
        <span class="ms-auto flex shrink-0 items-center" title={language.t(key())}>
          <Show
            when={props.status === "working"}
            fallback={
              <span
                aria-hidden="true"
                class={`size-[6px] shrink-0 rounded-full ${DOT[props.status as Exclude<InboxStatus, "ready" | "working">]}`}
              />
            }
          >
            <ActivityRing class="size-3.5 shrink-0 text-[var(--color-icon-secondary)]" />
          </Show>
          <span class="sr-only">{language.t(key())}</span>
        </span>
      )}
    </Show>
  )
}

/** The navigation column of the workbench: each destination owns the list that leads into its workspace. */
export function ReplicaSidebar() {
  const layout = useLayout()

  return (
    <aside data-slot="replica-sidebar" data-ui="navigation-sidebar" class="flex min-h-0 flex-col">
      <Switch>
        <Match when={layout.route().type === "inbox"}>
          <InboxNav />
        </Match>
        <Match when={layout.route().type === "scheduled"}>
          <ScheduledNav />
        </Match>
        <Match when={layout.route().type === "explore"}>
          <ExploreNav />
        </Match>
        <Match when={layout.route().type === "knowledge"}>
          <KnowledgeNav />
        </Match>
        <Match when={true}>
          <ConversationNav />
        </Match>
      </Switch>
    </aside>
  )
}

/**
 * The home destination: pinned conversations, then recent ones, each row carrying its project's icon. Rows sit
 * 2px apart so a selected background never reads as one continuous block.
 */
/** One session row: click opens it, double-click on the title renames it in place, right-click shows its actions. */
function SessionRow(props: {
  entry: Accessor<InboxEntry>
  active: Accessor<boolean>
  group: string
  index: number
  onOpen: (entry: InboxEntry) => void
  onDelete: (entry: InboxEntry) => void
}) {
  const language = useLanguage()

  const pins = usePinnedSessions()

  const platform = usePlatform()

  const copySessionID = useCopySessionID()

  const settings = useSettingsSurface()

  const dialog = useDialog()

  const tabs = useTabs()

  // The row is the sortable element itself: dnd-kit refuses a drag that starts on a row's own pressed
  // button when that button is only a descendant of a different element.
  const sortable = useSortable({
    get id() {
      return props.entry().key
    },
    get index() {
      return props.index
    },
    get group() {
      return props.group
    },
    get data() {
      return { group: props.group }
    },
    accept: (source) => source.data?.group === props.group,
  })

  const nativeMenu = () => !!platform.showContextMenu

  const [renaming, setRenaming] = createSignal(false)
  let label!: HTMLSpanElement

  const project = () => props.entry().ctx.projects.forSession(props.entry().session)

  const openProjectSettings = () => {
    const current = project()

    if (!current) return

    settings.openProject({ server: props.entry().server, project: current.worktree })
  }

  createEffect(() => {
    const value = sessionLabel(props.entry().session)

    if (!label || renaming()) return
    label.textContent = value
  })

  const startRename = () => {
    if (renaming()) return
    label.textContent = sessionLabel(props.entry().session)
    setRenaming(true)

    requestAnimationFrame(() => {
      label.focus()
      const range = document.createRange()
      range.selectNodeContents(label)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const beginRename = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    startRename()
  }

  const commit = async (save: boolean) => {
    if (!renaming()) return

    const entry = props.entry()
    const original = sessionLabel(entry.session)
    const next = (label.textContent ?? "").trim()
    setRenaming(false)
    label.textContent = original

    if (!save || !next || next === original) return
    const ctx = entry.ctx
    const id = entry.session.id

    await ctx.sdk.api.session
      .update({ sessionID: id, title: next })
      .then(() => {
        ctx.data.session.remember({ ...(ctx.data.session.get(id) ?? entry.session), title: next })
        // A rename advances time.updated server-side, so re-read the canonical record.
        ctx.data.session.invalidate(id)
        void ctx.data.session.sync(id).catch(() => undefined)
      })
      .catch(() => undefined)
  }

  // Desktop draws the platform menu; only the web build needs the in-app one.
  const showNativeMenu = async (position: { x: number; y: number }) => {
    const show = platform.showContextMenu

    if (!show) return

    const entry = props.entry()

    const session = entry.session

    const pinned = pins.isPinned(session.id)

    const chosen = await show(
      [
        { id: "rename", label: language.t("common.rename"), accelerator: "Alt+CmdOrCtrl+R", icon: "rename" },
        {
          id: "pin",
          label: pinned ? language.t("common.unpin") : language.t("common.pin"),
          accelerator: "Alt+CmdOrCtrl+P",
          icon: pinned ? "unpin" : "pin",
        },
        // No unread state for a row yet; the entry stays as the placeholder the native menu shape expects.
        {
          id: "markUnread",
          label: language.t("common.markUnread"),
          accelerator: "Shift+CmdOrCtrl+U",
          icon: "markUnread",
          enabled: false,
        },
        { id: "sessionSettings", label: language.t("session.settings.menu"), icon: "settings" },
        { id: "projectSettings", label: language.t("project.settings.menu"), icon: "project" },
        { type: "separator" },
        // A branch is a new draft on a fresh worktree of the same directory, so the conversation continues there.
        { id: "createBranch", label: language.t("common.createBranch"), icon: "branch" },
        { type: "separator" },
        {
          id: "copy",
          label: language.t("common.copy"),
          icon: "copy",
          submenu: [{ id: "copyID", label: language.t("command.session.copyID") }],
        },
        // Placeholder until a session can open in a second window.
        { id: "openInNewWindow", label: language.t("common.openInNewWindow"), icon: "newWindow", enabled: false },
        { type: "separator" },
        // Placeholder until the session archive API is available from the client.
        {
          id: "archive",
          label: language.t("common.archive"),
          accelerator: "Shift+CmdOrCtrl+A",
          icon: "archive",
          enabled: false,
        },
        { type: "separator" },
        { id: "delete", label: `${language.t("common.delete")}…`, icon: "delete" },
      ],
      position,
    )

    if (chosen === "pin") pins.toggle(session.id)
    else if (chosen === "rename") startRename()
    else if (chosen === "copyID") void copySessionID(session.id)
    else if (chosen === "sessionSettings")
      dialog.show(() => <SessionSettingsDialog server={entry.server} session={entry.session} />)
    else if (chosen === "projectSettings") openProjectSettings()
    else if (chosen === "createBranch")
      void tabs.newDraft({ server: entry.server, directory: entry.session.location.directory, worktree: "create" })
    else if (chosen === "delete") props.onDelete(props.entry())
  }

  createEffect(() => {
    if (!renaming()) return

    const cleanup = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        const target = event.target

        if (!(target instanceof Node)) return
        if (label.contains(target)) return
        // A pointer that lands before the editor took focus belongs to whatever is still closing, not to
        // an outside click on the editor.
        if (document.activeElement !== label) return
        void commit(true)
      },
      { capture: true },
    )

    onCleanup(cleanup)
  })

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="div"
        ref={sortable.ref}
        data-slot="replica-row"
        data-ui="sidebar-row"
        data-state={props.active() ? "pressed" : undefined}
        data-renaming={renaming() ? "" : undefined}
        role="button"
        tabindex={renaming() ? undefined : 0}
        class={`${ROW} outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--color-icon-secondary)]`}
        onClick={() => {
          if (renaming()) return
          props.onOpen(props.entry())
        }}
        onContextMenu={(event) => {
          if (!nativeMenu()) return
          event.preventDefault()
          void showNativeMenu({ x: event.clientX, y: event.clientY })
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (renaming() || event.key !== "Enter") return
          event.preventDefault()
          props.onOpen(props.entry())
        }}
      >
        <Show
          when={project()}
          fallback={<Icon name="folder" class="size-4 shrink-0 text-[var(--color-icon-secondary)]" />}
        >
          {(project) => <ProjectIcon project={project()} class="size-4 shrink-0" />}
        </Show>
        <span
          ref={label}
          data-slot="replica-row-title"
          dir="auto"
          class="min-w-0 flex-1 outline-none"
          classList={{ truncate: !renaming(), "cursor-text select-text": renaming() }}
          contenteditable={renaming() ? "plaintext-only" : undefined}
          onDblClick={beginRename}
          onKeyDown={(event) => {
            if (!renaming()) return
            event.stopPropagation()

            if (event.key === "Enter") {
              event.preventDefault()
              void commit(true)

              return
            }

            if (event.key !== "Escape") return
            event.preventDefault()
            void commit(false)
          }}
          onBlur={() => {
            // Losing the window (a native menu closing, another app taking focus) is not the user leaving
            // the editor; keep it open so the rename survives.
            if (!document.hasFocus()) return
            void commit(true)
          }}
          onPointerDown={(event) => {
            if (renaming()) event.stopPropagation()
          }}
          onClick={(event) => {
            if (!renaming()) return
            event.preventDefault()
            event.stopPropagation()
          }}
        />
        <StatusMark status={props.entry().status} />
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            if (renaming()) event.preventDefault()
          }}
        >
          <Menu.Group>
            <Menu.GroupLabel>{language.t("menu.group.organize")}</Menu.GroupLabel>
            <Menu.Item onSelect={() => pins.toggle(props.entry().session.id)}>
              {pins.isPinned(props.entry().session.id) ? language.t("common.unpin") : language.t("common.pin")}
            </Menu.Item>
            <Menu.Item onSelect={startRename}>{language.t("common.rename")}</Menu.Item>
          </Menu.Group>
          <Menu.Separator />
          <Menu.Group>
            <Menu.GroupLabel>{language.t("menu.group.copyExport")}</Menu.GroupLabel>
            <SessionMenuCopyID sessionID={props.entry().session.id} />
          </Menu.Group>
          <Menu.Separator />
          <Menu.Group>
            <Menu.GroupLabel>{language.t("menu.group.danger")}</Menu.GroupLabel>
            <Menu.Item data-variant="critical" onSelect={() => props.onDelete(props.entry())}>
              {language.t("common.delete")}…
            </Menu.Item>
          </Menu.Group>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

function ConversationNav() {
  const language = useLanguage()
  const navigate = useNavigate()
  const command = useCommand()
  const tabs = useTabs()
  const layout = useLayout()
  const global = useGlobal()
  const inbox = createSessionInbox()
  const pins = usePinnedSessions()
  const dialog = useDialog()

  const pending = () =>
    inbox
      .entries()
      .filter((entry) => entry.status === "approval" || entry.status === "input" || entry.status === "failed").length

  const [order, setOrder] = persisted(Persist.global("replica.sidebar.sessions"), SidebarSessionOrder, { recent: [] })

  const pinned = createMemo(() => {
    const byID = new Map(inbox.entries().map((entry) => [entry.session.id, entry]))

    return pins.ids().flatMap((id) => {
      const entry = byID.get(id)

      return entry ? [entry] : []
    })
  })

  // A dragged order wins for the sessions it lists. A session that arrives afterwards still floats to the
  // top by activity, so a conversation that just finished is never buried under the sorted ones.
  const recent = createMemo(() => {
    const pinnedIDs = new Set(pins.ids())
    const list = inbox.entries().filter((entry) => !pinnedIDs.has(entry.session.id))
    const byID = new Map(list.map((entry) => [entry.session.id, entry]))
    const ranked = new Set(order.recent)
    const fresh = list
      .filter((entry) => !ranked.has(entry.session.id))
      .toSorted((a, b) => b.session.time.updated - a.session.time.updated)

    return [...fresh, ...order.recent.flatMap((id) => byID.get(id) ?? [])].slice(0, 12)
  })

  const currentTab = createMemo(() => {
    const route = layout.route()

    if (route.type === "session") return tabs.sessionTab(route.server, route.sessionId)

    if (route.type === "draft")
      return tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
  })

  const active = (entry: InboxEntry) => {
    const tab = currentTab()

    return !!tab && tab.type === "session" && tab.server === entry.server && tab.sessionId === entry.session.id
  }

  const newChat = () => {
    const conn = global.servers.list()[0]

    if (!conn) return
    const key = ServerConnection.key(conn)
    const ctx = global.serverCtx(key)

    if (!ctx) return
    const directory = ctx.projects.last()?.worktree ?? ctx.projects.list()[0]?.worktree

    if (!directory) return
    void tabs.newDraft({ server: key, directory })
  }

  const open = (entry: InboxEntry) => {
    const directory = entry.ctx.projects.forSession(entry.session)?.worktree ?? entry.session.location.directory
    inbox.open(entry)
    entry.ctx.projects.touch(directory)
  }

  const confirmDelete = (entry: InboxEntry) => {
    const ids = sessionTreeIDs(entry.ctx.data.session.list(), entry.session.id)

    void dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: sessionLabel(entry.session) })}
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
              pins.remove(ids)
              void inbox.remove(entry)
            }}
          >
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))
  }

  return (
    <>
      <div data-slot="replica-sidebar-header" data-ui="sidebar-header" class={HEADER}>
        <button
          type="button"
          data-replica-control
          class="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 text-[19px] leading-6 font-semibold text-[var(--color-text-main)] hover:bg-[var(--color-hover)]"
          onClick={() => command.trigger("command.palette")}
        >
          <span class="min-w-0 truncate">{language.t("replica.workspace.name")}</span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-[var(--color-icon-secondary)]" />
        </button>
        <div class="ms-auto flex shrink-0 items-center gap-1">
          <Tooltip placement="bottom" value={language.t("inbox.title")}>
            <button
              type="button"
              data-replica-control
              aria-label={language.t("inbox.title")}
              class="relative flex size-[30px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-icon-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-icon-primary)]"
              onClick={() => navigate("/inbox")}
            >
              <Icon name="notifications" />
              {pending() > 0 && (
                <span
                  class="absolute end-1.5 top-1.5 size-[5px] rounded-full bg-[var(--color-accent-blue)]"
                  aria-hidden="true"
                />
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      <button type="button" data-replica-control data-slot="replica-new-chat" class={PRIMARY} onClick={newChat}>
        <Icon name="edit" class="shrink-0 text-[var(--color-icon-secondary)]" />
        <span class="min-w-0 truncate">{language.t("replica.newChat")}</span>
      </button>

      <div data-slot="replica-sidebar-scroll" class="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <DragDropProvider
          sensors={[
            PointerSensor.configure({
              activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
            }),
          ]}
          modifiers={[RestrictToVerticalAxis]}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            Feedback.configure({ dropAnimation: null }),
          ]}
          onDragEnd={(event) => {
            const source = event.operation.source

            if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return

            const group = String(source.group ?? "")

            if (group === PINNED_GROUP) {
              pins.reorder(
                arrayMove(
                  pinned().map((entry) => entry.session.id),
                  source.initialIndex,
                  source.index,
                ),
              )

              return
            }

            if (group !== RECENT_GROUP) return
            setOrder(
              "recent",
              arrayMove(
                recent().map((entry) => entry.session.id),
                source.initialIndex,
                source.index,
              ),
            )
          }}
        >
          {pinned().length > 0 && (
            <section class="mb-2 flex flex-col">
              <h2 class={SECTION}>{language.t("replica.section.pinned")}</h2>
              <div class={LIST}>
                <Key each={pinned()} by={(entry) => entry.key}>
                  {(entry) => (
                    <SessionRow
                      entry={entry}
                      active={() => active(entry())}
                      group={PINNED_GROUP}
                      index={pinned().findIndex((item) => item.key === entry().key)}
                      onOpen={open}
                      onDelete={confirmDelete}
                    />
                  )}
                </Key>
              </div>
            </section>
          )}

          <Show when={recent().length > 0}>
            <section class="flex flex-col">
              <h2 class={SECTION}>{language.t("replica.section.recent")}</h2>
              <div class={LIST}>
                <Key each={recent()} by={(entry) => entry.key}>
                  {(entry) => (
                    <SessionRow
                      entry={entry}
                      active={() => active(entry())}
                      group={RECENT_GROUP}
                      index={recent().findIndex((item) => item.key === entry().key)}
                      onOpen={open}
                      onDelete={confirmDelete}
                    />
                  )}
                </Key>
              </div>
            </section>
          </Show>
        </DragDropProvider>
      </div>
    </>
  )
}
