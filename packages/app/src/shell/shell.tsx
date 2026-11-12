import { createEffect, createSignal, lazy, onCleanup, Show, Suspense, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useDialog } from "@opencode/ui/context/dialog"
import { ToastRegion } from "@/shell/notifications/toast"
import { UploadToastHost } from "@/composer/attachments/uploads"
import { useSettings } from "@/settings/model"
import { useSettingsDialog } from "@/settings/command"
import { PluginServerCover } from "@/runtime/plugin/server-shell"
import { PluginSlot } from "@/runtime/plugin/render"
import { COMMAND_SEARCH_ID, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs, type DraftTab } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { useNavigate } from "@solidjs/router"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { DestinationToggle } from "@/shell/titlebar/destination-toggle"
import { createSessionInbox } from "@/shell/titlebar/inbox-model"
import { InboxProvider } from "@/inbox/context"
import { KnowledgeProvider } from "@/knowledge/context"
import { ScheduledProvider } from "@/scheduled/context"
import { ReplicaRail } from "./replica/rail"
import { ReplicaSidebar } from "./replica/sidebar"
import { ReplicaTitleBar } from "./replica/titlebar"
import "./replica/replica.css"

const DraftPage = lazy(() => import("@/new-session/route").then((module) => ({ default: module.DraftPage })))

export const sidebarToggleCommand = { id: "sidebar.toggle", keybind: "mod+shift+b" }

/**
 * The replica workbench frame: a 27px window bar over a 36px rail, a 239px sidebar and the remaining white
 * canvas. Pages keep their routes and data; the empty home route shows the new-conversation welcome.
 */
export default function Layout(props: ParentProps) {
  return (
    <InboxProvider>
      <ScheduledProvider>
        <KnowledgeProvider>
          <ReplicaLayer {...props} />
        </KnowledgeProvider>
      </ScheduledProvider>
    </InboxProvider>
  )
}

/**
 * Home is the new-chat page itself: the ChangHong wordmark and the composer, rendered in place instead of a
 * separate welcome screen. It opens the most recent draft, or starts one when none is open.
 */
function HomeNewChat() {
  const tabs = useTabs()
  const global = useGlobal()
  const [draft, setDraft] = createSignal<DraftTab>()

  createEffect(() => {
    if (!tabs.ready()) return

    const open = tabs.store.findLast((tab): tab is DraftTab => tab.type === "draft")

    if (open) {
      setDraft(open)

      return
    }

    const conn = global.servers.list()[0]
    if (!conn) return
    const ctx = global.serverCtx(ServerConnection.key(conn))
    if (!ctx) return

    const directory = ctx.projects.last()?.worktree ?? ctx.projects.list()[0]?.worktree
    if (!directory) return

    void tabs
      .newDraft({ server: ServerConnection.key(conn), directory }, undefined, undefined, { navigate: false })
      .then((tab) => setDraft(tab))
  })

  return (
    <Show when={draft()}>
      {(value) => (
        <Suspense>
          <DraftPage draft={value()} />
        </Suspense>
      )}
    </Show>
  )
}

function ReplicaLayer(props: ParentProps) {
  const preferences = useSettings()
  const command = useCommand()
  const language = useLanguage()
  const platform = usePlatform()
  const openSettings = useSettingsDialog()
  const dialog = useDialog()
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()
  const layout = useLayout()
  const navigate = useNavigate()
  const mobile = createMediaQuery("(max-width: 767px)")
  const sessionInbox = createSessionInbox()

  const pendingInbox = () =>
    sessionInbox
      .entries()
      .filter((entry) => entry.status === "approval" || entry.status === "input" || entry.status === "failed").length

  // The v6 column is 300px until dragging pins an explicit width, so the resize handle starts from the width
  // the sidebar is really laid out at instead of snapping to another value on the first move.
  // The macOS window sits on a blurred material, so the page root drops its opaque theme fill and the
  // translucent frame shows the desktop instead. Other platforms keep the painted background.
  createEffect(() => {
    document.documentElement.dataset.replicaWindow =
      platform.platform === "desktop" && platform.os === "macos" ? "translucent" : "opaque"
  })

  const [sidebarWidth, setSidebarWidth] = createSignal<number>()
  const [resizing, setResizing] = createSignal(false)
  const sidebarSize = () => sidebarWidth() ?? 300

  let root: HTMLDivElement | undefined
  let draggingWidth: number | undefined
  let frame = 0

  // Dragging writes the width straight to the root's CSS variable, coalesced to one write per frame, so pointer moves
  // never re-render the shell. The signal catches up once, when the pointer is released and the width is committed.
  const writeSidebarWidth = (width: number) => {
    draggingWidth = width

    if (frame) return

    frame = requestAnimationFrame(() => {
      frame = 0

      if (draggingWidth === undefined) return
      root?.style.setProperty("--navigation-sidebar-width-current", showSidebar() ? `${draggingWidth}px` : "0px")
    })
  }

  const commitSidebarWidth = () => {
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }

    const width = draggingWidth
    draggingWidth = undefined

    if (width !== undefined) setSidebarWidth(width)
  }

  const onDraggingChange = (value: boolean) => {
    setResizing(value)
    if (!value) commitSidebarWidth()
  }

  onCleanup(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  const sidebarOpen = () => preferences.appearance.sidebarOpen()
  const toggleSidebar = () => preferences.appearance.setSidebarOpen(!sidebarOpen())
  // Settings ships its own category column and search, so the navigation sidebar would duplicate it.
  const showSidebar = () => !mobile() && sidebarOpen() && layout.route().type !== "settings"
  const welcome = () => layout.route().type === "home"

  command.register("sidebar", () => [
    {
      ...sidebarToggleCommand,
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      onSelect: toggleSidebar,
    },
  ])

  const destinations = [
    { id: "destination.home", path: "/", titleKey: "home.title", keybind: "mod+1" },
    { id: "destination.inbox", path: "/inbox", titleKey: "inbox.title", keybind: "mod+2" },
    { id: "destination.knowledge", path: "/knowledge", titleKey: "knowledge.title", keybind: "mod+3" },
    { id: "destination.scheduled", path: "/scheduled", titleKey: "scheduled.title", keybind: "mod+4" },
  ] as const

  command.register("destinations", () =>
    destinations.map((item) => ({
      id: item.id,
      title: language.t(item.titleKey),
      category: language.t("command.category.view"),
      keybind: item.keybind,
      onSelect: () => navigate(item.path),
    })),
  )

  command.register("palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const conn = servers.visible.find((item) => servers.current(item)) ?? servers.visible[0]

        if (!conn) return
        const { HomeCommandPalette } = await import("@/home/start/command-palette")
        void dialog.show(() => (
          <HomeCommandPalette
            server={conn}
            onSelectSession={(entry) => {
              if (!entry.sessionID || !entry.directory || !entry.server) return
              const sessionID = entry.sessionID
              const server = entry.server
              global.serverCtx(server)?.projects.touch(entry.project?.worktree ?? entry.directory)
              void tabs.select(tabs.addSessionTab({ server, sessionId: sessionID }))
            }}
          />
        ))
      },
    },
  ])
  command.register("commands", () => [
    {
      id: COMMAND_SEARCH_ID,
      title: language.t("command.commands.search"),
      category: language.t("command.category.view"),
      onSelect: async () => {
        const { DialogCommandSearch } = await import("@/shell/commands/command-search")
        void dialog.show(() => <DialogCommandSearch />)
      },
    },
  ])

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
    <div
      ref={root}
      data-replica
      class="relative flex min-h-0 min-w-0 flex-1 select-none flex-col [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      data-resizing={resizing() ? "" : undefined}
      style={{
        "--navigation-sidebar-width-current": showSidebar() ? `${sidebarSize()}px` : "0px",
      }}
    >
      <ReplicaTitleBar
        sidebarOpen={sidebarOpen()}
        onToggleSidebar={toggleSidebar}
        onMore={() => command.trigger("command.palette")}
        onView={openSettings}
        onAdd={newChat}
      />

      <div data-slot="replica-shell">
        <Show when={!mobile()}>
          <ReplicaRail />
        </Show>

        <div data-slot="replica-workbench">
          <div
            data-slot="replica-sidebar-slot"
            data-collapsed={showSidebar() ? undefined : ""}
            class="relative flex min-h-0 min-w-0"
          >
            <ReplicaSidebar />
            <Show when={showSidebar()}>
              <ResizeHandle
                direction="horizontal"
                edge="end"
                size={sidebarSize()}
                min={220}
                max={480}
                onResize={writeSidebarWidth}
                onDraggingChange={onDraggingChange}
              />
            </Show>
          </div>

          <main
            data-slot="replica-main"
            data-ui="main-workspace"
            class="relative flex min-h-0 min-w-0 flex-col"
            style={{
              "--shell-inline-inset": "0px",
              "--shell-top-inset": "0px",
              "--shell-bottom-inset": "0px",
              "--shell-panel-radius": "0px",
            }}
          >
            <Show
              when={welcome()}
              fallback={
                <PluginServerCover>
                  <Suspense>{props.children}</Suspense>
                </PluginServerCover>
              }
            >
              <HomeNewChat />
            </Show>
          </main>
        </div>
      </div>

      <Show when={mobile()}>
        <nav
          data-slot="destination-bar"
          class="relative z-10 flex shrink-0 items-stretch border-t border-[var(--color-divider)] bg-[var(--color-titlebar)] px-2 pt-1 pb-[env(safe-area-inset-bottom,0px)] [height:calc(52px+env(safe-area-inset-bottom,0px))] [&_[data-slot=destination-toggle]]:h-full [&_button]:h-full"
        >
          <DestinationToggle
            pressed={(id) => layout.route().type === id}
            pending={pendingInbox()}
            onSelect={(id) => navigate(id === "home" ? "/" : `/${id}`)}
          />
        </nav>
      </Show>

      <div data-slot="composer-touch-bar-mount" class="order-last shrink-0" />
      <PluginSlot at="window.bottom" input={{}} />
      <ToastRegion />
      <UploadToastHost />
    </div>
  )
}
