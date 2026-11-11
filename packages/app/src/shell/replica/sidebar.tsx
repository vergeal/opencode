import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode/ui/icon"
import { displayName } from "@opencode/ui/project-avatar"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import type { Project } from "@/runtime/server/types"
import { useCommand } from "@/shell/commands/command"
import { usePinnedSessions } from "@/session/pins"
import { sessionLabel } from "@/session/title"
import { useTabs } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { createSessionInbox, type InboxEntry } from "@/shell/titlebar/inbox-model"

type ProjectGroup = { key: string; project: Project; entries: InboxEntry[] }

/**
 * The 21.4% navigation column. It mirrors the reference hierarchy: workspace header, new chat, the pinned
 * conversations, then the project folders with their conversations nested under the expanded one.
 */
export function ReplicaSidebar() {
  const language = useLanguage()
  const navigate = useNavigate()
  const command = useCommand()
  const tabs = useTabs()
  const layout = useLayout()
  const global = useGlobal()
  const inbox = createSessionInbox()
  const pins = usePinnedSessions()

  const [state, setState] = createStore<{ expanded: Record<string, boolean>; ready: boolean }>({
    expanded: {},
    ready: false,
  })

  const pending = () =>
    inbox
      .entries()
      .filter((entry) => entry.status === "approval" || entry.status === "input" || entry.status === "failed").length

  const pinned = createMemo(() => {
    const byID = new Map(inbox.entries().map((entry) => [entry.session.id, entry]))

    return pins.ids().flatMap((id) => {
      const entry = byID.get(id)

      return entry ? [entry] : []
    })
  })

  const groups = createMemo<ProjectGroup[]>(() => {
    const list = global.servers.list().flatMap((conn) => {
      const server = ServerConnection.key(conn)
      const ctx = global.serverCtx(server)

      if (!ctx) return []

      return ctx.projects.list().map((project) => ({ server, ctx, project }))
    })

    const byProject = new Map<string, InboxEntry[]>()

    inbox.entries().forEach((entry) => {
      const project = entry.ctx.projects.forSession(entry.session)

      if (!project) return
      const key = `${entry.server}:${project.id}`
      const bucket = byProject.get(key)

      if (bucket) bucket.push(entry)

      if (!bucket) byProject.set(key, [entry])
    })

    return list.map(({ server, project }) => ({
      key: `${server}:${project.id}`,
      project,
      entries: (byProject.get(`${server}:${project.id}`) ?? []).toSorted(
        (a, b) => b.session.time.updated - a.session.time.updated,
      ),
    }))
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

  const expanded = (group: ProjectGroup) => {
    if (!state.ready) return group.key === groups().at(0)?.key

    return !!state.expanded[group.key]
  }

  return (
    <aside data-slot="replica-sidebar" class="flex min-h-0 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-1 ps-4 pe-2">
        <button
          type="button"
          data-replica-control
          class="flex min-w-0 items-center gap-1 rounded-[var(--radius-xs)] px-1 py-0.5 text-[15px] leading-5 font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          onClick={() => command.trigger("command.palette")}
        >
          <span class="min-w-0 truncate">{language.t("replica.workspace.name")}</span>
          <Icon name="fill-triangle-down" size="small" class="shrink-0 text-[var(--icon-secondary)]" />
        </button>
        <div class="ms-auto flex shrink-0 items-center gap-1">
          <Tooltip placement="bottom" value={language.t("inbox.title")}>
            <button
              type="button"
              data-replica-control
              aria-label={language.t("inbox.title")}
              class="relative flex size-6 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--icon-primary)]"
              onClick={() => navigate("/inbox")}
            >
              <Icon name="notifications" size="small" />
              {pending() > 0 && (
                <span class="absolute end-1 top-1 size-1.5 rounded-full bg-[var(--status-blue)]" aria-hidden="true" />
              )}
            </button>
          </Tooltip>
          <Tooltip placement="bottom" value={language.t("command.session.search")}>
            <button
              type="button"
              data-replica-control
              aria-label={language.t("command.session.search")}
              class="flex size-6 items-center justify-center rounded-[var(--radius-xs)] text-[var(--icon-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--icon-primary)]"
              onClick={() => command.trigger("sessions.search")}
            >
              <Icon name="magnifying-glass" size="small" />
            </button>
          </Tooltip>
        </div>
      </div>

      <button
        type="button"
        data-replica-control
        data-slot="replica-new-chat"
        class="mx-2 flex h-7 shrink-0 items-center gap-2.5 rounded-[var(--radius-row)] px-2.5 text-[14px] leading-5 text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
        onClick={newChat}
      >
        <Icon name="edit" size="small" class="shrink-0 text-[var(--icon-secondary)]" />
        <span class="min-w-0 truncate">{language.t("replica.newChat")}</span>
      </button>

      <div data-slot="replica-sidebar-scroll" class="mt-1 min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        <Show when={pinned().length > 0}>
          <section class="mb-2 flex flex-col">
            <h2 class="mb-0.5 px-1 text-[12px] leading-5 font-medium text-[var(--text-secondary)]">
              {language.t("replica.section.pinned")}
            </h2>
            <For each={pinned()}>
              {(entry) => (
                <button
                  type="button"
                  data-slot="replica-row"
                  data-state={active(entry) ? "pressed" : undefined}
                  class="flex min-h-6 w-full items-center rounded-[var(--radius-row)] px-1 text-start text-[13px] leading-5 text-[var(--text-primary)]"
                  onClick={() => open(entry)}
                >
                  <span class="min-w-0 truncate">{sessionLabel(entry.session)}</span>
                </button>
              )}
            </For>
          </section>
        </Show>

        <section class="flex flex-col">
          <h2 class="mb-0.5 flex items-center gap-0.5 px-1 text-[12px] leading-5 font-medium text-[var(--text-secondary)]">
            {language.t("replica.section.projects")}
            <Icon name="fill-triangle-down" size="small" class="text-[var(--icon-secondary)]" />
          </h2>

          <For each={groups()}>
            {(group) => (
              <div class="flex flex-col">
                <button
                  type="button"
                  data-slot="replica-row"
                  data-state={expanded(group) ? "pressed" : undefined}
                  class="flex min-h-[26px] w-full items-center gap-2 rounded-[var(--radius-row)] px-1 text-start text-[13px] leading-5 text-[var(--text-primary)]"
                  aria-expanded={expanded(group)}
                  onClick={() => {
                    setState("ready", true)
                    setState("expanded", group.key, (value) => !value)
                  }}
                >
                  <Icon name="folder" size="small" class="shrink-0 text-[var(--icon-secondary)]" />
                  <span class="min-w-0 flex-1 truncate">{displayName(group.project)}</span>
                  <Show when={expanded(group)}>
                    <Icon
                      name="fill-triangle-down"
                      size="small"
                      class="shrink-0 text-[var(--icon-secondary)]"
                      style={{ transform: "rotate(180deg)" }}
                    />
                  </Show>
                </button>

                <Show when={expanded(group)}>
                  <Show
                    when={group.entries.length > 0}
                    fallback={
                      <p class="ps-[22px] pe-1 py-1 text-[12px] leading-5 text-[var(--text-tertiary)]">
                        {language.t("replica.project.empty")}
                      </p>
                    }
                  >
                    <div class="flex flex-col ps-[22px]">
                      <For each={group.entries}>
                        {(entry) => (
                          <div
                            data-slot="replica-row"
                            data-state={active(entry) ? "pressed" : undefined}
                            class="group flex min-h-6 w-full items-center rounded-[var(--radius-row)] pe-1"
                          >
                            <button
                              type="button"
                              class="flex min-w-0 flex-1 items-center px-1 text-start text-[13px] leading-5 text-[var(--text-primary)]"
                              onClick={() => open(entry)}
                            >
                              <span class="min-w-0 truncate">{sessionLabel(entry.session)}</span>
                            </button>
                            <button
                              type="button"
                              data-slot="replica-row-action"
                              data-replica-control
                              aria-label={language.t(pins.isPinned(entry.session.id) ? "replica.unpin" : "replica.pin")}
                              class="flex h-5 shrink-0 items-center rounded-[var(--radius-xs)] px-1 text-[10px] leading-4 text-[var(--icon-secondary)] hover:bg-[var(--surface-selected)] hover:text-[var(--icon-primary)]"
                              onClick={() => pins.toggle(entry.session.id)}
                            >
                              {language.t(pins.isPinned(entry.session.id) ? "replica.unpin" : "replica.pin")}
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            )}
          </For>
        </section>
      </div>
    </aside>
  )
}
