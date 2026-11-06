import { Menu } from "@opencode/ui/menu"
import type { Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"

/** Copies a session ID from a row, tab or inbox menu, the same way the `session.copyID` command does. */
export function useCopySessionID() {
  const language = useLanguage()
  const platform = usePlatform()

  return async (sessionID: string) => {
    try {
      await (platform.writeClipboardText?.(sessionID) ?? navigator.clipboard.writeText(sessionID))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
        description: sessionID,
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("toast.session.copyID.failed.title"),
        description: error instanceof Error ? error.message : language.t("toast.session.copyID.failed.description"),
      })
    }
  }
}

export const SessionMenuCopyID: Component<{ sessionID: string | undefined }> = (props) => {
  const language = useLanguage()
  const copy = useCopySessionID()

  return (
    <Menu.Item disabled={!props.sessionID} onSelect={() => props.sessionID && void copy(props.sessionID)}>
      {language.t("command.session.copyID")}
    </Menu.Item>
  )
}
