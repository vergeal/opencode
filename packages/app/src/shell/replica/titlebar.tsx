import { createMemo, Show } from "solid-js"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { createCNY, flashCostBreakdown } from "@opencode/gui-plugins/context/cost"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { base64Encode } from "@opencode/util/encode"
import { useGlobal } from "@/runtime/server/runtime"
import { useServers } from "@/runtime/server/registry"
import { SessionRouteKey, SessionStateKey } from "@/runtime/server/scope"
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
    const session = global.serverCtx(route.server)?.data.session.get(route.sessionId)

    if (!session) return

    return { title: session.title, directory: session.location.directory }
  }

  const cny = createMemo(() => createCNY(language.locale()))

  // The ring, the token count and the spend are one control: clicking it opens the built-in context panel next
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
    <header data-slot="replica-titlebar" data-ui="window-titlebar">
      <div
        data-slot="replica-titlebar-left"
        data-ui="titlebar-left"
        style={{ "padding-inline-start": mac() ? "70px" : "6px" }}
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
        <span class="flex min-w-0 items-center gap-2.5">
          <Icon name="titlebar-chat" size="small" class="shrink-0 text-[var(--color-icon-secondary)]" />
          <span
            class="min-w-0 max-w-[55%] shrink truncate text-[14px] leading-[17px] font-medium text-[var(--color-text-main)]"
            data-ui="titlebar-title"
          >
            {conversation()?.title ?? ""}
          </span>
          <Show when={conversation()?.directory}>
            {(directory) => (
              <span
                dir="ltr"
                title={directory()}
                data-ui="titlebar-path"
                class="min-w-0 flex-1 truncate text-[12px] leading-4 text-[var(--color-text-secondary)]"
              >
                {directory()}
              </span>
            )}
          </Show>
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
                  class="flex h-6 shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-[12px] leading-4 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-text-main)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--color-border)]"
                  onClick={openContext}
                >
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
