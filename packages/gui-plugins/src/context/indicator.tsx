import { Popover } from "@kobalte/core/popover"
import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "@opencode/ui/context/i18n"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { catalogModel, syncCatalog } from "./catalog"
import { createCNY, flashCostBreakdown, flashPrice } from "./cost"

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
  const spend = createMemo(() => {
    const id = props.session.id

    if (!id) return

    const session = props.session.server.data.session.get(id)

    if (!session) return

    if (session.parentID) return flashCostBreakdown([session.tokens])

    const family = props.session.server.data.session.family(id)

    return flashCostBreakdown(
      (family.length ? family : [id]).flatMap((member) => props.session.server.data.session.get(member)?.tokens ?? []),
    )
  })

  const spent = createMemo(() => spend()?.total ?? 0)

  const cost = createMemo(() => cny()(spent()))

  const number = createMemo(() => new Intl.NumberFormat(i18n.locale()))

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

  const priceRow = (label: string, line: { tokens: number; amount: number }, price: number) => (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-[12px] leading-4 text-v2-text-text-muted">{label}</span>
        <span class="text-[12px] leading-4 tabular-nums text-v2-text-text-base">{cny()(line.amount)}</span>
      </div>
      <span class="text-[11px] leading-4 tabular-nums text-v2-text-text-faint">
        {ctx.t("usage.breakdown.rate", { tokens: number().format(line.tokens), price: number().format(price) })}
      </span>
    </div>
  )

  // The estimate behind the cost figure, as the three lines a Flash invoice has.
  const priceDetails = () => (
    <Popover placement="bottom-end" gutter={6}>
      <Tooltip value={ctx.t("usage.breakdown.open")} placement={props.placement ?? "top"}>
        <Popover.Trigger
          as={IconButton}
          variant="ghost-muted"
          size="small"
          icon={<Icon name="circle-exclamation" class="size-3.5" />}
          style={{ color: "var(--v2-text-text-faint)" }}
          aria-label={ctx.t("usage.breakdown.open")}
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          class="z-50 w-[268px] max-w-[calc(100vw-16px)] rounded-[10px] p-3 outline-none"
          style={{
            background: "var(--v2-background-bg-layer-01)",
            "box-shadow": "var(--v2-elevation-floating)",
          }}
          aria-label={ctx.t("usage.breakdown")}
        >
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-0.5">
              <span class="text-[13px] font-[530] leading-[18px] text-v2-text-text-base">
                {ctx.t("usage.breakdown")}
              </span>
              <span class="text-[11px] leading-4 text-v2-text-text-faint">{ctx.t("usage.breakdown.source")}</span>
            </div>
            <div class="flex flex-col gap-2">
              <Show when={spend()}>
                {(breakdown) => (
                  <>
                    {priceRow(ctx.t("usage.breakdown.input"), breakdown().input, flashPrice.input)}
                    {priceRow(ctx.t("usage.breakdown.cacheRead"), breakdown().cacheRead, flashPrice.cacheRead)}
                    {priceRow(ctx.t("usage.breakdown.output"), breakdown().output, flashPrice.output)}
                  </>
                )}
              </Show>
            </div>
            <div class="h-px bg-v2-border-border-muted" />
            <div class="flex items-baseline justify-between gap-3">
              <span class="text-[13px] font-[530] text-v2-text-text-base">{ctx.t("usage.breakdown.total")}</span>
              <span class="text-[13px] font-[530] tabular-nums text-v2-text-text-base">{cost()}</span>
            </div>
            <p class="text-[11px] leading-4 text-v2-text-text-faint">{ctx.t("usage.breakdown.offPeak")}</p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
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
            <div class="flex shrink-0 items-center">
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
              <Show when={showCost()}>{priceDetails()}</Show>
            </div>
          }
        >
          {circle()}
        </Show>
      </Show>
    </Show>
  )
}
