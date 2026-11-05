import type { SessionInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Textarea } from "@opencode/ui/textarea"
import { Session } from "@opencode/schema/session"
import { useQueryClient } from "@tanstack/solid-query"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import "./settings-dialog.css"

export function SessionSettingsDialog(props: { server: ServerConnection.Key; session: SessionInfo }) {
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()
  const servers = useServers()
  const queryClient = useQueryClient()
  const [store, setStore] = createStore({ prompt: props.session.prompt ?? "", saving: false })
  const length = () => Array.from(store.prompt).length
  const tooLong = () => length() > Session.PromptLimit

  const save = () => {
    if (store.saving || tooLong()) return
    const conn = servers.visible.find((item) => ServerConnection.key(item) === props.server)
    const ctx = conn ? global.ensureServerCtx(conn) : undefined

    if (!conn || !ctx) return
    const value = store.prompt.trim()

    setStore("saving", true)
    void ctx.sdk.api.session
      .update({ sessionID: props.session.id, prompt: value })
      .then(() => {
        const current = ctx.data.session.get(props.session.id) ?? props.session
        ctx.data.session.remember({ ...current, prompt: value || undefined })
        ctx.data.session.invalidate(props.session.id)
        void ctx.data.session.sync(props.session.id).catch(() => {})
        queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn], (current) =>
          current?.map((item) => (item.id === props.session.id ? { ...item, prompt: value || undefined } : item)),
        )
        dialog.close()
      })
      .catch((cause) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        }),
      )
      .finally(() => setStore("saving", false))
  }

  return (
    <Dialog fit containerClass="session-settings-dialog">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("session.settings.title")}
          description={language.t("session.settings.prompt.description", { limit: Session.PromptLimit })}
        />
      </DialogHeader>
      <DialogBody class="session-settings-body">
        <div data-slot="session-settings-meta">
          <label data-slot="session-settings-label" for="session-settings-prompt">
            {language.t("session.settings.prompt.title")}
          </label>
          <span data-slot="session-settings-count" data-over={tooLong() ? "" : undefined}>
            {language.t("session.settings.prompt.count", { count: length(), limit: Session.PromptLimit })}
          </span>
        </div>
        <Textarea
          id="session-settings-prompt"
          data-action="session-settings-prompt"
          rows={7}
          autofocus
          spellcheck={false}
          invalid={tooLong()}
          value={store.prompt}
          placeholder={language.t("session.settings.prompt.placeholder")}
          onInput={(event) => setStore("prompt", event.currentTarget.value)}
        />
        <Show when={tooLong()}>
          <p data-slot="session-settings-error" role="alert">
            {language.t("session.settings.prompt.tooLong.title")}
          </p>
        </Show>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="submit" disabled={store.saving || tooLong()} onClick={save}>
          {language.t("common.save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
