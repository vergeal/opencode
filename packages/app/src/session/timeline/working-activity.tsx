import type { SessionMessageAssistant } from "@opencode/client/promise"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { buildWorkingSteps, formatWorkingDuration, type WorkingStep } from "./working-step"

export function SessionWorkingActivity(props: {
  started: number
  messages: readonly Pick<SessionMessageAssistant, "id" | "content">[]
  onOpenFile: (path: string) => void
}) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())

  createEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(timer))
  })

  const steps = () => buildWorkingSteps(props.messages)
  const elapsed = () => Math.max(0, now() - props.started)
  const showDuration = () => elapsed() >= 1000

  return (
    <div data-component="session-working" role="status" class="min-w-0 flex-1">
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
      <Show when={steps().length > 0}>
        <ol
          data-slot="session-working-steps"
          aria-label={language.t("session.working.steps")}
          class="mt-1.5 flex flex-col gap-1 ps-1 text-[13px] leading-text-compact text-v2-text-text-muted"
        >
          <For each={steps()}>
            {(step) => (
              <li
                data-slot="session-working-step"
                data-state={step.running ? "running" : "completed"}
                class="flex min-w-0 items-start gap-2"
              >
                <span
                  data-slot="session-working-dot"
                  aria-hidden="true"
                  class="mt-[7px] size-1 shrink-0 rounded-full bg-v2-icon-icon-muted data-[state=running]:bg-v2-icon-icon-accent"
                  data-state={step.running ? "running" : "completed"}
                />
                <WorkingStepText step={step} onOpenFile={props.onOpenFile} />
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
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
            class="mt-1 max-w-full truncate font-mono text-[12px] font-[440] leading-text-compact tracking-[-0.04px] text-v2-text-text-faint"
          >
            {detail()}
          </code>
        )}
      </Show>
    </span>
  )
}
