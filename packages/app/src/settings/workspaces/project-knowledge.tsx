import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { useMutation, useQuery } from "@tanstack/solid-query"
import { For, Show, createMemo, type Component } from "solid-js"
import type { KnowledgeInfo } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { SettingsRow } from "@/settings/row"
import { useKnowledgeLibraries, type KnowledgeLibrary } from "@/knowledge/store"
import { syncKnowledgeLibrary } from "@/knowledge/sync"

/**
 * Libraries are local to the app, while indexing and retrieval happen on the server, so linking one
 * copies its text first. Only the knowledge agent reads them; the main conversation never does.
 */
export const ProjectKnowledge: Component<{ projectID: string }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useServerSDK()
  const libraries = useKnowledgeLibraries()
  const desktop = () => platform.platform === "desktop"

  const queried = useQuery(() => ({
    queryKey: [sdk.scope, "settings-project-knowledge", props.projectID],
    enabled: sdk.connection.status() === "connected",
    queryFn: () => sdk.api.experimental["server.knowledge"].assigned({ projectID: props.projectID }),
    // Indexing finishes in the background, so poll while a server copy is still being built.
    refetchInterval: (query) => (query.state.data?.some((row) => row.status === "indexing") ? 3_000 : false),
  }))

  const assigned = createMemo(() => {
    const rows = queried.data ?? []

    return new Map(rows.map((row) => [row.id, row]))
  })

  const formatIndexedAt = (at: number) =>
    new Intl.DateTimeFormat(language.intl(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
      at,
    )

  const describe = (library: KnowledgeLibrary, info: KnowledgeInfo | undefined) => (
    <div class="project-settings-knowledge-meta">
      <span>{language.plural("knowledge.files", library.files.length, { count: library.files.length })}</span>
      <Show when={info}>
        {(row) => (
          <>
            <span>{language.t(`project.settings.knowledge.status.${row().status}`)}</span>
            <Show when={row().model}>
              {(model) => (
                <span>{language.t("project.settings.knowledge.model", { model: model() })}</span>
              )}
            </Show>
            <Show when={row().indexedAt}>
              {(at) => (
                <span>
                  {language.t("project.settings.knowledge.indexedAt", { time: formatIndexedAt(at()) })}
                </span>
              )}
            </Show>
          </>
        )}
      </Show>
    </div>
  )

  const failed = (title: string) => (error: Error) =>
    showToast({
      variant: "error",
      title,
      description: error.message,
    })

  const toggle = useMutation(() => ({
    mutationFn: async (input: { library: KnowledgeLibrary; enabled: boolean }) => {
      const api = sdk.api

      if (!input.enabled) {
        await api.experimental["server.knowledge"].unassign({ projectID: props.projectID, libraryID: input.library.id })

        return
      }

      await api.experimental["server.knowledge"].assign({ projectID: props.projectID, libraryID: input.library.id })

      try {
        await syncKnowledgeLibrary({ api, platform, library: input.library })
      } catch (error) {
        // A library without its text is not worth searching, so a failed first copy leaves nothing linked.
        await api.experimental["server.knowledge"]
          .unassign({ projectID: props.projectID, libraryID: input.library.id })
          .catch(() => undefined)
        throw error
      }
    },
    onSuccess: () => void queried.refetch(),
    onError: failed(language.t("project.settings.knowledge.linkFailed")),
  }))

  const sync = useMutation(() => ({
    mutationFn: (library: KnowledgeLibrary) => syncKnowledgeLibrary({ api: sdk.api, platform, library }),
    onSuccess: () => void queried.refetch(),
    onError: failed(language.t("project.settings.knowledge.syncFailed")),
  }))

  return (
    <div class="project-settings-knowledge">
      <div class="project-settings-knowledge-copy">
        <span class="project-settings-knowledge-title">{language.t("project.settings.knowledge.title")}</span>
        <span class="project-settings-knowledge-description">
          {language.t("project.settings.knowledge.description")}
        </span>
      </div>

      <Show
        when={libraries.libraries().length > 0}
        fallback={
          <div class="project-settings-knowledge-empty">
            <span>{language.t("project.settings.knowledge.empty")}</span>
            <span class="project-settings-knowledge-description">
              {language.t("project.settings.knowledge.empty.hint")}
            </span>
          </div>
        }
      >
        <Show
          when={!(queried.isError && sdk.connection.status() === "connected")}
          fallback={
            <div class="project-settings-knowledge-empty" role="status">
              <span class="project-settings-knowledge-description">
                {language.t("project.settings.knowledge.loadFailed")}
              </span>
              <Button variant="ghost-muted" onClick={() => void queried.refetch()}>
                {language.t("common.retry")}
              </Button>
            </div>
          }
        >
          <For each={libraries.libraries()}>
            {(library) => {
              const info = () => assigned().get(library.id)
              const pending = () => toggle.isPending && toggle.variables?.library.id === library.id
              const syncing = () => sync.isPending && sync.variables?.id === library.id

              return (
                <SettingsRow title={library.name} description={describe(library, info())} align="start">
                  <div class="project-settings-knowledge-actions">
                    <Show when={info() && desktop()}>
                      <Button
                        variant="ghost-muted"
                        size="small"
                        disabled={sync.isPending}
                        onClick={() => sync.mutate(library)}
                      >
                        {language.t(
                          syncing() ? "project.settings.knowledge.syncing" : "project.settings.knowledge.sync",
                        )}
                      </Button>
                    </Show>
                    <Switch
                      checked={Boolean(info())}
                      disabled={pending() || sync.isPending || (!info() && (!desktop() || library.files.length === 0))}
                      hideLabel
                      onChange={(enabled) => toggle.mutate({ library, enabled })}
                    >
                      {library.name}
                    </Switch>
                  </div>
                </SettingsRow>
              )
            }}
          </For>
        </Show>
      </Show>

      <Show when={!desktop()}>
        <span class="project-settings-knowledge-description">
          {language.t("project.settings.knowledge.desktopOnly")}
        </span>
      </Show>
    </div>
  )
}
