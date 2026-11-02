import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatWorkingDuration, type WorkingStep } from "./working-step"

export function SessionWorkingHeader(props: { started: number }) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())

  createEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(timer))
  })

  const elapsed = () => Math.max(0, now() - props.started)
  const showDuration = () => elapsed() >= 1000

  return (
    <div data-component="session-working" role="status" class="min-w-0 w-full">
      <div class="flex items-center gap-1.5 whitespace-nowrap text-[15px] font-[530] leading-text-compact">
        <TextShimmer
          text={showDuration() ? language.t("session.working.for") : language.t("session.timeline.working")}
          active
        />
        <Show when={showDuration()}>
          <span data-slot="session-working-duration" class="font-[530] tabular-nums">
            {formatWorkingDuration(elapsed())}
          </span>
        </Show>
      </div>
      <div data-slot="session-working-divider" class="mt-2 w-full border-t border-v2-border-border-muted" />
    </div>
  )
}

export function SessionAssistantActivity(props: { step?: WorkingStep; onOpenFile: (path: string) => void }) {
  return (
    <Show when={props.step}>
      {(step) => (
        <div
          data-component="session-assistant-activity"
          data-state={step().running ? "running" : "completed"}
          class="flex min-w-0 items-start gap-2 pb-2 pt-1 ps-1 text-[14px] leading-text-base text-v2-text-text-muted"
        >
          <span
            data-slot="session-working-dot"
            aria-hidden="true"
            class="mt-[7px] size-1 shrink-0 rounded-full bg-v2-icon-icon-muted data-[state=running]:bg-v2-icon-icon-accent"
            data-state={step().running ? "running" : "completed"}
          />
          <WorkingStepText step={step()} onOpenFile={props.onOpenFile} />
        </div>
      )}
    </Show>
  )
}

function WorkingStepText(props: { step: WorkingStep; onOpenFile: (path: string) => void }) {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)
  const label = () => {
    switch (props.step.kind) {
      case "thinking":
        return language.t("session.working.step.thinking")
      case "command":
        return props.step.running
          ? language.t("session.working.step.runCommand")
          : language.t("session.working.step.ranCommand")
      case "read":
        return language.t("session.working.step.read")
      case "edit":
        return language.t("session.working.step.edit")
      case "search":
        return language.t("session.working.step.search")
      case "list":
        return language.t("session.working.step.list")
      case "browse":
        return language.t("session.working.step.browse")
      case "web-search":
        return language.t("session.working.step.webSearch")
      case "subagent":
        return language.t("session.working.step.subagent")
      case "skill":
        return language.t("session.working.step.skill")
      case "tool":
        return props.step.label ?? "tool"
    }
  }

  return (
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="flex min-w-0 items-center gap-1.5">
        <Show when={props.step.running} fallback={<span>{label()}</span>}>
          <TextShimmer text={label()} active />
        </Show>
        <Show when={props.step.file && props.step.path}>
          <a
            data-slot="session-working-file"
            href={props.step.path}
            class="min-w-0 truncate text-v2-text-text-base underline decoration-v2-border-border-strong underline-offset-2 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
            onClick={(event) => {
              event.preventDefault()
              if (props.step.path) props.onOpenFile(props.step.path)
            }}
          >
            {props.step.file}
          </a>
          <Show when={props.step.extraFiles}>
            {(count) => <span class="shrink-0 text-v2-text-text-faint">+{count()}</span>}
          </Show>
        </Show>
        <Show when={props.step.kind === "command" && props.step.detail}>
          {(detail) => (
            <button
              type="button"
              data-slot="session-working-command-toggle"
              aria-expanded={expanded()}
              aria-label={detail()}
              class="ms-0.5 rounded p-0.5 text-v2-icon-icon-muted hover:text-v2-text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
              onClick={() => setExpanded((value) => !value)}
            >
              <span class="block size-1.5 rotate-45 border-e border-b border-current" aria-hidden="true" />
            </button>
          )}
        </Show>
      </span>
      <Show when={expanded() && props.step.kind === "command" && props.step.detail}>
        {(detail) => (
          <code
            data-slot="session-working-command-detail"
            class="mt-1 max-w-full truncate font-mono text-[13px] font-[400] leading-text-base tracking-[-0.04px] text-v2-text-text-faint"
          >
            {detail()}
          </code>
        )}
      </Show>
    </span>
  )
}
