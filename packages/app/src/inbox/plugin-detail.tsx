import { InboxContent, type InboxRecord } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { createMemo, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { usePluginHost } from "@/runtime/plugin/host"
import { Contribution } from "@/runtime/plugin/render"
import { getRelativeTime } from "@/shell/time"

const STATUS_LABELS = {
  pending: "inbox.detail.status.pending",
  done: "inbox.detail.status.done",
  failed: "inbox.detail.status.failed",
} as const

const STATUS_CLASS = {
  pending: "text-v2-text-text-base",
  done: "text-v2-text-text-muted",
  failed: "text-v2-state-fg-danger",
} as const

/**
 * The content page of one plugin inbox message. The message goes to the publishing plugin's `InboxContent` renderer;
 * a plugin that contributed none gets the host's default page, which reads the fields the platform guarantees.
 *
 * The host owns the delete action, so it stays reachable whatever the plugin renders: a plugin's own page cannot be
 * the only place a user can clean up its messages.
 */
export function PluginInboxDetail(props: { record: InboxRecord; onDelete: () => void }) {
  const host = usePluginHost()
  const language = useLanguage()
  const content = createMemo(() => host.items(InboxContent).find((item) => item.plugin === props.record.plugin))

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show when={content()} fallback={<PluginInboxMessage record={props.record} />}>
        {(item) => (
          <Contribution plugin={item().plugin}>{() => item().value.render(props.record)}</Contribution>
        )}
      </Show>
      <div class="mt-auto flex items-center justify-end border-t border-v2-border-border-muted px-6 py-3">
        <Button size="small" variant="neutral" onClick={() => props.onDelete()}>
          {language.t("inbox.detail.action.deleteMessage")}
        </Button>
      </div>
    </div>
  )
}

/** What the host can say about a plugin message on its own: the title, the summary, and where it came from. */
function PluginInboxMessage(props: { record: InboxRecord }) {
  const language = useLanguage()

  return (
    <article
      data-slot="inbox-detail-body"
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
      data-scrollable
    >
      <div class="flex items-center gap-2">
        <span class="flex items-center gap-1.5 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
          <Icon name="notifications" />
          {language.t("inbox.detail.kind.plugin")}
        </span>
        <span class={`text-[12px] leading-[var(--line-height-compact)] ${STATUS_CLASS[props.record.status]}`}>
          {language.t(STATUS_LABELS[props.record.status])}
        </span>
        <span class="ms-auto text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
          {getRelativeTime(new Date(props.record.createdAt).toISOString(), language.t)}
        </span>
      </div>

      <div class="flex min-w-0 flex-col gap-1.5">
        <h2 class="text-[17px] leading-[24px] font-semibold tracking-[-0.1px]">{props.record.title}</h2>
        <p class="text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">{props.record.summary}</p>
      </div>

      <dl class="flex flex-col gap-1 text-[13px] leading-[var(--line-height-compact)]">
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-v2-text-text-faint">{language.t("inbox.detail.source")}</dt>
          <dd class="min-w-0 truncate">{props.record.plugin}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-v2-text-text-faint">{language.t("inbox.detail.created")}</dt>
          <dd class="min-w-0 truncate">{new Date(props.record.createdAt).toLocaleString(language.intl())}</dd>
        </div>
      </dl>
    </article>
  )
}
