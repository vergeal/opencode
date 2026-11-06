import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import {
  createContext,
  createEffect,
  createMemo,
  createUniqueId,
  For,
  on,
  Show,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { DragDropProvider, PointerSensor, type DragDropProviderProps } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@/runtime/array-move"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { Loader } from "@opencode/ui/loader"
import { displayName } from "@opencode/ui/project-avatar"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { SessionSettingsDialog } from "@/session/settings-dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { usePinnedSessions } from "@/session/pins"
import { Persist, persisted } from "@/runtime/persistence/storage"
import type { LocalProject } from "@/shell/state/layout"
import { pathKey } from "@/workspaces/path-key"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { sessionTabTitle } from "./tab-title"
import { sessionTitle } from "@/session/title"
import { createSessionInbox, inboxArchived, inboxBusy, type InboxEntry, type InboxStatus } from "./inbox-model"

// Drop containers: a session reorders inside its own container and changes sections by landing in another one.
const PINNED = "pinned"

const NEEDS = "needs"

const WORKING = "working"

const RECENT = "recent"

const projectContainer = (key: string) => `project:${key}`

const InboxNavigation = createContext<Accessor<string | undefined>>()

// `since` is when the inbox was first used; Recent only lists sessions that finished a run after it.
const InboxState = Persistence.struct({
  workingExpanded: Schema.Boolean,
  // Manually dragged order per container. Containers without an entry keep their derived order.
  order: Persistence.record(Persistence.array(Schema.String)),
  since: Persistence.optional(Schema.Number),
})

// A container's stored order ranks the rows a person placed; rows that arrived later keep the derived order and
// float to the top, which is where a newly finished or newly archived session belongs.
function applyOrder(order: Record<string, string[]>, container: string, list: InboxEntry[]) {
  const rank = order[container]

  if (!rank || rank.length === 0) return list

  const position = new Map(rank.map((key, index) => [key, index]))

  return list.toSorted((a, b) => (position.get(a.key) ?? -1) - (position.get(b.key) ?? -1))
}

/** The experimental Inbox interface mode: the session inbox in place of vertical tabs. */
export function SidebarInbox() {
  const language = useLanguage()
  const dialog = useDialog()
  const inbox = createSessionInbox({ archived: true })
  const pins = usePinnedSessions()
  // Drags stay inside the scrolling list, so a row never floats over the Working shelf.
  let scrollRef!: HTMLDivElement

  const [state, setState, , ready] = persisted(Persist.global("sidebar.inbox"), InboxState, {
    workingExpanded: true,
    order: {},
  })

  const sections = createMemo(() => {
    const list = inbox.entries()
    const pinnedIDs = new Set(pins.ids())

    const pinned = pins.ids().flatMap((id) => {
      const entry = list.find((item) => item.session.id === id)

      return entry ? [entry] : []
    })

    const rest = list.filter((entry) => !pinnedIDs.has(entry.session.id))
    // Everything that is not waiting on the person and not archived belongs in the Recent list.

    const settled = rest
      .filter((entry) => !inboxBusy(entry.status) && !inboxArchived(entry))
      .toSorted((a, b) => (b.session.time.idle ?? 0) - (a.session.time.idle ?? 0))
    // The most recently finished session comes first.

    const finished = rest
      .filter((entry) => {
        const since = state.since

        return !inboxBusy(entry.status) && since !== undefined && (entry.session.time.idle ?? 0) >= since
      })
      .toSorted((a, b) => (b.session.time.idle ?? 0) - (a.session.time.idle ?? 0))

    return {
      pinned: applyOrder(state.order, PINNED, pinned),
      needs: rest.filter((entry) => entry.status === "approval" || entry.status === "input"),
      recent: settled,
      inbox: finished.filter((entry) => !inboxArchived(entry)),
      working: rest.filter((entry) => entry.status === "working"),
    }
  })

  // Project headers replace the flat session list: each session stays under the project it belongs to, while the
  // pinned, needs-attention and working sections above keep their own state-based order.
  const projectKey = (entry: InboxEntry) =>
    `${entry.server}\0${pathKey(
      entry.ctx.projects.forSession(entry.session)?.worktree ?? entry.session.location.directory,
    )}`

  const projectGroups = (list: InboxEntry[]) => {
    const groups = new Map<
      string,
      {
        key: string
        name: string
        directory: string
        project: ReturnType<InboxEntry["ctx"]["projects"]["forSession"]>
        entries: InboxEntry[]
      }
    >()

    list.forEach((entry) => {
      const key = projectKey(entry)
      const group = groups.get(key)

      if (group) {
        group.entries.push(entry)

        return
      }

      const project = entry.ctx.projects.forSession(entry.session)

      groups.set(key, {
        key,
        name: displayName(project ?? { worktree: entry.session.location.directory }),
        directory: project?.worktree ?? entry.session.location.directory,
        project,
        entries: [entry],
      })
    })

    return [...groups.values()].map((group) => ({
      ...group,
      entries: applyOrder(state.order, projectContainer(group.key), group.entries),
    }))
  }

  // Working and needs-attention rows live in their own shelves, so the project folders and Recent list leave them out.
  const projectEntries = createMemo(() => [...sections().pinned, ...sections().inbox])

  const groupedInbox = createMemo(() => projectGroups(projectEntries()))

  // The Recent list is the shortcut for everything that is neither pinned nor archived.
  const recent = createMemo(() => applyOrder(state.order, RECENT, sections().recent))

  // The rows each container holds, in the order they are drawn: reordering and cross-container drops both need it.
  const containers = createMemo(() => {
    const map = new Map<string, InboxEntry[]>()

    map.set(NEEDS, sections().needs)
    map.set(WORKING, sections().working)
    map.set(RECENT, recent())
    groupedInbox().forEach((group) => map.set(projectContainer(group.key), group.entries))

    return map
  })

  const writeOrder = (container: string, keys: string[]) =>
    setState("order", (current) => ({ ...current, [container]: keys }))

  // A drop outside the source container means the folder it landed in acts on the session: move the session into that
  // project. Rows in Needs attention and Working are state-driven, so they never take a drop.
  const dropInto = async (entry: InboxEntry, to: string) => {
    const group = groupedInbox().find((item) => projectContainer(item.key) === to)

    if (!group) return

    if (inboxArchived(entry)) await inbox.unarchive(entry)

    if (pathKey(group.directory) === pathKey(entry.session.location.directory)) return

    await inbox.relocate(entry, { directory: group.directory, projectID: group.project?.id })
  }

  const endDrag: NonNullable<DragDropProviderProps["onDragEnd"]> = (event) => {
    const source = event.operation.source

    if (event.canceled || !isSortable(source)) return

    const entry = inbox.byKey().get(String(source.id))

    if (!entry) return
    const from = String(source.initialGroup ?? "")
    const target = event.operation.target
    // SAFETY: only `InboxRowSlot`'s sortable publishes `data`, and it always publishes `{ container: string }`.
    const to = (target?.data as { container?: string } | undefined)?.container

    if (!to) return

    if (to === from) {
      if (source.initialIndex === source.index) return

      const keys = (containers().get(from) ?? []).map((item) => item.key)

      if (keys.length === 0) return
      writeOrder(from, arrayMove(keys, source.initialIndex, source.index))

      return
    }

    // Place the arrival where it was dropped so the folder does not reshuffle once the change lands.
    const keys = (containers().get(to) ?? []).map((item) => item.key).filter((key) => key !== entry.key)
    const at = isSortable(target) ? Math.max(0, Math.min(target.index, keys.length)) : 0

    writeOrder(to, [...keys.slice(0, at), entry.key, ...keys.slice(at)])
    void dropInto(entry, to)
  }

  // The client only refreshes `time.idle` for loaded sessions when a run ends, so load every working one.
  createEffect(() => {
    ;[...sections().pinned, ...sections().working]
      .filter((entry) => entry.status === "working")
      .forEach((entry) => {
        if (entry.ctx.data.session.get(entry.session.id)) return
        void entry.ctx.data.session.sync(entry.session.id).catch(() => undefined)
      })
  })

  // Git info is not stored on the session, so load it for the rows the list currently shows.
  createEffect(() => {
    const visible = sections()

    inbox.loadBranches([...visible.pinned, ...visible.needs, ...visible.recent, ...visible.inbox, ...visible.working])
  })

  // The inbox starts empty and fills as sessions finish runs.
  createEffect(() => {
    if (ready() && state.since === undefined) setState("since", Date.now())
  })

  const deleteDialog = (entry: InboxEntry) =>
    dialog.show(() => (
      <DeleteDialog
        entry={entry}
        onConfirm={async () => {
          await inbox.remove(entry)
          pins.remove([entry.session.id])
        }}
      />
    ))

  const rows = (list: InboxEntry[], container: string, options: { disabled?: boolean } = {}) => (
    <For each={list.map((entry) => entry.key)}>
      {(key, index) => (
        <Show when={inbox.byKey().get(key)}>
          {(entry) => (
            <InboxRowSlot
              entry={entry()}
              container={container}
              index={index()}
              disabled={options.disabled ?? false}
              selected={inbox.selected(entry())}
              now={inbox.now(entry().status)}
              branch={inbox.branch(entry())}
              worktree={inbox.inWorktree(entry())}
              archived={inboxArchived(entry())}
              pinned={pins.isPinned(entry().session.id)}
              onTogglePin={() => pins.toggle(entry().session.id)}
              onOpen={() => inbox.open(entry())}
              onArchive={() => void inbox.archive(entry())}
              onUnarchive={() => void inbox.unarchive(entry())}
              onDelete={() => deleteDialog(entry())}
            />
          )}
        </Show>
      )}
    </For>
  )

  // The Recent list is a shortcut, not a container: its rows open and archive, but they never take a drag, which keeps
  // a session from registering as sortable twice while its project folder is open.
  const compactRows = (list: InboxEntry[]) => (
    <For each={list.map((entry) => entry.key)}>
      {(key) => (
        <Show when={inbox.byKey().get(key)}>
          {(entry) => (
            <InboxRow
              entry={entry()}
              selected={inbox.selected(entry())}
              now={inbox.now(entry().status)}
              branch={inbox.branch(entry())}
              worktree={inbox.inWorktree(entry())}
              archived={inboxArchived(entry())}
              pinned={pins.isPinned(entry().session.id)}
              onTogglePin={() => pins.toggle(entry().session.id)}
              onOpen={() => inbox.open(entry())}
              onArchive={() => void inbox.archive(entry())}
              onUnarchive={() => void inbox.unarchive(entry())}
              onDelete={() => deleteDialog(entry())}
            />
          )}
        </Show>
      )}
    </For>
  )

  return (
    <DragDropProvider
      sensors={(defaults) => [
        ...defaults.filter((sensor) => sensor !== PointerSensor),
        PointerSensor.configure({
          activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
          // The whole row is a button, which the sensor's default guard refuses to drag.
          preventActivation: () => false,
        }),
      ]}
      modifiers={[RestrictToVerticalAxis, RestrictToElement.configure({ element: () => scrollRef })]}
      plugins={(defaults) => [
        ...defaults.filter((plugin) => plugin !== AutoScroller && plugin !== Feedback),
        AutoScroller.configure({ acceleration: 8, threshold: { x: 0, y: 0.05 } }),
        Feedback.configure({ dropAnimation: null }),
      ]}
      onDragEnd={endDrag}
    >
      <div data-slot="sidebar-inbox" class="flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          data-slot="sidebar-inbox-scroll"
          class="-me-2.5 flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto pb-1 pe-2.5"
        >
          data-scrollable
          <Show
            when={
              recent().length === 0 &&
              sections().pinned.length === 0 &&
              sections().needs.length === 0 &&
              sections().working.length === 0
            }
          >
            <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
              {language.t("sidebar.inbox.empty")}
            </div>
          </Show>
          {/* Projects are gone from the navigation: every session lives in the flat Recent shelf. */}
          <Show when={sections().needs.length > 0}>
            <div class="flex shrink-0 flex-col gap-[2px]">
              <SectionHeader
                label={language.t("sidebar.inbox.section.needsAttention")}
                count={sections().needs.length}
              />
              {rows(sections().needs, NEEDS, { disabled: true })}
            </div>
          </Show>
          {/* Recent sessions are a flat shortcut list, so their rows stay one line and never drag between projects. */}
          {/* Pinned sessions are the top shelf; the Recent list below holds everything else. */}
          <Show when={sections().pinned.length > 0}>
            <div class="flex shrink-0 flex-col gap-[2px]">
              <SectionHeader label={language.t("sidebar.project.pinned")} />
              {compactRows(sections().pinned)}
            </div>
          </Show>
          <Show when={recent().length > 0}>
            <div class="flex shrink-0 flex-col gap-[2px]">
              <SectionHeader label={language.t("sidebar.project.recentSessions")} />
              {compactRows(recent())}
            </div>
          </Show>
        </div>
        {/* Working sessions sit in a shelf pinned below the scrolling list. */}
        <Show when={sections().working.length > 0}>
          <div
            data-slot="sidebar-inbox-working"
            class="mb-2.5 flex max-h-[40%] shrink-0 flex-col gap-[2px] border-t border-v2-border-border-muted pt-1.5"
          >
            <SectionHeader
              label={language.t("sidebar.inbox.section.working")}
              count={sections().working.length}
              expanded={state.workingExpanded}
              shimmer={!state.workingExpanded}
              onToggle={() => setState("workingExpanded", !state.workingExpanded)}
            />
            <div data-scrollable class="flex min-h-0 flex-col gap-[2px] overflow-y-auto">
              {/* The shelf folds completely; keeping the open session visible made a collapse look ignored. */}
              {rows(
                sections().working.filter(() => state.workingExpanded),
                WORKING,
                { disabled: true },
              )}
            </div>
          </div>
        </Show>
      </div>
    </DragDropProvider>
  )
}

function SectionHeader(props: {
  id?: string
  label: string
  count?: number
  expanded?: boolean
  shimmer?: boolean
  onToggle?: () => void
}) {
  const content = (): JSX.Element => (
    <>
      <span class="min-w-0 truncate">
        <Show when={props.shimmer} fallback={props.label}>
          <TextShimmer text={props.label} active />
        </Show>
      </span>
      <Show when={props.count}>
        <span class="shrink-0 tabular-nums text-v2-text-text-faint">{props.count}</span>
      </Show>
      <Show when={props.onToggle}>
        <Icon
          name="chevron-down"
          size="small"
          class="ms-auto shrink-0 transition-transform"
          classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
        />
      </Show>
    </>
  )

  return (
    <Show
      when={props.onToggle}
      fallback={
        <div
          id={props.id}
          data-slot="sidebar-section-label"
          class="flex shrink-0 items-center gap-1.5 text-v2-text-text-faint"
        >
          {content()}
        </div>
      }
    >
      {(toggle) => (
        <button
          type="button"
          id={props.id}
          data-slot="sidebar-section-label"
          aria-expanded={props.expanded}
          class="flex w-full shrink-0 items-center gap-1.5 rounded-full text-start text-v2-text-text-faint hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          onClick={toggle()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}

type InboxRowProps = {
  entry: InboxEntry
  selected: boolean
  now: number
  branch?: string
  worktree?: boolean
  archived: boolean
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}

/** A row that can be reordered inside its container and dropped onto another one. */
function InboxRowSlot(props: InboxRowProps & { container: string; index: number; disabled: boolean }) {
  const sortable = useSortable({
    get id() {
      return props.entry.key
    },
    get index() {
      return props.index
    },
    get group() {
      return props.container
    },
    get disabled() {
      return props.disabled
    },
    get data() {
      return { container: props.container }
    },
  })

  return (
    <div
      ref={sortable.ref}
      data-slot="sidebar-inbox-row"
      class="shrink-0"
      classList={{ "opacity-50": sortable.isDragSource() }}
    >
      <InboxRow {...props} />
    </div>
  )
}

function InboxRow(props: InboxRowProps) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const nativeMenu = () => !!platform.showContextMenu
  const project = createMemo(() => props.entry.ctx.projects.forSession(props.entry.session))
  const servers = useServers()
  const title = () => sessionTabTitle(props.entry.session.title, language.t("session.tab.session"))

  // One line keeps the list scannable, so the untruncated title, project, server and path live in the row's tooltip.
  const detail = () =>
    [
      title(),
      [displayName(project() ?? { worktree: props.entry.session.location.directory }), servers.tag(props.entry.conn)]
        .filter(Boolean)
        .join(" · "),
      props.branch,
      props.entry.session.location.directory,
    ]
      .filter(Boolean)
      .join("\n")

  const status = () => props.entry.status
  const unread = () => status() !== "ready" && status() !== "working"
  // SAFETY: this label renders only inside `<Show when={status() !== "ready"}>`, so "ready" never reaches it.
  const statusLabel = () => language.t(`sidebar.inbox.status.${status() as Exclude<InboxStatus, "ready">}`)

  const compact = (seconds: number) => {
    if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

    if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

    return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
  }

  const elapsed = () => {
    // `time.updated` moves when a prompt is enqueued, so it marks when the current run was requested.
    const seconds = Math.max(0, Math.floor((props.now - props.entry.session.time.updated) / 1000))

    return seconds < 60 ? language.plural("sidebar.inbox.elapsed.seconds", seconds) : compact(seconds)
  }

  const age = () => {
    const seconds = Math.max(
      0,
      Math.floor((props.now - (props.entry.session.time.idle ?? props.entry.session.time.updated)) / 1000),
    )

    return seconds < 60 ? language.t("sidebar.inbox.time.now") : compact(seconds)
  }

  const showNativeMenu = async (position: { x: number; y: number }) => {
    const show = platform.showContextMenu

    if (!show) return

    const chosen = await show(
      [
        { id: "pin", label: props.pinned ? language.t("common.unpin") : language.t("common.pin") },
        {
          id: props.archived ? "unarchive" : "archive",
          label: props.archived ? language.t("sidebar.inbox.unarchive") : language.t("common.archive"),
        },
        { id: "settings", label: `${language.t("session.settings.menu")}…` },
        { type: "separator" },
        { id: "delete", label: `${language.t("common.delete")}…` },
      ],
      position,
    )

    if (chosen === "pin") props.onTogglePin()
    else if (chosen === "archive") props.onArchive()
    else if (chosen === "unarchive") props.onUnarchive()
    else if (chosen === "settings")
      dialog.show(() => (
        <SessionSettingsDialog server={ServerConnection.key(props.entry.conn)} session={props.entry.session} />
      ))
    else if (chosen === "delete") props.onDelete()
  }

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        data-slot="sidebar-inbox-item"
        data-status={status()}
        data-state={props.selected ? "active" : undefined}
        class="group grid h-[30px] w-full shrink-0 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-full ps-2 pe-2 text-start focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)]"
        classList={{
          "transition-opacity hover:opacity-100 focus-visible:opacity-100": !props.selected,
          "opacity-70": status() === "working" && !props.selected,
        }}
        title={detail()}
        onContextMenu={(event) => {
          if (!nativeMenu()) return
          event.preventDefault()
          void showNativeMenu({ x: event.clientX, y: event.clientY })
        }}
        onClick={props.onOpen}
      >
        <span data-slot="inbox-row-avatar" class="flex size-4 shrink-0 items-center justify-center">
          <SessionTabAvatarView project={project()} directory={props.entry.session.location.directory} unread={false} />
        </span>
        <span
          dir="auto"
          data-slot="inbox-row-title"
          class="min-w-0 truncate text-[13px] leading-4"
          // Rows recede once read so unread results stand out.
          classList={{
            "font-medium text-v2-text-text-base": unread(),
            "text-v2-text-text-muted": !unread(),
          }}
        >
          {title()}
        </span>
        <span
          data-slot="inbox-row-status"
          class="shrink-0 text-[11px] leading-[14px] tabular-nums text-v2-text-text-faint"
          role={status() === "ready" ? undefined : "status"}
        >
          <Show when={status() !== "ready"} fallback={age()}>
            <span
              classList={{
                "text-v2-state-fg-warning": status() === "approval" || status() === "input",
                "text-v2-state-fg-info": status() === "working",
                "text-v2-state-fg-danger": status() === "failed",
                "text-v2-state-fg-success": status() === "done",
              }}
            >
              <Show when={status() === "working"} fallback={statusLabel()}>
                {/* Announce only the status: the ticking duration would be re-read every second. */}
                <span class="sr-only">{language.t("sidebar.inbox.status.working")}</span>
                {/* The label is short, so the shared sweep covers all of it at once. A narrower, faster
                    sweep in the status colour makes the row's activity read at a glance. */}
                <span aria-hidden="true" data-slot="sidebar-inbox-working-status">
                  <TextShimmer text={language.t("sidebar.inbox.status.workingFor", { duration: elapsed() })} active />
                </span>
              </Show>
            </span>
          </Show>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Menu.Item onSelect={props.onTogglePin}>
            {props.pinned ? language.t("common.unpin") : language.t("common.pin")}
          </Menu.Item>
          <Show
            when={props.archived}
            fallback={<Menu.Item onSelect={props.onArchive}>{language.t("common.archive")}</Menu.Item>}
          >
            <Menu.Item onSelect={props.onUnarchive}>{language.t("sidebar.inbox.unarchive")}</Menu.Item>
          </Show>
          <Menu.Item
            onSelect={() =>
              dialog.show(() => (
                <SessionSettingsDialog server={ServerConnection.key(props.entry.conn)} session={props.entry.session} />
              ))
            }
          >
            {language.t("session.settings.menu")}…
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item onSelect={props.onDelete}>{language.t("common.delete")}…</Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

/** The archive lives behind the foot's entry, so the sidebar list stays focused on current work. */
export function ArchivedSessionsDialog() {
  const language = useLanguage()
  const dialog = useDialog()
  const inbox = createSessionInbox({ archived: true })
  const pins = usePinnedSessions()
  // Newest archive first; older sessions only have a settled timestamp.
  const archivedAt = (entry: InboxEntry) => entry.session.time.archived ?? entry.session.time.idle ?? 0

  const archived = createMemo(() =>
    inbox
      .entries()
      .filter(inboxArchived)
      .toSorted((a, b) => archivedAt(b) - archivedAt(a)),
  )

  return (
    <Dialog fit size="large" containerClass="archived-sessions-dialog">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("sidebar.inbox.section.archived")}
          description={language.plural("sidebar.inbox.archived.count", archived().length)}
        />
      </DialogHeader>
      <DialogBody>
        <Show
          when={archived().length > 0}
          fallback={
            <p class="px-4 py-8 text-[13px] leading-5 text-v2-text-text-faint">
              {language.t("sidebar.inbox.archived.empty")}
            </p>
          }
        >
          <div data-scrollable class="flex max-h-[min(60dvh,520px)] min-h-0 flex-col gap-[2px] overflow-y-auto p-2">
            <For each={archived()}>
              {(entry) => (
                <InboxRow
                  entry={entry}
                  selected={false}
                  now={inbox.now(entry.status)}
                  branch={inbox.branch(entry)}
                  worktree={inbox.inWorktree(entry)}
                  archived
                  pinned={pins.isPinned(entry.session.id)}
                  onTogglePin={() => pins.toggle(entry.session.id)}
                  onOpen={() => {
                    dialog.close()
                    inbox.open(entry)
                  }}
                  onArchive={() => void inbox.archive(entry)}
                  onUnarchive={() => void inbox.unarchive(entry)}
                  onDelete={() =>
                    dialog.show(() => (
                      <DeleteDialog
                        entry={entry}
                        onConfirm={async () => {
                          await inbox.remove(entry)
                          pins.remove([entry.session.id])
                        }}
                      />
                    ))
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </DialogBody>
    </Dialog>
  )
}

function DeleteDialog(props: { entry: InboxEntry; onConfirm: () => Promise<void> }) {
  const language = useLanguage()
  const dialog = useDialog()

  const confirm = async () => {
    await props.onConfirm()
    dialog.close()
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.delete.title")}
          description={language.t("session.delete.confirm", {
            name: sessionTitle(props.entry.session.title) ?? language.t("command.session.new"),
          })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="neutral" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" onClick={confirm}>
          {language.t("session.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function InboxSessionList(props: {
  loading?: boolean
  announcement?: string
  current: { count: number; rows: () => JSX.Element }
  sections: { id: string; label: string; count: number; rows: () => JSX.Element; more?: () => JSX.Element }[]
  working: { count: number; rows: () => JSX.Element; expanded: boolean; onToggle: () => void }
  archived: boolean
  onArchived: () => void
}) {
  const language = useLanguage()
  const id = createUniqueId()

  const [navigation, setNavigation] = createStore<{ focused?: string }>({})

  let container: HTMLDivElement | undefined

  createEffect(
    on(
      () => [
        props.loading,
        props.current.count,
        ...props.sections.map((section) => section.count),
        props.working.count,
        props.working.expanded,
      ],
      () => {
        if (props.loading) return

        const rows = Array.from(
          container?.querySelectorAll<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]') ?? [],
        )

        const target =
          rows.find((row) => row.id === navigation.focused) ??
          rows.find((row) => row.dataset.state === "active") ??
          rows[0]

        setNavigation("focused", target?.id)
      },
    ),
  )

  return (
    <InboxNavigation.Provider value={() => navigation.focused}>
      <div
        ref={container}
        data-slot="sidebar-inbox"
        aria-busy={props.loading}
        class="flex min-h-0 flex-1 flex-col"
        onFocusIn={(event) => {
          const row = event.target.closest<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]')

          if (row) setNavigation("focused", row.id)
        }}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

          const rows = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-slot="sidebar-inbox-item"]'),
          )

          const index = rows.findIndex((row) => row === event.target)

          if (index === -1) return

          let next = index

          switch (event.key) {
            case "Home":
              next = 0
              break
            case "End":
              next = rows.length - 1
              break
            case "ArrowUp":
              next = Math.max(0, index - 1)
              break
            case "ArrowDown":
              next = Math.min(rows.length - 1, index + 1)
              break
            default:
              return
          }

          event.preventDefault()

          rows[next].focus({ preventScroll: true })
          rows[next].scrollIntoView({ block: "nearest" })
        }}
      >
        <span class="sr-only" role="status" aria-atomic="true">
          {props.announcement}
        </span>
        <Show
          when={!props.loading}
          fallback={
            <div class="flex justify-center p-2">
              <Loader role="img" aria-hidden="false" aria-label={language.t("common.loading")} />
            </div>
          }
        >
          <div
            data-slot="sidebar-inbox-scroll"
            data-scrollable
            class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1"
          >
            <Show when={props.current.count > 0}>
              <div class="flex shrink-0 flex-col gap-0.5 pb-2.5">{props.current.rows()}</div>
            </Show>
            <For each={props.sections}>
              {(section) => (
                <Show when={section.count > 0}>
                  <div role="group" aria-labelledby={`${id}-${section.id}`} class="flex shrink-0 flex-col gap-2 pb-2.5">
                    <SectionHeader id={`${id}-${section.id}`} label={section.label} />
                    <div class="flex flex-col gap-0.5">{section.rows()}</div>
                    {section.more?.()}
                  </div>
                </Show>
              )}
            </For>
            <Show
              when={
                props.current.count === 0 &&
                props.working.count === 0 &&
                props.sections.every((section) => section.count === 0)
              }
            >
              <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
                {language.t("sidebar.inbox.empty")}
              </div>
            </Show>
            <Show when={props.archived}>
              <div class="shrink-0 pt-3">
                <Button
                  variant="ghost-muted"
                  size="normal"
                  class="w-full justify-start px-2"
                  onClick={props.onArchived}
                >
                  {language.t("sidebar.inbox.section.archived")}
                </Button>
              </div>
            </Show>
          </div>
          {/* Working sessions sit in a shelf pinned below the scrolling list. */}
          <Show when={props.working.count > 0}>
            <div
              data-slot="sidebar-inbox-working"
              role="group"
              aria-labelledby={`${id}-working`}
              class="relative flex max-h-[40%] shrink-0 flex-col gap-2 pt-[7px]"
            >
              <span
                aria-hidden="true"
                class="pointer-events-none absolute top-0 h-px bg-v2-border-border-muted"
                style={{
                  "inset-inline-start": "calc(1px - var(--sidebar-inset-start, 11px))",
                  "inset-inline-end": "calc(1px - (var(--sidebar-inset-end, 3px) + var(--sidebar-divider-bleed, 0px)))",
                }}
              />
              <SectionHeader
                id={`${id}-working`}
                label={language.t("sidebar.inbox.section.working")}
                expanded={props.working.expanded}
                shimmer={!props.working.expanded}
                onToggle={props.working.onToggle}
              />
              <Show when={props.working.expanded}>
                <div data-scrollable class="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                  {props.working.rows()}
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </InboxNavigation.Provider>
  )
}

export function InboxSessionCard(props: {
  project?: LocalProject
  directory: string
  title?: string
  status: InboxStatus
  server?: string
  since: number | undefined
  selected: boolean
  now: number
  branch: string | undefined
  worktree: boolean
  archived: boolean
  onOpen: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
}) {
  const language = useLanguage()
  const navigation = useContext(InboxNavigation)
  const id = createUniqueId()

  const status = () => props.status

  const compact = (seconds: number) => {
    if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

    if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

    return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
  }

  const statusLabel = (value: InboxStatus) =>
    value === "ready" ? undefined : language.t(`sidebar.inbox.status.${value}`)

  const age = () => {
    if (props.since === undefined) return

    const seconds = Math.max(0, Math.floor((props.now - props.since) / 1000))

    if (status() === "working" && seconds < 60) return language.plural("sidebar.inbox.elapsed.seconds", seconds)

    return seconds < 60 ? language.t("sidebar.inbox.time.now") : compact(seconds)
  }

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        id={id}
        tabIndex={navigation ? (navigation() === id ? 0 : -1) : 0}
        aria-current={props.selected ? "page" : undefined}
        data-slot="sidebar-inbox-item"
        data-status={status()}
        data-state={props.selected ? "active" : undefined}
        class="group flex h-[54px] w-full shrink-0 flex-col gap-1.5 rounded-[6px] p-2 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-overlay-simple-overlay-pressed"
        classList={{
          "transition-opacity hover:opacity-100 focus-visible:opacity-100": !props.selected,
          "opacity-50": props.archived && !props.selected,
        }}
        onClick={props.onOpen}
      >
        <span class="flex h-4 w-full min-w-0 shrink-0 items-center gap-2">
          <span class="flex size-4 shrink-0 items-center justify-center">
            <SessionTabAvatarView project={props.project} directory={props.directory} unread={false} />
          </span>
          <span
            dir="auto"
            class="min-w-0 flex-1 truncate text-[13px] leading-4 font-medium tracking-[-0.04px] text-v2-text-text-base"
          >
            {sessionTabTitle(props.title, language.t("session.tab.session"))}
          </span>
        </span>
        <span class="relative flex h-4 w-full min-w-0 shrink-0 items-center gap-2 ps-6 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted">
          <Show when={props.server}>
            {(name) => (
              <Tooltip placement="right" value={name()} class="absolute start-0 top-0 flex size-4 shrink-0">
                <Icon name="server" aria-label={name()} class="text-v2-icon-icon-muted" />
              </Tooltip>
            )}
          </Show>
          <span class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-v2-icon-icon-muted">
            <span dir="auto" class="min-w-0 truncate text-v2-text-text-muted">
              {displayName(props.project ?? { worktree: props.directory })}
            </span>
            <Show when={props.worktree}>
              <Tooltip placement="right" value={props.directory} class="flex shrink-0">
                <Icon name="outline-worktree" />
              </Tooltip>
            </Show>
            <Show when={props.branch}>
              {(name) => (
                <Tooltip placement="right" value={name()} class="flex shrink-0">
                  <Icon name="branch" />
                </Tooltip>
              )}
            </Show>
          </span>
          <span class="ms-auto flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums">
            <Show when={status() !== "ready"}>
              <span class="sr-only">{statusLabel(status())}</span>
              <Show
                when={status() === "working"}
                fallback={
                  <span
                    aria-hidden="true"
                    class="size-[7px] shrink-0 rounded-full"
                    classList={{
                      "bg-v2-state-fg-warning": status() === "approval" || status() === "input",
                      "bg-v2-state-fg-danger": status() === "failed",
                      "bg-v2-background-bg-accent": status() === "done",
                    }}
                  />
                }
              >
                <ActivityRing class="shrink-0 text-v2-icon-icon-muted" />
              </Show>
            </Show>
            {/* Announce only the state, not each age update. */}
            <Show when={age()}>
              {(label) => (
                <span aria-hidden={status() === "ready" ? undefined : "true"} class="text-v2-text-text-faint">
                  {label()}
                </span>
              )}
            </Show>
          </span>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Show
            when={props.archived}
            fallback={<Menu.Item onSelect={props.onArchive}>{language.t("common.archive")}</Menu.Item>}
          >
            <Menu.Item onSelect={props.onUnarchive}>{language.t("sidebar.inbox.unarchive")}</Menu.Item>
          </Show>
          <Menu.Separator />
          <Menu.Item onSelect={props.onDelete}>{language.t("common.delete")}…</Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}
