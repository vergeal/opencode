import type { SessionInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Textarea } from "@opencode/ui/textarea"
import { Session } from "@opencode/schema/session"
import { useQueryClient } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"

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
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("session.settings.title")}
          description={language.t("session.settings.prompt.description", { limit: Session.PromptLimit })}
        />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-2">
        <Textarea
          data-action="session-settings-prompt"
          class="!w-full"
          rows={8}
          autofocus
          spellcheck={false}
          value={store.prompt}
          placeholder={language.t("session.settings.prompt.placeholder")}
          aria-label={language.t("session.settings.prompt.title")}
          onInput={(event) => setStore("prompt", event.currentTarget.value)}
        />
        <div
          class="flex items-center justify-between gap-3 text-[13px] tabular-nums"
          classList={{ "text-[var(--v2-state-fg-danger)]": tooLong(), "text-v2-text-text-muted": !tooLong() }}
        >
          <span>{tooLong() ? language.t("session.settings.prompt.tooLong.title") : ""}</span>
          <span>{language.t("session.settings.prompt.count", { count: length(), limit: Session.PromptLimit })}</span>
        </div>
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
