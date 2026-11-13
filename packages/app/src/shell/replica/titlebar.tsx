import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { createCNY, flashCostBreakdown } from "@opencode/gui-plugins/context/cost"
import { Icon } from "@opencode/ui/icon"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { base64Encode } from "@opencode/util/encode"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { SessionRouteKey, SessionStateKey } from "@/runtime/server/scope"
import { SessionLocation } from "@/session/session-identity-header"
import { useCommand } from "@/shell/commands/command"
import { goBackCommand, goForwardCommand } from "@/shell/titlebar/history-commands"
import { createTitlebarHistory } from "@/shell/titlebar/history-store"
import { useLayout } from "@/shell/state/layout"
import { findSessionTab, useTabs } from "@/shell/tabs/tabs"

const BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-icon-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-icon-primary)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--color-icon-secondary)] disabled:opacity-40 disabled:pointer-events-none"

/**
 * The window bar, split at the sidebar boundary. The left half owns the traffic lights and navigation
 * controls; the right half shows the open conversation and the window actions.
 */
export function ReplicaTitleBar(props: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onMore: () => void
  onView: () => void
  onAdd: () => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const layout = useLayout()
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()
  const command = useCommand()
  const history = createTitlebarHistory()
  const mac = () => platform.platform === "desktop" && platform.os === "macos"

  let bar!: HTMLElement

  // The traffic lights are native and stay 14pt while the renderer scales, so their fixed position drifts
  // below the bar's centre as soon as the interface zoom is not 1. Keep their centre on the bar's centre the
  // way the full titlebar does: row centre in window points, minus half a button.
  createEffect(() => {
    if (!mac()) return

    const scale = platform.webviewZoom?.() ?? 1

    const frame = requestAnimationFrame(() => {
      const bounds = bar.getBoundingClientRect()

      void platform.setTrafficLightsPosition?.({
        x: 14,
        y: Math.round((bounds.top + bounds.height / 2) * scale - 7),
      })
    })

    onCleanup(() => cancelAnimationFrame(frame))
  })

  // Hand the buttons back at the window's default position; whatever bar mounts next owns them again.
  onCleanup(() => {
    if (!mac()) return
    void platform.setTrafficLightsPosition?.({ x: 14, y: 14 })
  })

  const back = history.back
  const forward = history.forward

  command.register(() => [
    {
      ...goBackCommand,
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      onSelect: back,
    },
    {
      ...goForwardCommand,
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      onSelect: forward,
    },
  ])

  const conversation = () => {
    const route = layout.route()

    if (route.type !== "session") return
    const ctx = global.serverCtx(route.server)
    const session = ctx?.data.session.get(route.sessionId)
    const conn = servers.list.find((item) => ServerConnection.key(item) === route.server)

    if (!ctx || !session) return

    return {
      title: session.title,
      directory: session.location.directory,
      // The native session bar already knows how to name a project, its worktree or its branch; the titlebar reuses
      // it instead of showing the raw directory.
      project: ctx.projects.forSession(session),
      server: conn ? { conn, key: route.server, ctx } : undefined,
    }
  }

  const cny = createMemo(() => createCNY(language.locale()))  // The ring, the token count and the spend are one control: clicking it opens the built-in context panel next
  // to the conversation, the same panel the plugin's own indicator opens.
  const openContext = () => {
    const route = layout.route()

    if (route.type !== "session") return
    const session = global.serverCtx(route.server)?.data.session.get(route.sessionId)

    if (!session) return

    layout.panel.open(
      SessionStateKey.from(
        servers.scope(route.server),
        SessionRouteKey.fromRoute(base64Encode(session.location.directory), session.id),
      ),
      "context:main",
    )

    const tab = findSessionTab(tabs.store, route.server, route.sessionId)
    if (tab) tabs.setRegion(tab, "side", true)
  }

  // The conversation title is edited in place, the way session rows and tab titles do it: double-click opens
  // the editor, Enter or an outside click saves, Escape restores.
  let titleElement!: HTMLSpanElement

  const [titleState, setTitleState] = createStore({ editing: false })

  createEffect(() => {
    if (!titleElement || titleState.editing) return

    titleElement.textContent = conversation()?.title ?? ""
  })

  const beginRename = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    if (titleState.editing) return
    const current = conversation()

    if (!titleElement || !current) return
    titleElement.textContent = current.title ?? ""
    setTitleState("editing", true)

    requestAnimationFrame(() => {
      titleElement.focus()
      const range = document.createRange()
      range.selectNodeContents(titleElement)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const commitRename = async (save: boolean) => {
    if (!titleState.editing) return

    const original = conversation()?.title ?? ""
    const next = (titleElement.textContent ?? "").trim()
    setTitleState("editing", false)
    titleElement.textContent = original

    if (!save || !next || next === original) return

    const route = layout.route()

    if (route.type !== "session") return
    const ctx = global.serverCtx(route.server)
    const session = ctx?.data.session.get(route.sessionId)

    if (!ctx || !session) return

    await ctx.sdk.api.session
      .update({ sessionID: session.id, title: next })
      .then(() => {
        ctx.data.session.remember({ ...session, title: next })
        // A rename advances time.updated server-side, so re-read the canonical record.
        ctx.data.session.invalidate(session.id)
        void ctx.data.session.sync(session.id).catch(() => undefined)
      })
      .catch(() => undefined)
  }

  createEffect(() => {
    if (!titleState.editing) return

    const cleanup = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        const target = event.target

        if (!(target instanceof Node)) return
        if (titleElement.contains(target)) return
        // A pointer that lands before the editor took focus belongs to whatever is still closing, not to
        // an outside click on the editor.
        if (document.activeElement !== titleElement) return
        void commitRename(true)
      },
      { capture: true },
    )

    onCleanup(cleanup)
  })

  // Shown beside the ring the way the reference reads: 15万 in Chinese, 150K in English.
  const compact = createMemo(
    () => new Intl.NumberFormat(language.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  // Same accounting as the context panel: context after the last compaction, spend across the session family.
  const usage = () => {
    const route = layout.route()

    if (route.type !== "session") return
    const ctx = global.serverCtx(route.server)
    const session = ctx?.data.session.get(route.sessionId)

    if (!ctx || !session) return
    const message = lastAssistantWithUsage(ctx.data.session.message.list(session.id), session.revert?.messageID)

    if (!message) return
    const directory = session.location.directory
    const model = ctx.data.location.model
      .list(directory ? { directory } : undefined)
      ?.findLast(
        (item) =>
          item.providerID === message.model.providerID && item.id === message.model.id && item.status !== "deprecated",
      )
    const tokens =
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write
    const family = ctx.data.session.family(session.id)
    const spend = flashCostBreakdown(
      session.parentID
        ? [session.tokens]
        : (family.length ? family : [session.id]).flatMap((id) => ctx.data.session.get(id)?.tokens ?? []),
    )

    return {
      tokens,
      cost: spend.total,
      usage: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : 0,
    }
  }

  return (
    <header ref={bar} data-slot="replica-titlebar" data-ui="window-titlebar">
      <div
        data-slot="replica-titlebar-left"
        data-ui="titlebar-left"
        // Line the navigation controls up with the workspace name in the sidebar column below: rail + gutter + the
        // header's own inset, minus the button's share around its 14px icon.
        style={{
          "padding-inline-start": mac()
            ? "70px"
            : "calc(var(--primary-rail-width) + 1px + var(--sidebar-header-padding-inline) + 4px - 7px)",
        }}
      >
        <button
          type="button"
          data-replica-control
          class={BUTTON}
          aria-label={language.t("replica.titlebar.back")}
          disabled={!history.canBack()}
          onClick={back}
        >
          <Icon name="outline-arrow-left" size="small" />
        </button>
        <button
          type="button"
          data-replica-control
          class={BUTTON}
          aria-label={language.t("replica.titlebar.forward")}
          disabled={!history.canForward()}
          onClick={forward}
        >
          <Icon name="outline-arrow-right" size="small" />
        </button>
        <button
          type="button"
          data-replica-control
          class={BUTTON}
          aria-label={language.t("replica.titlebar.sidebar")}
          aria-pressed={props.sidebarOpen}
          onClick={props.onToggleSidebar}
        >
          <Icon name="outline-sliders" size="small" />
        </button>
      </div>

      <div data-slot="replica-titlebar-main" data-ui="titlebar-main">
        <span class="flex min-w-0 flex-1 items-center gap-2.5">
          <Icon name="titlebar-chat" size="small" class="shrink-0 text-[var(--color-icon-secondary)]" />
          <Show when={conversation()}>
            {(value) => (
              <Show when={value().server}>
                {(server) => (
                  <SessionLocation
                    server={server()}
                    project={value().project}
                    directory={value().directory}
                    branchInline
                    trailing
                  />
                )}
              </Show>
            )}
          </Show>
          <span
            ref={titleElement}
            class="min-w-0 max-w-[55%] shrink text-[14px] leading-[17px] font-medium text-[var(--color-text-main)] outline-none"
            classList={{ truncate: !titleState.editing, "cursor-text select-text": titleState.editing }}
            contenteditable={titleState.editing ? "plaintext-only" : undefined}
            data-ui="titlebar-title"
            dir="auto"
            onDblClick={beginRename}
            onKeyDown={(event) => {
              if (!titleState.editing) return
              event.stopPropagation()

              if (event.key === "Enter") {
                event.preventDefault()
                void commitRename(true)

                return
              }

              if (event.key !== "Escape") return
              event.preventDefault()
              void commitRename(false)
            }}
            onBlur={() => {
              // Losing the window is not the user leaving the editor; keep it open so the rename survives.
              if (!document.hasFocus()) return
              void commitRename(true)
            }}
          />
        </span>

        <Show when={usage()}>
          {(value) => (
            <div class="ms-auto flex shrink-0 items-center">
              <Tooltip
                placement="bottom"
                value={
                  <div class="flex flex-col gap-0.5 text-start">
                    <span>
                      {language.t("replica.context.tokens")}: {value().tokens.toLocaleString(language.locale())}
                    </span>
                    <span>
                      {language.t("replica.context.cost")}: {cny()(value().cost)}
                    </span>
                    <span>
                      {language.t("replica.context.usage")}: {value().usage}%
                    </span>
                  </div>
                }
              >
                <button
                  type="button"
                  data-ui="titlebar-context"
                  data-replica-control
                  aria-label={language.t("replica.context.open")}
                  class="flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] leading-4 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-selected)] hover:text-[var(--color-text-main)] active:bg-[var(--color-selected)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--color-border)]"
                  onClick={openContext}
                >
                  <ProgressCircle
                    data-ui="titlebar-context-progress"
                    appearance="indicator"
                    size={14}
                    strokeWidth={2}
                    percentage={value().usage}
                    style={{
                      "--progress-circle-background": "var(--color-border)",
                      "--progress-circle-progress": "var(--color-icon-secondary)",
                    }}
                  />
                  <span data-ui="titlebar-context-tokens" class="shrink-0 tabular-nums">
                    {compact().format(value().tokens)}
                  </span>
                  <span class="shrink-0 tabular-nums text-[var(--color-text-tertiary)]">{cny()(value().cost)}</span>
                </button>
              </Tooltip>
            </div>
          )}
        </Show>
      </div>
    </header>
  )
}
