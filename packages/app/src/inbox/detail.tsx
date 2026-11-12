import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { createSignal, For, Show } from "solid-js"
import { SessionElicitationDock } from "@/session/requests/session-elicitation-dock"
import { getRelativeTime } from "@/shell/time"
import { useLanguage } from "@/runtime/i18n/language"
import type { InboxItem, Inbox } from "./model"

const KIND_ICONS = {
  approval: "check",
  question: "bubble-5",
  failure: "outline-hexagonal-warning",
  output: "terminal",
  result: "file-document",
} as const

const KIND_LABELS = {
  approval: "inbox.detail.kind.approval",
  question: "inbox.detail.kind.question",
  failure: "inbox.detail.kind.failure",
  output: "inbox.detail.kind.output",
  result: "inbox.detail.kind.result",
} as const

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

const RESOLUTION_LABELS = {
  once: "inbox.detail.resolution.once",
  always: "inbox.detail.resolution.always",
  reject: "inbox.detail.resolution.reject",
  answered: "inbox.detail.resolution.answered",
  dismissed: "inbox.detail.resolution.dismissed",
} as const

/** One inbox item opened: the facts a decision needs, and the one or two actions that close it. */
export function InboxDetail(props: { item: InboxItem; inbox: Inbox; onOpen: () => void; onBack?: () => void }) {
  const language = useLanguage()
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)

  const decided = () => props.item.status !== "pending"

  const run = async (action: () => Promise<boolean>) => {
    if (busy()) return
    setBusy(true)
    setFailed(false)

    const accepted = await action()

    setBusy(false)

    if (!accepted) setFailed(true)
  }

  const decide = (decision: "once" | "always" | "reject") =>
    run(() => props.inbox.decide(props.item, decision))

  const resources = () => (props.item.action.type === "permission" ? props.inbox.permission(props.item)?.resources : undefined)
  const form = () => (props.item.action.type === "form" ? props.inbox.form(props.item) : undefined)
  const entry = () => props.inbox.entry(props.item)

  return (
    <article
      data-slot="inbox-detail-body"
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
      data-scrollable
    >
      <div class="flex items-center gap-2">
        <Show when={props.onBack}>
          <Button
            size="small"
            variant="ghost-muted"
            icon="arrow-left"
            aria-label={language.t("inbox.detail.back")}
            onClick={() => props.onBack?.()}
          />
        </Show>
        <span class="flex items-center gap-1.5 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
          <Icon name={KIND_ICONS[props.item.kind]} />
          {language.t(KIND_LABELS[props.item.kind])}
        </span>
        <span class={`text-[12px] leading-[var(--line-height-compact)] ${STATUS_CLASS[props.item.status]}`}>
          {language.t(STATUS_LABELS[props.item.status])}
        </span>
        <span class="ms-auto text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
          {getRelativeTime(new Date(props.item.createdAt).toISOString(), language.t)}
        </span>
      </div>

      <div class="flex min-w-0 flex-col gap-1.5">
        <h2 class="text-[17px] leading-[24px] font-semibold tracking-[-0.1px]">{props.item.title}</h2>
        <p class="text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">{props.item.summary}</p>
      </div>

      <dl class="flex flex-col gap-1 text-[13px] leading-[var(--line-height-compact)]">
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-v2-text-text-faint">{language.t("inbox.detail.source")}</dt>
          <dd class="min-w-0 truncate">{props.item.source.name ?? props.item.source.id}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="w-24 shrink-0 text-v2-text-text-faint">{language.t("inbox.detail.created")}</dt>
          <dd class="min-w-0 truncate">{new Date(props.item.createdAt).toLocaleString(language.intl())}</dd>
        </div>
      </dl>

      <Show when={resources()}>
        {(list) => (
          <div class="flex flex-col gap-1.5">
            <span class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
              {language.t("inbox.detail.resources")}
            </span>
            <ul class="flex flex-col gap-1">
              <For each={list()}>
                {(resource) => (
                  <li class="rounded-[6px] bg-v2-background-bg-layer-01 px-2.5 py-1.5 font-mono text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-base">
                    {resource}
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </Show>

      <Show when={form()}>
        {(request) => (
          <SessionElicitationDock
            request={{ ...request(), location: entry()?.session.location }}
            data={entry()?.ctx.data}
            onSubmit={(result) =>
              props.inbox.resolve(props.item, result.answer ? "answered" : "dismissed", result.summary)
            }
          />
        )}
      </Show>

      <Show when={failed()}>
        <p class="text-[12px] leading-[var(--line-height-compact)] text-v2-state-fg-danger">
          {language.t("inbox.detail.failed")}
        </p>
      </Show>

      <Show when={props.item.resolution}>
        {(resolution) => (
          <div
            data-slot="inbox-detail-resolution"
            class="flex flex-col gap-1.5 rounded-[6px] bg-v2-background-bg-layer-01 px-3 py-2.5"
          >
            <div class="flex items-center gap-2 text-[12px] leading-[var(--line-height-compact)]">
              <span class="text-v2-text-text-base">
                {language.t(RESOLUTION_LABELS[resolution().decision])}
              </span>
              <span class="ms-auto text-v2-text-text-faint">
                {getRelativeTime(new Date(resolution().at).toISOString(), language.t)}
              </span>
            </div>
            <Show when={resolution().answers?.length ? resolution().answers : undefined}>
              {(answers) => (
                <dl class="flex flex-col gap-1 text-[13px] leading-[var(--line-height-compact)]">
                  <For each={answers()}>
                    {(answer) => (
                      <div class="flex gap-2">
                        <dt class="w-24 shrink-0 truncate text-v2-text-text-faint">{answer.label}</dt>
                        <dd class="min-w-0 break-words">{answer.value}</dd>
                      </div>
                    )}
                  </For>
                </dl>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show when={props.item.status === "done" && !props.item.resolution}>
        <p class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
          {language.t("inbox.detail.handled")}
        </p>
      </Show>

      <Show when={!decided()}>
        <div class="mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-v2-border-border-muted pt-4">
          <Show when={props.item.kind === "approval"}>
            <Button size="small" variant="neutral" disabled={busy()} onClick={() => props.onOpen()}>
              {language.t("inbox.detail.action.open")}
            </Button>
            <Button size="small" variant="neutral" disabled={busy()} onClick={() => void decide("reject")}>
              {language.t("inbox.detail.action.reject")}
            </Button>
            <Button size="small" variant="neutral" disabled={busy()} onClick={() => void decide("always")}>
              {language.t("inbox.detail.action.always")}
            </Button>
            <Button size="small" variant="contrast" disabled={busy()} onClick={() => void decide("once")}>
              {language.t("inbox.detail.action.approve")}
            </Button>
          </Show>

          <Show when={props.item.kind === "question"}>
            <Button size="small" variant="neutral" disabled={busy()} onClick={() => props.inbox.markSeen(props.item)}>
              {language.t("inbox.detail.action.later")}
            </Button>
            <Button size="small" variant="neutral" disabled={busy()} onClick={() => props.onOpen()}>
              {language.t("inbox.detail.action.open")}
            </Button>
          </Show>

          <Show when={props.item.kind === "failure" || props.item.kind === "output"}>
            <Button
              size="small"
              variant="neutral"
              disabled={busy()}
              onClick={() => void run(async () => (props.inbox.resolve(props.item, "dismissed"), true))}
            >
              {language.t("inbox.detail.action.dismiss")}
            </Button>
            <Button size="small" variant="contrast" disabled={busy()} onClick={() => props.onOpen()}>
              {language.t("inbox.detail.action.open")}
            </Button>
          </Show>

          <Show when={props.item.kind === "result"}>
            <Button size="small" variant="neutral" disabled={busy()} onClick={() => props.inbox.markSeen(props.item)}>
              {language.t("inbox.detail.action.markRead")}
            </Button>
            <Button size="small" variant="contrast" disabled={busy()} onClick={() => props.onOpen()}>
              {language.t("inbox.detail.action.open")}
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={props.inbox.history(props.item)}>
        <div class="mt-auto flex items-center justify-end border-t border-v2-border-border-muted pt-4">
          <Button size="small" variant="neutral" onClick={() => props.inbox.remove(props.item)}>
            {language.t("inbox.detail.action.delete")}
          </Button>
        </div>
      </Show>
    </article>
  )
}
