import { createMemo, Show } from "solid-js"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { createCNY, flashCostBreakdown } from "@opencode/gui-plugins/context/cost"
import { Icon } from "@opencode/ui/icon"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { useCommand } from "@/shell/commands/command"
import { goBackCommand, goForwardCommand } from "@/shell/titlebar/titlebar"
import { useLayout } from "@/shell/state/layout"

const BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-icon-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-icon-primary)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--color-icon-secondary)]"

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
  const command = useCommand()
  const mac = () => platform.platform === "desktop" && platform.os === "macos"

  const back = () => window.history.back()
  const forward = () => window.history.forward()

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

  // Same accounting as the context panel: context after the last compaction, spend across the session family.
  const usage = () => {
    const route = layout.route()

    if (route.type !== "session") return
    const ctx = global.serverCtx(route.server)
    const session = ctx?.data.session.get(route.sessionId)

    if (!ctx || !session) return
    const message = lastAssistantWithUsage(
      ctx.data.session.message.list(session.id),
      session.revert?.messageID,
    )

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
        : (family.length ? family : [session.id]).flatMap(
            (id) => ctx.data.session.get(id)?.tokens ?? [],
          ),
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
          onClick={back}
        >
          <Icon name="outline-arrow-left" size="small" />
        </button>
        <button
          type="button"
          data-replica-control
          class={BUTTON}
          aria-label={language.t("replica.titlebar.forward")}
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
              <span
                data-ui="titlebar-context-usage"
                class="ms-auto flex shrink-0 items-center gap-2 ps-3 text-[12px] leading-4 text-[var(--color-text-secondary)]"
              >
                <ProgressCircle
                  appearance="indicator"
                  size={16}
                  strokeWidth={2}
                  percentage={value().usage}
                  style={{
                    "--progress-circle-background": "var(--color-border)",
                    "--progress-circle-progress": "var(--color-icon-primary)",
                  }}
                />
                <span class="shrink-0 tabular-nums">{cny()(value().cost)}</span>
              </span>
            </Tooltip>
          )}
        </Show>
      </div>
    </header>
  )
}
