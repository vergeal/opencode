import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Button } from "@opencode/ui/button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { catalogModel, syncCatalog } from "./catalog"
import { createCNY, flashCostCNY } from "./cost"

export function SessionContextUsage(props: {
  session: MountedSession
  /** False while the session's view is detached; it loads nothing until selected again. */
  active?: boolean
  variant?: "button" | "indicator"
  placement?: ComponentProps<typeof Tooltip>["placement"]
  /** The button shows only its ring and opens the usage in a menu, so a narrow header keeps room for the title. */
  compact?: boolean
}) {
  const ctx = usePlugin()
  const layout = ctx.layout
  const i18n = useI18n()
  syncCatalog(
    () => props.session,
    () => props.active !== false,
  )

  const variant = createMemo(() => props.variant ?? "button")

  const messages = createMemo(() =>
    props.session.id ? props.session.server.data.session.message.list(props.session.id) : [],
  )

  const cny = createMemo(() => createCNY(i18n.locale()))

  const info = createMemo(() =>
    props.session.id ? props.session.server.data.session.get(props.session.id) : undefined,
  )

  // Same step as the TUI: after the last completed compaction and before an undo boundary.
  const context = createMemo(() => {
    const message = lastAssistantWithUsage(messages(), info()?.revert?.messageID)

    if (!message) return
    const model = catalogModel(props.session, message.model)?.model

    const total =
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write

    return {
      total,
      usage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const tokens = createMemo(() =>
    new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 0 })
      .format(context()?.total ?? 0)
      .toLocaleLowerCase(i18n.locale()),
  )

  // Priced at Flash rates for every model. A root session's cost includes its subagent sessions, as in the TUI.
  const spent = createMemo(() => {
    const id = props.session.id

    if (!id) return 0

    const session = props.session.server.data.session.get(id)

    if (!session) return 0

    if (session.parentID) return flashCostCNY([session.tokens])

    const family = props.session.server.data.session.family(id)

    return flashCostCNY(
      (family.length ? family : [id]).flatMap((member) => props.session.server.data.session.get(member)?.tokens ?? []),
    )
  })

  const cost = createMemo(() => cny()(spent()))

  // Every token has a Flash price, so any recorded usage carries a cost.
  const showCost = createMemo(() => spent() > 0)

  const openContext = () => {
    if (!props.session.id) return
    layout.toggle(`${ctx.id}:main`, props.session)
  }

  const viewContext = () => {
    if (!props.session.id) return
    layout.open(`${ctx.id}:main`, props.session)
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        appearance="indicator"
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
        style={{
          "--progress-circle-background": "var(--v2-background-bg-layer-04)",
          "--progress-circle-background-overlay": "var(--v2-overlay-simple-overlay-pressed, transparent)",
          "--progress-circle-progress": "var(--v2-icon-icon-base, var(--icon-base))",
        }}
      />
    </div>
  )

  const compactCircle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle appearance="compact" size={16} percentage={context()?.usage ?? 0} />
    </div>
  )

  const menuRow = (name: JSX.Element, value: JSX.Element) => (
    <div class="flex h-7 min-w-0 items-center gap-4 px-3 text-[13px] font-[440] leading-[var(--line-height-compact)] tracking-[-0.04px]">
      <span class="shrink-0 text-v2-text-text-muted">{name}</span>
      <span class="ml-auto min-w-0 truncate text-right tabular-nums text-v2-text-text-base">{value}</span>
    </div>
  )

  const usageMenu = () => (
    <Menu placement="bottom-end" gutter={4} modal={false}>
      <Tooltip value={ctx.t("usage.view")} placement={props.placement ?? "top"}>
        <Menu.Trigger
          as={Button}
          type="button"
          variant="ghost-muted"
          class="group shrink-0"
          style={{ padding: "0 6px", color: "var(--v2-text-text-faint)" }}
          aria-label={ctx.t("usage.view")}
        >
          {compactCircle()}
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Content class="w-[200px] max-w-[calc(100vw-16px)]" aria-label={ctx.t("usage.view")}>
          {menuRow(ctx.t("usage.tokens"), context()?.total.toLocaleString(i18n.locale()) ?? "0")}
          <Show when={showCost()}>{menuRow(ctx.t("usage.cost"), cost())}</Show>
          {menuRow(ctx.t("usage.usage"), `${context()?.usage ?? 0}%`)}
          <Menu.Separator />
          <Menu.Item onSelect={viewContext}>{ctx.t("usage.view")}</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )

  return (
    <Show when={props.session.id}>
      <Show when={!props.compact} fallback={usageMenu()}>
        <Show
          when={variant() === "indicator"}
          fallback={
            <Tooltip value={ctx.t("usage.toggle")} placement={props.placement ?? "top"}>
              <Button
                type="button"
                variant="ghost-muted"
                class="group shrink-0"
                style={{ padding: "0 6px", color: "var(--v2-text-text-faint)" }}
                onClick={openContext}
                aria-expanded={layout.state(`${ctx.id}:main`, props.session) === "visible"}
                aria-label={ctx.t("usage.toggle")}
              >
                <span class="flex items-center gap-2 whitespace-nowrap group-active:text-v2-text-text-muted">
                  {compactCircle()}
                  <span>{tokens()}</span>
                  <Show when={showCost()}>
                    <span aria-hidden="true" class="flex w-1.5 shrink-0 items-center justify-center">
                      ·
                    </span>
                    <span>{cost()}</span>
                  </Show>
                </span>
              </Button>
            </Tooltip>
          }
        >
          {circle()}
        </Show>
      </Show>
    </Show>
  )
}
