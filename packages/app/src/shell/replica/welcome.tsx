import { createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useTabs } from "@/shell/tabs/tabs"

/**
 * The blank new-conversation state: one title, one input card and the utility bar under it, all on the main
 * column's 63% anchor. Sending starts a real draft; the content moves with it.
 */
export function ReplicaWelcome() {
  const language = useLanguage()
  const navigate = useNavigate()
  const tabs = useTabs()
  const global = useGlobal()
  const [text, setText] = createSignal("")

  const connection = () => {
    const conn = global.servers.list()[0]

    if (!conn) return
    const key = ServerConnection.key(conn)
    const ctx = global.serverCtx(key)

    if (!ctx) return
    const directory = ctx.projects.last()?.worktree ?? ctx.projects.list()[0]?.worktree

    return directory ? { key, directory, ctx } : undefined
  }

  const directory = () => connection()?.directory ?? ""

  const project = () => {
    const path = directory()
    const name = path.split(/[\\/]/).filter(Boolean).at(-1)

    return name || language.t("replica.composer.projectFallback")
  }

  const send = () => {
    const value = text().trim()

    if (!value) return
    const target = connection()

    if (!target) return
    setText("")
    void tabs.newDraft({ server: target.key, directory: target.directory }, value)
  }

  const attach = () => {
    const target = connection()

    if (!target) return
    void tabs.newDraft({ server: target.key, directory: target.directory })
  }

  return (
    <div class="relative min-h-0 flex-1">
      <div data-slot="replica-welcome" class="flex flex-col items-stretch">
        <h1 class="mb-[18px] text-center text-[20px] leading-[26px] font-medium text-[var(--text-primary)]">
          {language.t("replica.welcome.title")}
        </h1>

        <div data-slot="replica-compose-card" class="flex flex-col p-2.5">
          <textarea
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
              event.preventDefault()
              send()
            }}
            rows={1}
            aria-label={language.t("replica.composer.placeholder")}
            placeholder={language.t("replica.composer.placeholder")}
            class="min-h-0 w-full flex-1 resize-none bg-transparent text-[12px] leading-[18px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />

          <div class="flex h-5 items-center gap-1.5">
            <button
              type="button"
              data-replica-control
              aria-label={language.t("replica.composer.add")}
              class="flex size-5 items-center justify-center rounded-full text-[var(--icon-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--icon-primary)]"
              onClick={attach}
            >
              <Icon name="plus" size="small" />
            </button>
            <span class="flex items-center gap-1 text-[10px] leading-4 text-[var(--accent-warning)]">
              <Icon name="outline-hexagonal-warning" size="small" />
              {language.t("replica.composer.access")}
            </span>
            <span class="ms-auto flex min-w-0 items-center gap-1 text-[10px] leading-4 text-[var(--text-secondary)]">
              <span class="min-w-0 truncate">{language.t("replica.composer.model")}</span>
              <Icon name="chevron-down" size="small" class="shrink-0" />
            </span>
            <button
              type="button"
              data-replica-control
              aria-label={language.t("replica.composer.send")}
              disabled={!text().trim()}
              class="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--send-button-bg)] text-[var(--send-button-fg)] disabled:opacity-50"
              onClick={send}
            >
              <Icon name="arrow-up" size="small" />
            </button>
          </div>
        </div>

        <div
          data-slot="replica-utility-bar"
          class="mt-0.5 flex items-center gap-4 px-2.5 text-[10px] leading-4 text-[var(--text-secondary)]"
        >
          <button
            type="button"
            data-replica-control
            class="flex min-w-0 items-center gap-1 rounded-[5px] hover:text-[var(--text-primary)]"
            onClick={attach}
          >
            <Icon name="folder" size="small" class="shrink-0" />
            <span class="min-w-0 truncate">{project()}</span>
          </button>
          <button
            type="button"
            data-replica-control
            class="flex shrink-0 items-center gap-1 rounded-[5px] hover:text-[var(--text-primary)]"
            onClick={() => navigate("/settings")}
          >
            <Icon name="outline-hexagonal-warning" size="small" class="shrink-0" />
            {language.t("replica.composer.plugins")}
          </button>
          <span class="ms-auto flex shrink-0 items-center text-[var(--icon-secondary)]">
            <Icon name="outline-console" size="small" />
          </span>
        </div>
      </div>
    </div>
  )
}
