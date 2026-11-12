import { For } from "solid-js"
import "./explore.css"

/** Placeholder rows for a list that is still loading, shaped like the rows it replaces. */
export function ExploreSkeleton(props: { rows?: number }) {
  return (
    <div class="explore-skeleton" role="status" aria-busy="true">
      <For each={Array.from({ length: props.rows ?? 4 })}>{() => <div class="explore-skeleton-row" />}</For>
    </div>
  )
}
