import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useNavigate } from "@solidjs/router"
import { createMediaQuery } from "@solid-primitives/media"
import { createMemo, Show } from "solid-js"
import { useInbox } from "@/inbox/context"
import type { InboxItem } from "@/inbox/model"
import { useLanguage } from "@/runtime/i18n/language"
import { PagePanel } from "@/shell/page"
import { useLayout } from "@/shell/state/layout"
import { InboxDetail } from "./detail"

/**
 * The inbox workspace: the navigation column lists the messages, so this surface is only the open decision.
 */
export function InboxScreen() {
  const language = useLanguage()
  const navigate = useNavigate()
  const mobile = createMediaQuery("(max-width: 767px)")
  const inbox = useInbox()
  const layout = useLayout()

  const current = createMemo(() => {
    const key = layout.destination.inbox.selected()

    return key ? inbox.items().find((item) => item.key === key) : undefined
  })

  const follow = (item: InboxItem) => {
    switch (item.source.type) {
      case "session":
        inbox.openSession(item)
        break
      case "schedule":
        navigate("/scheduled")
        break
      case "knowledge":
        navigate("/knowledge")
        break
    }
  }

  return (
    <PagePanel>
      <div class="flex min-h-0 flex-1 justify-center">
        <Show
          when={current()}
          fallback={
            <section
              data-slot="inbox-detail"
              data-ui="workspace-content"
              class="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
            >
              <span class="flex size-9 items-center justify-center rounded-[9px] bg-[var(--color-hover)] text-[var(--color-icon-secondary)]">
                <Icon name="notifications" />
              </span>
              <p class="text-[13px] leading-[var(--line-height-compact)] font-medium">
                {language.t("inbox.detail.select.title")}
              </p>
              <p class="max-w-80 text-[12px] leading-[var(--line-height-base)] text-[var(--color-text-secondary)]">
                {language.t("inbox.detail.select.description")}
              </p>
              <Button size="small" variant="neutral" onClick={() => navigate("/scheduled")}>
                {language.t("inbox.empty.action")}
              </Button>
            </section>
          }
        >
          {(item) => (
            <section
              data-slot="inbox-detail"
              data-ui="workspace-content"
              class="flex min-w-0 flex-1 flex-col overflow-hidden"
            >
              <InboxDetail
                item={item()}
                inbox={inbox}
                onOpen={() => follow(item())}
                onBack={mobile() ? () => layout.destination.inbox.setSelected(undefined) : undefined}
              />
            </section>
          )}
        </Show>
      </div>
    </PagePanel>
  )
}
