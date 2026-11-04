import { type Component } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { fileManagerApp } from "@/home/projects/file-manager"
import { useRevealProject } from "@/home/projects/reveal"

export type ProjectMenuItem = {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Draws a divider above this item, marking it apart from the group before it. */
  separated?: boolean
}

// The project rows and the projects page show the same actions through a dropdown and through right-click, so the
// list is built once here and each menu only owns how it paints an item.
export function projectMenuItems(input: {
  server: ServerConnection.Any
  project: LocalProject
  onEdit?: () => void
  onRename?: () => void
  /** Omit to leave the project in place; the page that owns the row decides whether it can be removed. */
  onDelete?: () => void
}) {
  const language = useLanguage()
  const global = useGlobal()
  const platform = usePlatform()
  const revealProject = useRevealProject()
  const context = () => global.ensureServerCtx(input.server)
  const directories = () => [input.project.worktree, ...(input.project.sandboxes ?? [])]
  const hasUnread = () => directories().some((directory) => context().notification.project.hasUnread(directory))

  const clearNotifications = () =>
    directories().forEach((directory) => context().notification.project.markViewed(directory))

  return (): ProjectMenuItem[] => [
    ...(input.onEdit ? [{ id: "edit", label: language.t("common.edit"), onSelect: input.onEdit }] : []),
    ...(input.onRename ? [{ id: "rename", label: language.t("common.rename"), onSelect: input.onRename }] : []),
    ...(revealProject.available(input.server)
      ? [
          {
            id: "reveal",
            label: language.t(fileManagerApp(platform.os ?? "unknown").actionLabel),
            onSelect: () => revealProject.reveal(input.server, input.project),
          },
        ]
      : []),
    {
      id: "clear-notifications",
      label: language.t("sidebar.project.clearNotifications"),
      disabled: !hasUnread(),
      onSelect: clearNotifications,
    },
    ...(input.onDelete
      ? [
          {
            id: "delete",
            label: language.t("settings.projects.delete"),
            separated: true,
            onSelect: input.onDelete,
          },
        ]
      : []),
  ]
}

export const ProjectOptions: Component<{
  server: ServerConnection.Any
  project: LocalProject
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onEdit?: () => void
  onRename?: () => void
  onDelete?: () => void
  class?: string
  size?: "small" | "normal" | "large"
}> = (props) => {
  const language = useLanguage()
  const items = projectMenuItems(props)

  return (
    <Menu gutter={4} modal={false} placement="bottom-end" open={props.open} onOpenChange={props.onOpenChange}>
      <Menu.Trigger
        as={IconButton}
        variant="ghost-muted"
        size={props.size ?? "small"}
        class={props.class}
        icon={<Icon name="outline-dots" />}
        aria-label={language.t("common.moreOptions")}
      />
      <Menu.Portal>
        <Menu.Content>
          {items().map((item) => (
            <>
              {item.separated ? <Menu.Separator /> : null}
              <Menu.Item disabled={item.disabled} onSelect={item.onSelect}>
                {item.label}
              </Menu.Item>
            </>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
