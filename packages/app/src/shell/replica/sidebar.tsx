import { createMemo, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import type { Project } from "@/runtime/server/types"
import { useCommand } from "@/shell/commands/command"
import { ProjectIcon } from "@/shell/layout/project-icon"
import { usePinnedSessions } from "@/session/pins"
import { sessionLabel } from "@/session/title"
import { useTabs } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { createSessionInbox, type InboxEntry } from "@/shell/titlebar/inbox-model"

const SECTION = "mb-1 px-2 text-[13px] leading-5 font-medium text-[var(--color-text-secondary)]"

const ROW =
  "flex h-[29px] w-full items-center gap-2 rounded-[var(--radius-row)] px-2 text-start text-[14px] leading-5 text-[var(--color-text-primary)]"

const LIST = "flex flex-col gap-[2px]"

/**
 * The 300px navigation column. Conversation-first: pinned conversations, then recent ones, each row carrying
 * its project's icon. Rows sit 2px apart so a selected background never reads as one continuous block.
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

  const recent = createMemo(() => {
    const pinnedIDs = new Set(pins.ids())

    return inbox
      .entries()
      .filter((entry) => !pinnedIDs.has(entry.session.id))
      .toSorted((a, b) => b.session.time.updated - a.session.time.updated)
      .slice(0, 12)
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

  const project = (entry: InboxEntry): Project | undefined => entry.ctx.projects.forSession(entry.session)

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

  return (
    <aside data-slot="replica-sidebar" data-ui="navigation-sidebar" class="flex min-h-0 flex-col">
      <div
        data-slot="replica-sidebar-header"
        data-ui="sidebar-header"
        class="flex h-[49px] shrink-0 items-center gap-1 ps-[14px] pe-2"
      >
        <button
          type="button"
          data-replica-control
          class="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 text-[19px] leading-6 font-semibold text-[var(--color-text-main)] hover:bg-[var(--color-hover)]"
          onClick={() => command.trigger("command.palette")}
        >
          <span class="min-w-0 truncate">{language.t("replica.workspace.name")}</span>
          <Icon name="fill-triangle-down" size="small" class="shrink-0 text-[var(--color-icon-secondary)]" />
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
          <Tooltip placement="bottom" value={language.t("command.session.search")}>
            <button
              type="button"
              data-replica-control
              aria-label={language.t("command.session.search")}
              class="flex size-[30px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-icon-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-icon-primary)]"
              onClick={() => command.trigger("sessions.search")}
            >
              <Icon name="magnifying-glass" />
            </button>
          </Tooltip>
        </div>
      </div>

      <button
        type="button"
        data-replica-control
        data-slot="replica-new-chat"
        class="mx-2 flex h-[37px] shrink-0 items-center gap-2 rounded-[var(--radius-row)] px-2 text-[14px] leading-5 text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
        onClick={newChat}
      >
        <Icon name="edit" class="shrink-0 text-[var(--color-icon-secondary)]" />
        <span class="min-w-0 truncate">{language.t("replica.newChat")}</span>
      </button>

      <div data-slot="replica-sidebar-scroll" class="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {pinned().length > 0 && (
          <section class="mb-2 flex flex-col">
            <h2 class={SECTION}>{language.t("replica.section.pinned")}</h2>
            <div class={LIST}>
              <For each={pinned()}>
                {(entry) => (
                  <button
                    type="button"
                    data-slot="replica-row"
                    data-ui="sidebar-row"
                    data-state={active(entry) ? "pressed" : undefined}
                    class={ROW}
                    onClick={() => open(entry)}
                  >
                    <Show
                      when={project(entry)}
                      fallback={<Icon name="folder" class="size-4 shrink-0 text-[var(--color-icon-secondary)]" />}
                    >
                      {(project) => <ProjectIcon project={project()} class="size-4 shrink-0" />}
                    </Show>
                    <span class="min-w-0 truncate">{sessionLabel(entry.session)}</span>
                  </button>
                )}
              </For>
            </div>
          </section>
        )}

        <section class="flex flex-col">
          <h2 class={SECTION}>{language.t("replica.section.recent")}</h2>
          <div class={LIST}>
            <For each={recent()}>
              {(entry) => (
                <button
                  type="button"
                  data-slot="replica-row"
                  data-ui="sidebar-row"
                  data-state={active(entry) ? "pressed" : undefined}
                  class={ROW}
                  onClick={() => open(entry)}
                >
                  <Show
                    when={project(entry)}
                    fallback={<Icon name="folder" class="size-4 shrink-0 text-[var(--color-icon-secondary)]" />}
                  >
                    {(project) => <ProjectIcon project={project()} class="size-4 shrink-0" />}
                  </Show>
                  <span class="min-w-0 truncate">{sessionLabel(entry.session)}</span>
                </button>
              )}
            </For>
          </div>
        </section>
      </div>
    </aside>
  )
}
