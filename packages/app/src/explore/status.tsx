import { Icon, type IconProps } from "@opencode/ui/icon"
import type { JSX } from "solid-js"

/** A quiet empty or error state shared by the catalog pages. */
export function ExploreStatus(props: {
  icon: IconProps["name"]
  title: string
  description: string
  action?: JSX.Element
}) {
  return (
    <div class="explore-status">
      <Icon name={props.icon} size="small" class="explore-status-icon" />
      <p class="explore-status-title">{props.title}</p>
      <p class="explore-status-description">{props.description}</p>
      {props.action}
    </div>
  )
}
