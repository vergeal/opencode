import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { createEffect, createMemo, For, Show, type JSX } from "solid-js"
import { DragDropProvider, PointerSensor, type DragDropProviderProps } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@/runtime/array-move"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { displayName } from "@opencode/ui/project-avatar"
import { useServers } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { usePinnedSessions } from "@/session/pins"
import { Persist, persisted } from "@/runtime/persistence/storage"
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

// `since` is when the inbox was first used; Recent only lists sessions that finished a run after it.
const InboxState = Persistence.struct({
  workingExpanded: Schema.Boolean,
  expandedProjects: Schema.Array(Schema.String),
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
    expandedProjects: [],
    order: {},
  })

  // Projects behave like folders: every one starts collapsed and remembers being opened.
  const projectExpanded = (key: string) => state.expandedProjects.includes(key)

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

  // The inbox starts empty and fills as sessions finish runs.
  createEffect(() => {
    if (ready() && state.since === undefined) setState("since", Date.now())
  })

  // Git info is not stored on the session, so eagerly load it for every shown row. Folded folders and collapsed
  // sections are skipped until the person opens them, since each lookup runs git on the server.
  createEffect(() => {
    const visible = sections()
    const expanded = (list: InboxEntry[]) => list.filter((entry) => projectExpanded(projectKey(entry)))

    inbox.loadBranches([...visible.pinned, ...visible.needs, ...visible.working, ...expanded(visible.inbox)])
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

  const rows = (
    list: InboxEntry[],
    container: string,
    options: { showProjectName?: boolean; disabled?: boolean } = {},
  ) => (
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
              now={inbox.now()}
              branchLoading={inbox.branchLoading(entry())}
              branch={inbox.branch(entry())}
              worktree={inbox.inWorktree(entry())}
              archived={inboxArchived(entry())}
              pinned={pins.isPinned(entry().session.id)}
              showProjectName={options.showProjectName ?? true}
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
              now={inbox.now()}
              branchLoading={inbox.branchLoading(entry())}
              branch={inbox.branch(entry())}
              worktree={inbox.inWorktree(entry())}
              archived={inboxArchived(entry())}
              pinned={pins.isPinned(entry().session.id)}
              showProjectName
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
              onToggle={() => setState("workingExpanded", !state.workingExpanded)}
            />
            <div class="flex min-h-0 flex-col gap-[2px] overflow-y-auto">
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

function SectionHeader(props: { label: string; count?: number; expanded?: boolean; onToggle?: () => void }) {
  const content = (): JSX.Element => (
    <>
      <span class="min-w-0 truncate">{props.label}</span>
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
        <div data-slot="sidebar-section-label" class="flex shrink-0 items-center gap-1.5 text-v2-text-text-faint">
          {content()}
        </div>
      }
    >
      {(toggle) => (
        <button
          type="button"
          data-slot="sidebar-section-label"
          aria-expanded={props.expanded}
          class="flex w-full shrink-0 items-center gap-1.5 rounded-[6px] text-start text-v2-text-text-faint hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
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
  branchLoading: boolean
  branch: string | undefined
  worktree: boolean
  archived: boolean
  pinned: boolean
  showProjectName: boolean
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
  const servers = useServers()
  const platform = usePlatform()
  const nativeMenu = () => !!platform.showContextMenu
  const project = createMemo(() => props.entry.ctx.projects.forSession(props.entry.session))
  const projectName = () => displayName(project() ?? { worktree: props.entry.session.location.directory })
  const title = () => sessionTabTitle(props.entry.session.title, language.t("session.tab.session"))
  const status = () => props.entry.status
  const unread = () => status() !== "ready" && status() !== "working"
  const showLocation = () => props.branchLoading || !!props.branch || props.worktree
  // A project header above the row already names the project, so the row only adds its branch.
  const showSecondary = () => props.showProjectName || showLocation() || !!servers.tag(props.entry.conn)

  // Sessions on the current server are not marked.
  const tag = () => servers.tag(props.entry.conn)

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
        { type: "separator" },
        { id: "delete", label: `${language.t("common.delete")}…` },
      ],
      position,
    )

    if (chosen === "pin") props.onTogglePin()
    else if (chosen === "archive") props.onArchive()
    else if (chosen === "unarchive") props.onUnarchive()
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
        class="group flex w-full shrink-0 flex-col gap-[2px] rounded-[6px] px-2 py-1 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-background-bg-layer-03"
        classList={{
          "transition-opacity hover:opacity-100 focus-visible:opacity-100": !props.selected,
          "opacity-70": status() === "working" && !props.selected,
        }}
        onContextMenu={(event) => {
          if (!nativeMenu()) return
          event.preventDefault()
          void showNativeMenu({ x: event.clientX, y: event.clientY })
        }}
        onClick={props.onOpen}
      >
        <span class="flex h-4 w-full min-w-0 items-center gap-1.5">
          <span class="flex size-4 shrink-0 items-center justify-center">
            <SessionTabAvatarView
              project={project()}
              directory={props.entry.session.location.directory}
              unread={false}
            />
          </span>
          <span
            dir="auto"
            title={title()}
            class="min-w-0 flex-1 truncate text-[13px] leading-4"
            // Rows recede once read so unread results stand out.
            classList={{
              "font-medium text-v2-text-text-base": unread(),
              "text-v2-text-text-muted": !unread(),
            }}
          >
            {title()}
          </span>
          <span
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
                <Show
                  when={status() === "working"}
                  fallback={language.t(`sidebar.inbox.status.${status() as Exclude<InboxStatus, "ready">}`)}
                >
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
        </span>
        <Show when={showSecondary()}>
          <span class="flex h-3.5 w-full min-w-0 items-center gap-1.5 text-[11px] leading-[14px] text-v2-text-text-faint">
            <Show when={props.showProjectName}>
              <span class="min-w-0 max-w-[46%] truncate" title={projectName()}>
                {projectName()}
              </span>
            </Show>
            <Show when={props.branchLoading}>
              <span
                aria-hidden="true"
                class="h-2 w-16 max-w-full animate-pulse rounded-full bg-v2-background-bg-layer-03"
              />
            </Show>
            <Show when={!props.branchLoading && (props.branch || props.worktree)}>
              <Show when={props.showProjectName}>
                <span aria-hidden="true" class="shrink-0">
                  ·
                </span>
              </Show>
              <span class="flex min-w-0 items-center gap-1">
                {/* The worktree icon stands in for the branch icon to mark sessions outside the project checkout. */}
                <Icon name={props.worktree ? "outline-worktree" : "branch"} size="small" class="shrink-0" />
                <Show when={props.branch}>
                  {(name) => (
                    <span dir="ltr" class="min-w-0 truncate">
                      {name()}
                    </span>
                  )}
                </Show>
              </span>
            </Show>
            <Show when={tag()}>
              {(name) => (
                <Tooltip placement="right" value={name()} class="ms-auto flex shrink-0">
                  <Icon name="server" size="small" aria-label={name()} />
                </Tooltip>
              )}
            </Show>
          </span>
        </Show>
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

  createEffect(() => inbox.loadBranches(archived()))

  return (
    <Dialog
      fit
      size="large"
      containerClass="archived-sessions-dialog !h-auto !w-[min(calc(100vw_-_32px),560px)] !rounded-[12px]"
    >
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
                  now={inbox.now()}
                  branchLoading={inbox.branchLoading(entry)}
                  branch={inbox.branch(entry)}
                  worktree={inbox.inWorktree(entry)}
                  archived
                  pinned={pins.isPinned(entry.session.id)}
                  showProjectName
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
        <Button variant="ghost" autofocus onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" onClick={confirm}>
          {language.t("session.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
