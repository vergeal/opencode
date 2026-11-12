import { For } from "solid-js"
import { Project } from "@opencode/schema/project"
import { Menu } from "@opencode/ui/menu"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import type { ServerConnection } from "@/runtime/server/registry"
import type { LocalProject } from "@/shell/state/layout"
import { fileManagerApp } from "./file-manager"

export type HomeProjectMenuItem = {
  id: string
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Draws a divider above this item, marking it apart from the group before it. */
  separated?: boolean
}

// The web dropdown and the desktop platform menu show the same actions, so the list is built once here and each
// menu only owns how it paints an item.
export function projectMenuItems(props: {
  server: ServerConnection.Any
  project: LocalProject
  unread: boolean
  canImportSession: boolean
  canRevealProject: (server: ServerConnection.Any) => boolean
  onOpenProjectNewSession: (server: ServerConnection.Any, directory: string) => void
  onImportSession: (server: ServerConnection.Any, project: LocalProject) => void
  onEditProject: (server: ServerConnection.Any, project: LocalProject) => void
  onRevealProject: (server: ServerConnection.Any, project: LocalProject) => void
  onClearNotifications: (server: ServerConnection.Any, project: LocalProject) => void
  onHideProject: (server: ServerConnection.Any, project: LocalProject) => void
  onDeleteProject: (server: ServerConnection.Any, project: LocalProject) => void
}) {
  const language = useLanguage()
  const platform = usePlatform()

  return (): HomeProjectMenuItem[] => [
    {
      id: "new-session",
      label: language.t("command.session.new"),
      onSelect: () => props.onOpenProjectNewSession(props.server, props.project.worktree),
    },
    ...(props.canImportSession
      ? [
          {
            id: "import",
            label: language.t("command.session.import"),
            onSelect: () => props.onImportSession(props.server, props.project),
          },
        ]
      : []),
    {
      id: "edit",
      label: language.t("dialog.project.edit.title"),
      onSelect: () => props.onEditProject(props.server, props.project),
    },
    ...(props.canRevealProject(props.server)
      ? [
          {
            id: "reveal",
            label: language.t(
              fileManagerApp(platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown").actionLabel,
            ),
            onSelect: () => props.onRevealProject(props.server, props.project),
          },
        ]
      : []),
    {
      id: "clear-notifications",
      label: language.t("sidebar.project.clearNotifications"),
      disabled: !props.unread,
      onSelect: () => props.onClearNotifications(props.server, props.project),
    },
    {
      id: "close",
      label: language.t("common.close"),
      onSelect: () => props.onHideProject(props.server, props.project),
    },
    ...(props.project.id && props.project.id !== Project.ID.global
      ? [
          {
            id: "delete",
            label: `${language.t("project.delete.action")}…`,
            separated: true,
            onSelect: () => props.onDeleteProject(props.server, props.project),
          },
        ]
      : []),
  ]
}

export function ProjectMenuItems(props: Parameters<typeof projectMenuItems>[0]) {
  const items = projectMenuItems(props)

  return (
    <For each={items()}>
      {(item) => (
        <>
          {item.separated ? <Menu.Separator /> : null}
          <Menu.Item disabled={item.disabled} onSelect={item.onSelect}>
            {item.label}
          </Menu.Item>
        </>
      )}
    </For>
  )
}
