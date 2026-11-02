import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { PageHeader, PagePanel } from "@/shell/page"

/**
 * Scheduled tasks live beside the knowledge bases. The frame is already in place so the feature
 * lands into a finished page; until then this is the honest empty state, not a mock list.
 */
export function ScheduledScreen() {
  const language = useLanguage()

  return (
    <PagePanel>
      <PageHeader title={language.t("scheduled.title")} description={language.t("scheduled.description")} />
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <span class="flex size-9 items-center justify-center rounded-[9px] bg-v2-background-bg-layer-02 text-v2-icon-icon-muted">
          <Icon name="task" />
        </span>
        <p class="text-[15px] leading-[var(--line-height-base)]">{language.t("scheduled.empty")}</p>
        <p class="max-w-80 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
          {language.t("scheduled.empty.hint")}
        </p>
      </div>
    </PagePanel>
  )
}
