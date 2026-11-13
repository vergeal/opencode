/**
 * `[label](@project:/abs/directory)` opens the project settings for that directory. The label carries the short name a
 * reader sees; the href carries the full path the settings surface needs.
 *
 * A directory with no matching project has nowhere to open, so it falls back to the full path as inline code. The
 * message keeps one format; only its rendering depends on whether this app knows the directory as a project.
 */
const prefix = "@project:"

export function markProjectLinks(root: HTMLElement, isProject: ((directory: string) => boolean) | undefined) {
  root.querySelectorAll<HTMLAnchorElement>('a[href^="@project:"]').forEach((anchor) => {
    const directory = anchor.getAttribute("href")?.slice(prefix.length)

    if (!directory) return

    if (isProject && !isProject(directory)) {
      const path = document.createElement("code")
      path.textContent = directory
      anchor.replaceWith(path)

      return
    }

    const button = document.createElement("button")
    button.type = "button"
    button.className = "markdown-project-link"
    button.dataset.projectDirectory = directory
    button.title = directory
    button.textContent = anchor.textContent ?? directory
    anchor.replaceWith(button)
  })
}

export function setupProjectLinks(root: HTMLElement, open: () => ((directory: string) => void) | undefined) {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return
    const button = event.target.closest("button[data-project-directory]")

    if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return
    const handler = open()

    if (!handler) return
    event.stopPropagation()
    handler(button.dataset.projectDirectory!)
  }

  root.addEventListener("click", click)

  return () => root.removeEventListener("click", click)
}
