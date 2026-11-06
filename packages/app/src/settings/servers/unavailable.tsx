import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Show, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { DialogServer } from "@/servers/connect/dialog"
import { SettingsList } from "@/settings/list"
import { SettingsPageHeader } from "@/settings/page-header"
import type { SettingsServer } from "./inventory"
import { transition, type RetryState } from "./unavailable-machine"
import "@/settings/settings.css"

/** A per-server page while its server is unreachable. */
export function SettingsServerUnavailable(props: {
  entry: SettingsServer
  title: string
  description: string
  headerAction?: JSX.Element
  /** Opens the Servers page, for servers this page cannot edit. */
  onManage: () => void
  onServerChange: (server: ServerConnection.Any) => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const global = useGlobal()
  const [retryState, setRetryState] = createSignal<RetryState>({ status: "idle" })

  const retrying = () => retryState().status === "retrying"

  const retryError = () => {
    const current = retryState()

    return current.status === "failed" ? current.message : undefined
  }

  const http = () =>
    props.entry.connection?.type === "http" && !ServerConnection.builtin(props.entry.connection)
      ? props.entry.connection
      : undefined

  const retry = () => {
    if (retrying()) return

    setRetryState((current) => transition(current, { type: "retry.started" }))

    void global.servers.retry().then(
      () => setRetryState((current) => transition(current, { type: "retry.succeeded" })),
      (error) =>
        setRetryState((current) =>
          transition(current, {
            type: "retry.failed",
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
    )
  }

  const edit = () => {
    const server = http()

    if (!server) return props.onManage()
    void dialog.push(() => <DialogServer mode="edit" server={server} onSave={props.onServerChange} />)
  }

  return (
    <>
      <SettingsPageHeader title={props.title} description={props.description} actions={props.headerAction} />
      <div class="settings-tab-body">
        <SettingsList>
          <div class="settings-server-unavailable" role="status">
            <Icon name="outline-hexagonal-warning" class="settings-server-unavailable-icon" />
            <div class="settings-server-unavailable-title">
              {language.t("settings.server.unreachable.title", { server: props.entry.name })}
            </div>
            <div class="settings-server-unavailable-description">
              {language.t("settings.server.unreachable.description", { server: props.entry.name })}
            </div>
            <Show when={retryError()}>
              {(message) => (
                <div class="settings-server-unavailable-error" role="alert">
                  {language.t("settings.server.unreachable.retryFailed", { message: message() })}
                </div>
              )}
            </Show>
            <div class="settings-server-unavailable-actions">
              <Button size="normal" variant="contrast" icon="refresh" disabled={retrying()} onClick={retry}>
                {language.t("settings.server.unreachable.retry")}
              </Button>
              <Button size="normal" variant="ghost-muted" onClick={edit}>
                {language.t("settings.server.unreachable.edit")}
              </Button>
            </div>
          </div>
        </SettingsList>
      </div>
    </>
  )
}
