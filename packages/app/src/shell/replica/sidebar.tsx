import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useCommand } from "@/shell/commands/command"
import { useTabs } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { createMemo } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { createSessionInbox } from "@/shell/titlebar/inbox-model"
import { SidebarOrganized } from "@/shell/titlebar/sidebar-organized"

/**
 * The 239px column: the workspace title, one new-chat entry, then the real project and session tree. The tree keeps
 * its own scrolling and its existing open, rename, delete and pin actions.
 */
export function ReplicaSidebar() {
  const language = useLanguage()
  const navigate = useNavigate()
  const command = useCommand()
  const tabs = useTabs()
  const layout = useLayout()
  const global = useGlobal()

  // The route already names the open tab; look it up locally instead of running a second route sync.
  const currentTab = createMemo(() => {
    const route = layout.route()

    if (route.type === "session") return tabs.sessionTab(route.server, route.sessionId)

    if (route.type === "draft")
      return tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
  })

  const inbox = createSessionInbox()

  const pending = () =>
    inbox
      .entries()
      .filter((entry) => entry.status === "approval" || entry.status === "input" || entry.status === "failed").length

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

  return (
    <aside data-slot="replica-sidebar" class="flex min-h-0 shrink-0 flex-col">
      <div class="flex h-9 shrink-0 items-center gap-1 ps-2.5 pe-1.5">
        <button
          type="button"
          data-replica-control
          class="flex min-w-0 items-center gap-1 rounded-[5px] px-1 py-0.5 text-[14px] leading-5 font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          onClick={() => command.trigger("command.palette")}
        >
          <span class="min-w-0 truncate">{language.t("replica.workspace.name")}</span>
          <Icon name="fill-triangle-down" size="small" class="shrink-0 text-[var(--icon-secondary)]" />
        </button>
        <div class="ms-auto flex shrink-0 items-center gap-0.5">
          <Tooltip placement="bottom" value={language.t("inbox.title")}>
            <button
              type="button"
              data-replica-control
              aria-label={language.t("inbox.title")}
              class="relative flex size-6 items-center justify-center rounded-[5px] text-[var(--icon-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--icon-primary)]"
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
              class="flex size-6 items-center justify-center rounded-[5px] text-[var(--icon-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--icon-primary)]"
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
        class="mx-2 mb-1 flex h-7 shrink-0 items-center gap-2 rounded-[7px] px-2 text-[13px] leading-5 text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
        onClick={newChat}
      >
        <Icon name="edit" size="small" class="shrink-0 text-[var(--icon-secondary)]" />
        <span class="min-w-0 truncate">{language.t("replica.newChat")}</span>
      </button>

      <div class="min-h-0 flex-1">
        <SidebarOrganized currentTab={currentTab()}>
          {() => <></>}
        </SidebarOrganized>
      </div>
    </aside>
  )
}
