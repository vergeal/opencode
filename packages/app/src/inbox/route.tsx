import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { PageHeader, PagePanel } from "@/shell/page"

/**
 * The inbox is where scheduled runs land when they need a decision: an output to accept, a failure
 * to look at, a permission request to answer. The page owns that structure now so the feature can
 * fill it without moving the frame again. Until there is a producer, it stays an honest empty state.
 */
export function InboxScreen() {
  const language = useLanguage()

  return (
    <PagePanel>
      <PageHeader title={language.t("inbox.title")} description={language.t("inbox.description")} />
      <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <span class="flex size-9 items-center justify-center rounded-[9px] bg-v2-background-bg-layer-02 text-v2-icon-icon-muted">
          <Icon name="notifications" />
        </span>
        <p class="text-[15px] leading-[var(--line-height-base)]">{language.t("inbox.empty")}</p>
        <p class="max-w-80 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
          {language.t("inbox.empty.hint")}
        </p>
      </div>
    </PagePanel>
  )
}
