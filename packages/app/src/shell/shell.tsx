import { createSignal, onCleanup, onMount, Show, Suspense, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useDialog } from "@opencode/ui/context/dialog"
import { ToastRegion } from "@/shell/notifications/toast"
import { UploadToastHost } from "@/composer/attachments/uploads"
import { useSettings } from "@/settings/model"
import { PluginServerCover } from "@/runtime/plugin/server-shell"
import { PluginSlot } from "@/runtime/plugin/render"
import { COMMAND_SEARCH_ID, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { useLayout } from "@/shell/state/layout"
import { useNavigate } from "@solidjs/router"
import { ResizeHandle } from "@opencode/ui/resize-handle"
import { DestinationToggle } from "@/shell/titlebar/destination-toggle"
import { createSessionInbox } from "@/shell/titlebar/inbox-model"
import { ReplicaRail } from "./replica/rail"
import { ReplicaSidebar } from "./replica/sidebar"
import { ReplicaTitleBar } from "./replica/titlebar"
import { ReplicaWelcome } from "./replica/welcome"
import "./replica/replica.css"

export const sidebarToggleCommand = { id: "sidebar.toggle", keybind: "mod+shift+b" }

/**
 * The replica workbench frame: a 27px window bar over a 36px rail, a 239px sidebar and the remaining white
 * canvas. Pages keep their routes and data; the empty home route shows the new-conversation welcome.
 */
export default function Layout(props: ParentProps) {
  const preferences = useSettings()
  const command = useCommand()
  const language = useLanguage()
  const dialog = useDialog()
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()
  const layout = useLayout()
  const navigate = useNavigate()
  const mobile = createMediaQuery("(max-width: 767px)")
  const sessionInbox = createSessionInbox()
  // The chrome converts its screenshot height with the window's real density, which changes when the window
  // moves between displays.
  const [dpr, setDpr] = createSignal(window.devicePixelRatio || 1)
  onMount(() => {
    const update = () => setDpr(window.devicePixelRatio || 1)
    window.addEventListener("resize", update)
    onCleanup(() => window.removeEventListener("resize", update))
  })

  const pendingInbox = () =>
    sessionInbox
      .entries()
      .filter((entry) => entry.status === "approval" || entry.status === "input" || entry.status === "failed").length

  // Untouched, the sidebar keeps the reference 21.4%; dragging pins an explicit pixel width.
  const [sidebarWidth, setSidebarWidth] = createSignal<number>()
  const sidebarSize = () => sidebarWidth() ?? Math.round(window.innerWidth * 0.214)

  const sidebarOpen = () => preferences.appearance.sidebarOpen()
  const toggleSidebar = () => preferences.appearance.setSidebarOpen(!sidebarOpen())
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

  return (
    <div
      data-replica
      class="relative flex min-h-0 min-w-0 flex-1 select-none flex-col bg-[var(--main-bg)] [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
    >
      <ReplicaTitleBar sidebarOpen={sidebarOpen()} onToggleSidebar={toggleSidebar} />

      <div
        data-slot="replica-shell-body"
        data-sidebar={sidebarOpen() ? "open" : "closed"}
        class="flex min-h-0 min-w-0 flex-1"
        style={{ "--replica-dpr": String(dpr()) }}
      >
        <div data-slot="replica-workbench">
          <Show when={!mobile()}>
            <ReplicaRail />
          <Show when={sidebarOpen()}>
            <div
              data-slot="replica-sidebar-slot"
              class="relative flex min-h-0"
              style={{ flex: sidebarWidth() ? `0 0 ${sidebarWidth()}px` : undefined }}
            >
              <ReplicaSidebar />
              <ResizeHandle
                direction="horizontal"
                edge="end"
                size={sidebarSize()}
                min={180}
                max={480}
                onResize={setSidebarWidth}
              />
            </div>
          </Show>
        </Show>

        <main
          data-slot="replica-main"
          data-welcome={welcome() ? "" : undefined}
          class="relative flex min-h-0 min-w-0 flex-1 flex-col"
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
            <ReplicaWelcome />
          </Show>
          </main>
        </div>
      </div>

      <Show when={mobile()}>
        <nav
          data-slot="destination-bar"
          class="relative z-10 flex shrink-0 items-stretch border-t border-[var(--border-subtle)] bg-[var(--app-chrome)] px-2 pt-1 pb-[env(safe-area-inset-bottom,0px)] [height:calc(52px+env(safe-area-inset-bottom,0px))] [&_[data-slot=destination-toggle]]:h-full [&_button]:h-full"
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
