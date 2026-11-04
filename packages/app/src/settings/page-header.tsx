import { Show, type JSX } from "solid-js"
import "@/settings/settings.css"

/** The heading of a settings page: one title, one short description, and any page-level actions. */
export function SettingsPageHeader(props: {
  title: string
  description?: string
  actions?: JSX.Element
  /** Stacks a page-level search field or filter below the heading. */
  stacked?: boolean
  class?: string
  children?: JSX.Element
}) {
  return (
    <div
      class="settings-tab-header"
      classList={{
        "settings-tab-header--stacked": props.stacked,
        [props.class ?? ""]: !!props.class,
      }}
    >
      <div class="settings-tab-header-row">
        <div class="settings-tab-header-copy">
          <h2 class="settings-tab-title">{props.title}</h2>
          <Show when={props.description}>
            {(description) => <p class="settings-tab-description">{description()}</p>}
          </Show>
        </div>
        <Show when={props.actions}>
          <div class="settings-tab-header-actions">{props.actions}</div>
        </Show>
      </div>
      {props.children}
    </div>
  )
}
