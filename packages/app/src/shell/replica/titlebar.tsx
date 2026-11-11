import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
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
  const mac = () => platform.platform === "desktop" && platform.os === "macos"

  const conversation = () => {
    const route = layout.route()

    if (route.type !== "session") return
    const session = global.serverCtx(route.server)?.data.session.get(route.sessionId)

    return session?.title
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
          onClick={() => window.history.back()}
        >
          <Icon name="outline-arrow-left" size="small" />
        </button>
        <button
          type="button"
          data-replica-control
          class={BUTTON}
          aria-label={language.t("replica.titlebar.forward")}
          onClick={() => window.history.forward()}
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
          <Icon name="comment" size="small" class="shrink-0 text-[var(--color-icon-secondary)]" />
          <span
            class="min-w-0 truncate text-[14px] leading-[17px] font-medium text-[var(--color-text-main)]"
            data-ui="titlebar-title"
          >
            {conversation() ?? ""}
          </span>
        </span>

        <div class="ms-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-replica-control
            class={BUTTON}
            aria-label={language.t("replica.rail.more")}
            onClick={props.onMore}
          >
            <Icon name="outline-dots" size="small" />
          </button>
          <button
            type="button"
            data-replica-control
            class={BUTTON}
            aria-label={language.t("replica.titlebar.view")}
            onClick={props.onView}
          >
            <Icon name="outline-sliders" size="small" />
          </button>
          <button
            type="button"
            data-replica-control
            class={BUTTON}
            aria-label={language.t("replica.newChat")}
            onClick={props.onAdd}
          >
            <Icon name="plus" size="small" />
          </button>
        </div>
      </div>
    </header>
  )
}
