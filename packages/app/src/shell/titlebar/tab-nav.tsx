import { createEffect, createMemo, createSignal, onCleanup, Show, type Ref } from "solid-js"
import { createStore } from "solid-js/store"
import { initialTabNavState, transitionTabNav, type TabNavEvent, type TabNavState } from "./tab-nav-machine"
import { Predicate } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { useServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { usePinnedSessions } from "@/session/pins"
import { SessionMenuCopyID } from "@/session/menu-items"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useSettingsSurface } from "@/settings/surface"
import { displayName } from "@opencode/ui/project-avatar"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import type { SessionInfo } from "@opencode/client/promise"
import { sessionTabTitle } from "./tab-title"
import { TabPreviewPopover } from "./tab-popover"
import "./tab-nav.css"

// MouseEvent.button uses 1 for the middle/wheel button.
const MIDDLE_MOUSE_BUTTON = 1

export type TabCloseActions = {
  onClose: () => void
  onCloseOthers?: () => void
  onCloseAfter?: () => void
}

function TabCloseMenuItems(props: TabCloseActions & { orientation?: "horizontal" | "vertical" }) {
  const language = useLanguage()

  return (
    <>
      <Menu.Item onSelect={props.onClose}>{language.t("common.closeTab")}</Menu.Item>
      <Menu.Item disabled={!props.onCloseOthers} onSelect={props.onCloseOthers}>
        {language.t("common.closeOtherTabs")}
      </Menu.Item>
      <Menu.Item disabled={!props.onCloseAfter} onSelect={props.onCloseAfter}>
        {language.t(
          props.orientation === "vertical"
            ? "common.closeTabsBelow"
            : language.direction() === "rtl"
              ? "common.closeTabsToLeft"
              : "common.closeTabsToRight",
        )}
      </Menu.Item>
    </>
  )
}

export function TabNavItem(
  props: TabCloseActions & {
    ref?: Ref<HTMLDivElement>
    href: string
    server: ServerConnection.Key
    session: SessionInfo | undefined
    preparing: boolean
    unread: boolean
    attention: boolean
    loading: boolean
    fallbackTitle?: string
    fallbackDirectory?: string
    onRename: (title: string) => Promise<void>
    onDelete: () => void
    onSessionSettings?: () => void
    onNavigate: () => void
    active?: boolean
    suppressNavigation?: boolean
    dragging?: boolean
    pressed?: boolean
    hidden?: boolean
    orientation?: "horizontal" | "vertical"
  },
) {
  const language = useLanguage()
  const pins = usePinnedSessions()
  const settings = useSettingsSurface()
  const [nav, setNav] = createStore<TabNavState>(initialTabNavState)
  const dispatch = (event: TabNavEvent) => setNav(transitionTabNav(nav, event))
  const editing = () => nav.overlay === "editing"
  const menuOpen = () => nav.overlay === "menu"
  const [titleOverflowing, setTitleOverflowing] = createSignal(false)
  let tabRoot!: HTMLDivElement
  let titleEl!: HTMLSpanElement
  let measureFrame: number | undefined

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  const servers = useServers()
  const serverCtx = useServerCtx(() => servers.list.find((item) => ServerConnection.key(item) === props.server))

  // The project icon stays put; status shows where the close button appears on hover.
  const status = () => {
    if (props.preparing || props.loading) return "busy"

    if (!props.session || props.active) return

    if (props.attention) return "attention"

    if (props.unread) return "unread"
  }

  const dotted = () => status() === "attention" || status() === "unread"

  const project = createMemo(() => {
    const session = props.session

    if (session) return serverCtx()?.projects.forSession(session)

    if (!props.fallbackDirectory) return

    return serverCtx()?.projects.forDirectory(props.fallbackDirectory) ?? { worktree: props.fallbackDirectory }
  })

  const title = createMemo(() => {
    const session = props.session

    return sessionTabTitle(session ? session.title : props.fallbackTitle, language.t("session.tab.session"))
  })

  const projectName = createMemo(() => {
    const session = props.session

    if (!session) return

    return displayName(project() ?? { worktree: session.location.directory })
  })

  const previewPath = createMemo(() => {
    const session = props.session

    if (!session) return
    const home = serverCtx()?.sync.data.path.home
    const directory = session.location.directory

    if (!home || !directory.startsWith(home) || !/^([/\\]|$)/.test(directory.slice(home.length))) return directory

    return "~" + directory.slice(home.length)
  })

  // Only label the server when multiple servers are connected, and never the current one.
  const serverLabel = createMemo(() => {
    if (servers.list.length <= 1) return
    const conn = servers.list.find((item) => ServerConnection.key(item) === props.server)

    return conn ? servers.tag(conn) : undefined
  })

  // Like the TUI, a prompt sent to a background tab's session pulses the tab once.
  createEffect(() => {
    const data = serverCtx()?.data
    const sessionID = props.session?.id

    if (!data || !sessionID) return
    onCleanup(
      data.on("session.inbox.enqueued", (event) => {
        if (props.active || event.data.item.type !== "user" || data.session.root(event.data.sessionID) !== sessionID)
          return
        dispatch({ type: "pulse" })
      }),
    )
  })

  const previewOpen = () => nav.overlay === "preview"
  const previewBlocked = () => !!props.dragging || editing() || menuOpen() || !!props.pressed || !props.session

  const measureTitleOverflow = () => {
    if (!titleEl || editing()) {
      setTitleOverflowing(false)

      return
    }

    setTitleOverflowing(titleEl.scrollWidth > titleEl.clientWidth)
  }

  const scheduleTitleOverflow = () => {
    if (measureFrame !== undefined) return
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined
      measureTitleOverflow()
    })
  }

  createEffect(() => {
    title()
    props.active
    props.orientation
    editing()
    scheduleTitleOverflow()
  })

  // The overflow fade changes title padding; observe the stable tab box, not that feedback.
  createResizeObserver(() => tabRoot, scheduleTitleOverflow)
  onCleanup(() => {
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
  })

  const selectTitle = () => {
    const range = document.createRange()
    range.selectNodeContents(titleEl)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const closeRename = async (save: boolean) => {
    if (!editing()) return

    const original = props.session?.title ?? ""
    const next = (titleEl.textContent ?? "").trim()

    titleEl.scrollLeft = 0
    dispatch({ type: "rename.end" })

    if (!save || !next || next === original) {
      return
    }

    await props.onRename(next)
  }

  createEffect(() => {
    if (editing()) return

    if (!titleEl) return
    const value = title()

    if (value === undefined) return
    titleEl.textContent = value
  })

  const openRename = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()

    if (props.dragging || editing()) return
    const session = props.session

    if (!session) return
    titleEl.textContent = session.title ?? ""
    dispatch({ type: "rename.begin" })

    requestAnimationFrame(() => {
      titleEl.focus()
      selectTitle()
    })
  }

  createEffect(() => {
    if (!editing()) return

    const cleanup = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        const target = event.target

        if (!(target instanceof Node)) return

        if (tabRoot.contains(target)) return
        void closeRename(true)
      },
      { capture: true },
    )

    onCleanup(cleanup)
  })

  const tab = () => (
    <div
      ref={(el) => {
        tabRoot = el

        if (Predicate.isFunction(props.ref)) props.ref(el)
      }}
      data-titlebar-tab
      data-slot="titlebar-tab-item"
      data-orientation={props.orientation ?? "horizontal"}
      data-title-overflow={titleOverflowing()}
      data-editing={editing()}
      class="group relative flex h-7 w-full min-w-0 select-none flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full px-1.5 [container-type:inline-size]"
      classList={{ invisible: props.hidden }}
      data-active={props.active}
      data-status={status()}
      data-dragging={props.dragging}
      data-state={props.active || props.pressed ? "pressed" : undefined}
      onMouseDown={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onAuxClick={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        closeTab(event)
      }}
    >
      <Show when={nav.pulse} keyed>
        <span data-slot="tab-prompt-pulse" aria-hidden="true" onAnimationEnd={() => dispatch({ type: "pulse.clear" })} />
      </Show>
      <Menu.Context.Trigger
        as="a"
        disabled={editing() || props.dragging}
        aria-haspopup="menu"
        aria-expanded={menuOpen()}
        data-slot="tab-link"
        data-titlebar-tab-link
        href={props.href}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onMouseDown={(event) => {
          // Navigate on mousedown to shave the press-release delay off tab switches.
          if (event.button !== 0) return

          if (editing()) return

          if (props.suppressNavigation) return
          props.onNavigate()
        }}
        onClick={(event) => {
          event.preventDefault()

          // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
          if (event.detail > 0) return

          if (editing()) return

          if (props.suppressNavigation) return
          props.onNavigate()
        }}
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-2 text-[13px] leading-[var(--line-height-compact)] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base group-data-[editing='true']:text-v2-text-text-base [-webkit-user-drag:none]"
      >
        <span data-slot="project-avatar-slot" class="flex size-4 shrink-0 items-center justify-center">
          <Show
            when={props.session?.location.directory ?? props.fallbackDirectory}
            fallback={
              <span class="block size-4 rounded-[3px] border border-v2-border-border-muted" aria-hidden="true" />
            }
          >
            {(directory) => <SessionTabAvatarView project={project()} directory={directory()} unread={false} />}
          </Show>
          <Show when={dotted()}>
            <span data-slot="tab-avatar-unread-dot" aria-hidden="true" />
          </Show>
        </span>
        <span
          ref={(el) => {
            titleEl = el
            titleEl.textContent = title() ?? ""
          }}
          data-slot="tab-title"
          data-titlebar-tab-title
          dir="auto"
          class="min-w-0 flex-1 outline-none leading-4"
          classList={{
            "overflow-hidden text-clip whitespace-nowrap": !editing(),
            "select-text": editing(),
          }}
          contenteditable={editing() ? "plaintext-only" : undefined}
          onDblClick={openRename}
          onKeyDown={(event) => {
            event.stopPropagation()

            if (event.key === "Enter") {
              event.preventDefault()
              void closeRename(true)

              return
            }

            if (event.key !== "Escape") return
            event.preventDefault()
            titleEl.textContent = props.session?.title ?? ""
            void closeRename(false)
          }}
          onBlur={() => void closeRename(true)}
          onPointerDown={(event) => {
            if (!editing()) return
            event.stopPropagation()
          }}
          onClick={(event) => {
            if (!editing()) return
            event.preventDefault()
          }}
        />
      </Menu.Context.Trigger>

      <div data-slot="tab-close">
        <span data-slot="tab-status" aria-hidden="true">
          <ActivityRing data-mark="busy" />
          <span data-mark="attention" data-slot="tab-status-dot" />
          <span data-mark="unread" data-slot="tab-status-dot" />
        </span>
        <IconButton
          size="small"
          variant="ghost-muted"
          class="hover-reveal relative z-10"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={closeTab}
          icon={<Icon name="xmark-small" />}
          aria-label={language.t("common.closeTab")}
        />
      </div>
    </div>
  )

  return (
    <Menu.Context
      modal={false}
      onOpenChange={(open) => {
        dispatch({ type: open ? "menu.open" : "menu.close" })
      }}
    >
      <TabPreviewPopover
        trigger={tab()}
        orientation={props.orientation}
        open={previewOpen() && !previewBlocked()}
        onOpenChange={(value) => {
          if (value && previewBlocked()) return
          dispatch({ type: value ? "preview.open" : "preview.close" })
        }}
        data={{
          projectName: projectName(),
          title: props.session?.title,
          path: previewPath(),
          serverName: serverLabel(),
        }}
      />
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            if (!nav.renamePending) return
            event.preventDefault()
            openRename()
          }}
        >
          <Menu.Group>
            <Menu.GroupLabel>{language.t("menu.group.organize")}</Menu.GroupLabel>
            <Menu.Item disabled={!props.session} onSelect={() => props.session && pins.toggle(props.session.id)}>
              {props.session && pins.isPinned(props.session.id) ? language.t("common.unpin") : language.t("common.pin")}
            </Menu.Item>
            <Menu.Item disabled={!props.session} onSelect={() => dispatch({ type: "rename.request" })}>
              {language.t("common.rename")}
            </Menu.Item>
            <TabCloseMenuItems
              orientation={props.orientation}
              onClose={props.onClose}
              onCloseOthers={props.onCloseOthers}
              onCloseAfter={props.onCloseAfter}
            />
          </Menu.Group>
          <Menu.Separator />
          <Menu.Group>
            <Menu.GroupLabel>{language.t("menu.group.copyExport")}</Menu.GroupLabel>
            <SessionMenuCopyID sessionID={props.session?.id} />
          </Menu.Group>
          <Menu.Separator />
          <Menu.Group>
            <Menu.GroupLabel>{language.t("menu.group.settings")}</Menu.GroupLabel>
            <Menu.Item disabled={!props.session} onSelect={() => props.onSessionSettings?.()}>
              {language.t("session.settings.menu")}…
            </Menu.Item>
            <Menu.Item
              disabled={!props.session || !project()?.worktree}
              onSelect={() => {
                const directory = project()?.worktree

                if (directory) settings.openProject({ server: props.server, project: directory })
              }}
            >
              {language.t("project.settings.menu")}…
            </Menu.Item>
          </Menu.Group>
          <Menu.Separator />
          <Menu.Group>
            <Menu.GroupLabel>{language.t("menu.group.danger")}</Menu.GroupLabel>
            <Menu.Item data-variant="critical" disabled={!props.session} onSelect={props.onDelete}>
              {language.t("session.delete.title")}…
            </Menu.Item>
          </Menu.Group>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

export function DraftTabItem(
  props: TabCloseActions & {
    ref?: Ref<HTMLDivElement>
    href: string
    title: string
    active?: boolean
    onNavigate: () => void
    suppressNavigation?: boolean
    dragging?: boolean
    pressed?: boolean
    hidden?: boolean
    orientation?: "horizontal" | "vertical"
  },
) {
  const language = useLanguage()

  const [menu, setMenu] = createStore({ open: false })

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  return (
    <Menu.Context modal={false} onOpenChange={(open) => setMenu("open", open)}>
      <div
        ref={(el) => {
          if (Predicate.isFunction(props.ref)) props.ref(el)
        }}
        data-titlebar-tab
        data-slot="titlebar-tab-item"
        data-orientation={props.orientation ?? "horizontal"}
        data-active={props.active}
        data-dragging={props.dragging}
        data-state={props.active || props.pressed ? "pressed" : undefined}
        class="group relative flex h-7 w-full min-w-0 flex-row items-center gap-1.5 overflow-hidden rounded-full px-1.5 [container-type:inline-size] whitespace-nowrap"
        classList={{ invisible: props.hidden }}
        onMouseDown={(event) => {
          if (event.button !== MIDDLE_MOUSE_BUTTON) return
          event.preventDefault()
          event.stopPropagation()
        }}
        onAuxClick={(event) => {
          if (event.button !== MIDDLE_MOUSE_BUTTON) return
          closeTab(event)
        }}
      >
        <Menu.Context.Trigger
          as="a"
          disabled={props.dragging}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          data-slot="tab-link"
          data-titlebar-tab-link
          href={props.href}
          draggable={false}
          onDragStart={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onMouseDown={(event) => {
            // Navigate on mousedown to shave the press-release delay off tab switches.
            if (event.button !== 0) return

            if (props.suppressNavigation) return
            props.onNavigate()
          }}
          onClick={(event) => {
            event.preventDefault()

            // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
            if (event.detail > 0) return

            if (props.suppressNavigation) return
            props.onNavigate()
          }}
          class="flex h-full min-w-0 flex-1 flex-row items-center gap-2 text-[13px] leading-[var(--line-height-compact)] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base [-webkit-user-drag:none]"
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <svg
              class="text-v2-icon-icon-muted group-data-[active='true']:text-v2-icon-icon-base"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M9.00002 13.5H14M2.60419 10.9167V13.3958H5.08335L13.3959 5.08333L10.9167 2.60416L2.60419 10.9167Z"
                stroke="currentColor"
              />
            </svg>
          </span>
          <span
            data-titlebar-tab-title
            class="min-w-0 flex-1 overflow-hidden text-clip whitespace-nowrap outline-none leading-4"
          >
            {props.title}
          </span>
        </Menu.Context.Trigger>
        <div data-slot="tab-close">
          <IconButton
            size="small"
            variant="ghost-muted"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            class="hover-reveal relative z-10"
            onClick={closeTab}
            icon={<Icon name="xmark-small" />}
            aria-label={language.t("common.closeTab")}
          />
        </div>
      </div>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <TabCloseMenuItems
            orientation={props.orientation}
            onClose={props.onClose}
            onCloseOthers={props.onCloseOthers}
            onCloseAfter={props.onCloseAfter}
          />
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}
