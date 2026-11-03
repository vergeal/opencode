import { Icon } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { formatWorkingDuration, type WorkingStep } from "./working-step"

const stepIcons: Record<WorkingStep["kind"], IconName> = {
  thinking: "outline-brain",
  command: "outline-console",
  read: "open-file",
  edit: "pencil-line",
  search: "magnifying-glass",
  list: "file-tree",
  browse: "outline-globe",
  "web-search": "magnifying-glass-menu",
  subagent: "providers",
  skill: "graduation-cap",
  tool: "cube",
}

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
      <div class="flex items-center gap-1.5 whitespace-nowrap text-[15px] leading-text-base text-v2-text-text-faint">
        <TextShimmer
          text={showDuration() ? language.t("session.working.for") : language.t("session.timeline.working")}
          active
        />
        <Show when={showDuration()}>
          <span data-slot="session-working-duration" class="tabular-nums">
            {formatWorkingDuration(elapsed())}
          </span>
        </Show>
      </div>
      <div data-slot="session-working-divider" class="mt-2 w-full border-t border-v2-border-border-muted" />
    </div>
  )
}

// The same header the turn showed while it worked, frozen once the turn settles.
// A settled turn folds its working steps behind this header and keeps only the final answer, so the header doubles
// as the disclosure control whenever there is something to fold away.
export function SessionWorkedHeader(props: {
  started: number
  completed: number
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
}) {
  const language = useLanguage()
  const duration = () => Math.max(0, props.completed - props.started)
  const showDuration = () => duration() >= 1000
  const content = () => (
    <>
      <span>{language.t(showDuration() ? "session.worked.for" : "session.worked")}</span>
      <Show when={showDuration()}>
        <span data-slot="session-worked-duration" class="tabular-nums">
          {formatWorkingDuration(duration())}
        </span>
      </Show>
      <Show when={props.expandable}>
        <span class="ms-auto shrink-0 text-v2-icon-icon-muted">
          <Icon
            name="chevron-down"
            size="small"
            class={`transition-transform ${props.expanded ? "" : "-rotate-90 rtl:rotate-90"}`}
          />
        </span>
      </Show>
    </>
  )
  const row = () => (
    <div class="flex min-w-0 w-full items-center gap-1.5 whitespace-nowrap text-[15px] leading-text-base text-v2-text-text-faint">
      {content()}
    </div>
  )

  return (
    <div data-component="session-worked" role="status" class="min-w-0 w-full">
      <Show when={props.expandable} fallback={row()}>
        <button
          type="button"
          class="flex min-w-0 w-full items-center gap-1.5 text-start focus-visible:outline-none"
          aria-expanded={props.expanded}
          aria-label={language.t(props.expanded ? "session.worked.collapse" : "session.worked.expand")}
          onClick={() => props.onToggle?.()}
        >
          {row()}
        </button>
      </Show>
      <div data-slot="session-worked-divider" class="mt-2 w-full border-t border-v2-border-border-muted" />
    </div>
  )
}

export function SessionAssistantActivity(props: { step?: WorkingStep; onOpenFile: (path: string) => void }) {
  return <Show when={props.step}>{(step) => <WorkingStepRow step={step()} onOpenFile={props.onOpenFile} />}</Show>
}

function WorkingStepRow(props: { step: WorkingStep; onOpenFile: (path: string) => void }) {
  return (
    <div
      data-component="session-assistant-activity"
      data-state={props.step.running ? "running" : "completed"}
      class="flex min-w-0 items-start gap-2 pb-2 pt-1 ps-0.5 text-[15px] leading-text-base text-v2-text-text-muted"
    >
      <Icon
        name={stepIcons[props.step.kind]}
        size="small"
        data-slot="session-working-icon"
        data-state={props.step.running ? "running" : "completed"}
        class="mt-0.5 shrink-0 text-v2-icon-icon-muted data-[state=running]:text-v2-icon-icon-accent"
      />
      <WorkingStepText step={props.step} onOpenFile={props.onOpenFile} />
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
            class="mt-1 max-w-full truncate font-mono text-[13px] font-[400] leading-text-base tracking-[-0.04px] text-v2-text-text-faint"
          >
            {detail()}
          </code>
        )}
      </Show>
    </span>
  )
}
