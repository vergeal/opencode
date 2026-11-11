import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"

const BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--icon-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--icon-primary)] focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--icon-secondary)]"

/**
 * The 27px window bar. The native traffic lights stay the system's; this only reserves their space, keeps the
 * rest of the strip draggable, and hosts the three window controls at its end.
 */
export function ReplicaTitleBar(props: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const mac = () => platform.platform === "desktop" && platform.os === "macos"

  return (
    <header
      data-slot="replica-titlebar"
      class="relative flex shrink-0 items-center"
      style={{ "padding-inline-start": mac() ? "78px" : "8px" }}
    >
      <div class="ms-auto flex items-center gap-0.5 pe-2" data-replica-control>
        <button
          type="button"
          class={BUTTON}
          aria-label={language.t("replica.titlebar.back")}
          onClick={() => window.history.back()}
        >
          <Icon name="outline-arrow-left" size="small" />
        </button>
        <button
          type="button"
          class={BUTTON}
          aria-label={language.t("replica.titlebar.forward")}
          onClick={() => window.history.forward()}
        >
          <Icon name="outline-arrow-right" size="small" />
        </button>
        <button
          type="button"
          class={BUTTON}
          aria-label={language.t("replica.titlebar.sidebar")}
          aria-pressed={props.sidebarOpen}
          onClick={props.onToggleSidebar}
        >
          <Icon name="outline-sliders" size="small" />
        </button>
      </div>
    </header>
  )
}
