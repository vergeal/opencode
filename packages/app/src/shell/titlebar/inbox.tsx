import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { createEffect, createMemo, For, Show, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
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

// `since` is when the inbox was first used; Recent only lists sessions that finished a run after it.
const InboxState = Persistence.struct({
  workingExpanded: Schema.Boolean,
  archivedExpanded: Schema.Boolean,
  expandedProjects: Schema.Array(Schema.String),
  since: Persistence.optional(Schema.Number),
})

/** The experimental Inbox interface mode: the session inbox in place of vertical tabs. */
export function SidebarInbox() {
  const language = useLanguage()
  const dialog = useDialog()
  const inbox = createSessionInbox({ archived: true })
  const pins = usePinnedSessions()

  const [state, setState, , ready] = persisted(Persist.global("sidebar.inbox"), InboxState, {
    workingExpanded: true,
    archivedExpanded: false,
    expandedProjects: [],
  })

  // Projects behave like folders: every one starts collapsed and remembers being opened.
  const projectExpanded = (key: string) => state.expandedProjects.includes(key)

  const toggleProject = (key: string) =>
    setState(
      "expandedProjects",
      state.expandedProjects.includes(key)
        ? state.expandedProjects.filter((item) => item !== key)
        : [...state.expandedProjects, key],
    )

  const sections = createMemo(() => {
    const list = inbox.entries()
    const pinnedIDs = new Set(pins.ids())
    const pinned = pins.ids().flatMap((id) => {
      const entry = list.find((item) => item.session.id === id)

      return entry ? [entry] : []
    })
    const rest = list.filter((entry) => !pinnedIDs.has(entry.session.id))
    // The most recently finished session comes first.
    const finished = rest
      .filter((entry) => {
        const since = state.since

        return !inboxBusy(entry.status) && since !== undefined && (entry.session.time.idle ?? 0) >= since
      })
      .toSorted((a, b) => (b.session.time.idle ?? 0) - (a.session.time.idle ?? 0))

    return {
      pinned,
      needs: rest.filter((entry) => entry.status === "approval" || entry.status === "input"),
      inbox: finished.filter((entry) => !inboxArchived(entry)),
      archived: finished.filter(inboxArchived),
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
    const groups = new Map<string, { key: string; name: string; entries: InboxEntry[] }>()

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
        entries: [entry],
      })
    })

    return [...groups.values()]
  }

  const groupedInbox = createMemo(() => projectGroups(sections().inbox))

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

    inbox.loadBranches([
      ...visible.pinned,
      ...visible.needs,
      ...visible.working,
      ...expanded(visible.inbox),
      ...(state.archivedExpanded ? visible.archived : []),
    ])
  })

  function DeleteDialog(props: { entry: InboxEntry }) {
    const confirm = async () => {
      await inbox.remove(props.entry)
      pins.remove([props.entry.session.id])
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

  const rows = (list: InboxEntry[], showProjectName = true) => (
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
              showProjectName={showProjectName}
              onTogglePin={() => pins.toggle(entry().session.id)}
              onOpen={() => inbox.open(entry())}
              onArchive={() => void inbox.archive(entry())}
              onUnarchive={() => void inbox.unarchive(entry())}
              onDelete={() => dialog.show(() => <DeleteDialog entry={entry()} />)}
            />
          )}
        </Show>
      )}
    </For>
  )

  return (
    <div data-slot="sidebar-inbox" class="flex min-h-0 flex-1 flex-col">
      <div
        data-slot="sidebar-inbox-scroll"
        class="-me-2.5 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-1 pe-2.5"
      >
        <Show when={sections().pinned.length > 0}>
          <div class="flex shrink-0 flex-col gap-px">
            <SectionHeader label={language.t("home.sessions.group.pinned")} />
            {rows(sections().pinned)}
          </div>
        </Show>
        <Show when={sections().needs.length > 0}>
          <div class="flex shrink-0 flex-col gap-px" classList={{ "mt-3": sections().pinned.length > 0 }}>
            <SectionHeader label={language.t("sidebar.inbox.section.needsAttention")} count={sections().needs.length} />
            {rows(sections().needs)}
          </div>
        </Show>
        {/* The project list starts a new block, so it gets its own divider and heading. */}
        <Show when={sections().pinned.length > 0 || sections().needs.length > 0}>
          <div class="my-[9px] h-px w-full shrink-0 bg-v2-border-border-muted" aria-hidden="true" />
        </Show>
        <Show
          when={sections().inbox.length > 0}
          fallback={
            <Show
              when={
                sections().needs.length === 0 && sections().working.length === 0 && sections().archived.length === 0
              }
            >
              <div class="px-1.5 py-2 text-[15px] leading-4 text-v2-text-text-faint">
                {language.t("sidebar.inbox.empty")}
              </div>
            </Show>
          }
        >
          <div class="flex shrink-0 flex-col gap-px">
            <SectionHeader label={language.t("sidebar.inbox.section.projects")} />
            <For each={groupedInbox()}>
              {(group) => (
                <div class="flex shrink-0 flex-col gap-px">
                  <FolderRow
                    label={group.name}
                    count={group.entries.length}
                    expanded={projectExpanded(group.key)}
                    onToggle={() => toggleProject(group.key)}
                  />
                  <Show when={projectExpanded(group.key)}>
                    <div class="flex flex-col gap-px ps-2">{rows(group.entries, false)}</div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        {/* Archived is a folder of its own, separated from the project list above. */}
        <Show when={sections().archived.length > 0}>
          <Show when={sections().inbox.length > 0}>
            <div class="my-[9px] h-px w-full shrink-0 bg-v2-border-border-muted" aria-hidden="true" />
          </Show>
          <div class="flex shrink-0 flex-col gap-px">
            <FolderRow
              label={language.t("sidebar.inbox.section.archived")}
              count={sections().archived.length}
              expanded={state.archivedExpanded}
              onToggle={() => setState("archivedExpanded", !state.archivedExpanded)}
            />
            <Show when={state.archivedExpanded}>
              <div class="flex flex-col gap-px ps-2">{rows(sections().archived)}</div>
            </Show>
          </div>
        </Show>
      </div>
      {/* Working sessions sit in a shelf pinned below the scrolling list. */}
      <Show when={sections().working.length > 0}>
        <div
          data-slot="sidebar-inbox-working"
          class="flex max-h-[40%] shrink-0 flex-col gap-px border-t border-v2-border-border-muted pt-1.5"
        >
          <SectionHeader
            label={language.t("sidebar.inbox.section.working")}
            count={sections().working.length}
            expanded={state.workingExpanded}
            onToggle={() => setState("workingExpanded", !state.workingExpanded)}
          />
          <div class="flex min-h-0 flex-col gap-px overflow-y-auto">
            {/* A collapsed shelf still shows the session that is open. */}
            {rows(sections().working.filter((entry) => state.workingExpanded || inbox.selected(entry)))}
          </div>
        </div>
      </Show>
    </div>
  )
}

/** A folder row: folded by default, opening it reveals the sessions inside. */
function FolderRow(props: { label: string; count: number; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      class={`
        flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-start
        text-[13px] leading-4 font-medium text-v2-text-text-muted
        hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base
        focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
      `}
      onClick={props.onToggle}
    >
      <Icon name="folder" size="small" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <span class="shrink-0 tabular-nums text-v2-text-text-faint">{props.count}</span>
      <Icon
        name="chevron-down"
        size="small"
        class="shrink-0 transition-transform"
        classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
      />
    </button>
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
        <div class="flex h-6 shrink-0 items-center gap-1.5 px-1.5 text-[13px] leading-4 font-medium text-v2-text-text-muted">
          {content()}
        </div>
      }
    >
      {(toggle) => (
        <button
          type="button"
          aria-expanded={props.expanded}
          class="flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-start text-[13px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
          onClick={toggle()}
        >
          {content()}
        </button>
      )}
    </Show>
  )
}

function InboxRow(props: {
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
}) {
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
        class="group flex w-full shrink-0 flex-col gap-1 rounded-[8px] px-2 py-1.5 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-background-bg-layer-02"
        classList={{
          "transition-opacity hover:opacity-100 focus-visible:opacity-100": !props.selected,
          "opacity-70": status() === "working" && !props.selected,
          "opacity-50": props.archived && !props.selected,
        }}
        onContextMenu={(event) => {
          if (!nativeMenu()) return
          event.preventDefault()
          void showNativeMenu({ x: event.clientX, y: event.clientY })
        }}
        onClick={props.onOpen}
      >
        <span class="flex h-5 w-full min-w-0 items-center gap-1.5">
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
            class="min-w-0 flex-1 truncate text-[13px] leading-5"
            // Rows recede once read so unread results stand out.
            classList={{
              "font-medium text-v2-text-text-base": unread(),
              "text-v2-text-text-muted": !unread(),
            }}
          >
            {title()}
          </span>
          <span
            class="shrink-0 text-[12px] leading-4 tabular-nums text-v2-text-text-faint"
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
                  {/* Keep the status colour under the sweep. */}
                  <span
                    aria-hidden="true"
                    class="[&_[data-component=text-shimmer]]:[--text-shimmer-base-color:var(--v2-state-fg-info)]"
                  >
                    <TextShimmer text={language.t("sidebar.inbox.status.workingFor", { duration: elapsed() })} active />
                  </span>
                </Show>
              </span>
            </Show>
          </span>
        </span>
        <Show when={showSecondary()}>
          <span class="flex h-4 w-full min-w-0 items-center gap-1.5 text-[12px] leading-4 text-v2-text-text-faint">
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
