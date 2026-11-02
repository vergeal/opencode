import type { JSX, ParentProps } from "solid-js"

/**
 * The shared surface every full-page screen sits on: one flat white panel that fills the shell.
 * Keeping this in one place means a screen only chooses its content, not its frame.
 */
export function PagePanel(props: ParentProps<{ class?: string }>) {
  return (
    <div
      data-slot="page-panel"
      class={`flex min-h-0 flex-1 flex-col self-stretch overflow-hidden bg-v2-background-bg-base ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  )
}

/**
 * The one page title treatment: optional breadcrumb above the title, a 17px title, a 13px
 * description, and actions pinned to the trailing edge. Screens must not invent a second one.
 */
export function PageHeader(props: {
  title: string
  description?: string
  breadcrumb?: JSX.Element
  actions?: JSX.Element
}) {
  return (
    <header class="flex shrink-0 items-start gap-4 border-b border-v2-border-border-muted px-5 py-4">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        {props.breadcrumb}
        <h1 class="text-[17px] leading-[var(--line-height-base)] font-medium">{props.title}</h1>
        {props.description ? (
          <p class="text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">{props.description}</p>
        ) : null}
      </div>
      {props.actions ? <div class="flex shrink-0 items-center gap-2">{props.actions}</div> : null}
    </header>
  )
}

/** A filter row that sits directly under PageHeader, separated from the content it filters. */
export function PageToolbar(props: ParentProps<{ class?: string }>) {
  return (
    <div
      class={`flex shrink-0 items-center gap-2 border-b border-v2-border-border-muted px-5 py-3 ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  )
}
