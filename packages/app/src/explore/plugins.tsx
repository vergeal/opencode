import type { PluginInfo } from "@opencode/client"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon, type IconProps } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { createEffect, createMemo, createResource, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { pluginLabel } from "@/providers/catalog/plugin"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ExtensionPlugins, PluginSource } from "@/runtime/plugin/extension-plugins"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { useLayout } from "@/shell/state/layout"
import "@/settings/settings.css"
import "./explore.css"
import { PluginInstallDialog } from "./plugin-install-dialog"
import { ExploreSkeleton } from "./skeleton"

type ExploreStatusKind = "offline" | "loading" | "error" | "ready"

const featureLabels = {
  server: "explore.plugins.feature.server",
  tui: "explore.plugins.feature.tui",
  rpc: "explore.plugins.feature.rpc",
  gui: "explore.plugins.feature.gui",
} as const

const featureKeys: Array<keyof typeof featureLabels> = ["server", "tui", "rpc", "gui"]

const featuresOf = (plugin: PluginInfo) => featureKeys.filter((key) => plugin.features[key])

const sourceDetail = (plugin: PluginInfo) => {
  if (plugin.source.type === "package") return plugin.source.target

  if (plugin.source.type === "local") return plugin.source.path

  return undefined
}

/** The plugins a server lists, with the desktop window's own controls when it runs this server. */
export function ExplorePlugins() {
  const serverSdk = useServerSDK()
  const platform = usePlatform()
  const layout = useLayout()
  const data = useData()
  const dialog = useDialog()

  const connected = () => serverSdk.connection.status() === "connected"

  const [plugins, { refetch }] = createResource(connected, () =>
    serverSdk.api.plugin.list().then((result) => result.data),
  )

  // Built-ins always run, so a server with only built-ins has nothing to manage here.
  const listed = createMemo(() => (plugins() ?? []).filter((plugin) => plugin.source.type !== "builtin"))

  // Only the desktop window that owns this server runs its plugins' GUIs, so only it shows the window controls.
  const own = () => !!platform.plugins && ServerConnection.builtin(serverSdk.server)

  const directory = () => layout.home.selection().directory ?? data.location.default().directory

  const install = () => void dialog.show(() => <PluginInstallDialog directory={directory()} />)

  const status = (): ExploreStatusKind => {
    if (!connected()) return "offline"

    if (plugins.loading && listed().length === 0) return "loading"

    if (plugins.error) return "error"

    return "ready"
  }

  const error = () =>
    plugins.error instanceof Error ? plugins.error.message : plugins.error ? String(plugins.error) : undefined

  return (
    <ExplorePluginsView
      plugins={listed()}
      status={status()}
      error={error()}
      own={own()}
      onInstall={install}
      onRetry={() => void refetch()}
    />
  )
}

/**
 * The plugins pane's presentational half: search, the list, and the selected plugin's details. It owns no server
 * state, so the same view renders the real page and the component test's fixtures.
 */
export function ExplorePluginsView(props: {
  plugins: readonly PluginInfo[]
  status: ExploreStatusKind
  error?: string
  own: boolean
  onInstall: () => void
  onRetry: () => void
}) {
  const language = useLanguage()

  const [state, setState] = createStore<{ query: string; selected?: string }>({ query: "" })

  const idOf = (plugin: PluginInfo) => plugin.id ?? pluginLabel(plugin)

  const filtered = createMemo(() => {
    const query = state.query.trim().toLowerCase()

    if (!query) return props.plugins

    return props.plugins.filter((plugin) => {
      const haystack = `${pluginLabel(plugin)}\n${plugin.id ?? ""}\n${sourceDetail(plugin) ?? ""}`.toLowerCase()

      return haystack.includes(query)
    })
  })

  const selected = createMemo(() => props.plugins.find((plugin) => idOf(plugin) === state.selected))

  // A selection that the search no longer shows, or a list that reloaded without it, clears to the placeholder.
  createEffect(() => {
    if (props.status !== "ready") return

    const current = state.selected

    if (!current) return

    if (filtered().some((plugin) => idOf(plugin) === current)) return

    setState("selected", undefined)
  })

  const select = (id: string) => setState("selected", id)

  return (
    <div class="explore-plugins">
      <aside class="explore-plugins-list">
        <header class="explore-plugins-header">
          <div class="explore-section-copy">
            <h2 class="explore-section-title">{language.t("explore.plugins.installed")}</h2>
            <p class="explore-section-description">{language.t("explore.plugins.installed.description")}</p>
          </div>
          <Button variant="contrast" size="small" icon="plus" onClick={props.onInstall}>
            {language.t("explore.plugins.install")}
          </Button>
        </header>

        <Show when={props.status === "ready" && props.plugins.length > 0}>
          <div class="explore-plugins-search">
            <TextInput
              type="search"
              appearance="base"
              leadingIcon={<Icon name="magnifying-glass" size="small" />}
              value={state.query}
              placeholder={language.t("explore.plugins.search.placeholder")}
              aria-label={language.t("explore.plugins.search.placeholder")}
              showClearButton={!!state.query}
              clearIcon="circle-xmark"
              onClearClick={() => setState("query", "")}
              onInput={(event) => setState("query", event.currentTarget.value)}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
            />
          </div>
        </Show>

        <div class="explore-plugins-scroll" data-scrollable>
          <Switch>
            <Match when={props.status === "offline"}>
              <ExploreStatus
                icon="circle-ban-sign"
                title={language.t("explore.plugins.offline.title")}
                description={language.t("explore.plugins.offline.description")}
              />
            </Match>

            <Match when={props.status === "loading"}>
              <ExploreSkeleton rows={5} />
            </Match>

            <Match when={props.status === "error"}>
              <ExploreStatus
                icon="outline-hexagonal-warning"
                title={language.t("explore.plugins.error.title")}
                description={props.error ?? ""}
                action={
                  <Button size="small" variant="neutral" onClick={props.onRetry}>
                    {language.t("explore.plugins.error.retry")}
                  </Button>
                }
              />
            </Match>

            <Match when={props.plugins.length === 0}>
              <ExploreStatus
                icon="cube"
                title={language.t("explore.plugins.empty.title")}
                description={language.t("explore.plugins.empty.description")}
                action={
                  <Button size="small" variant="neutral" icon="plus" onClick={props.onInstall}>
                    {language.t("explore.plugins.install")}
                  </Button>
                }
              />
            </Match>

            <Match when={filtered().length === 0}>
              <ExploreStatus
                icon="magnifying-glass"
                title={language.t("explore.plugins.noResults.title")}
                description={language.t("explore.plugins.noResults.description")}
              />
            </Match>

            <Match when={true}>
              <ExtensionPlugins
                plugins={filtered()}
                own={props.own}
                showSource
                selected={state.selected}
                onSelect={select}
              />
            </Match>
          </Switch>
        </div>

        <Show when={props.status === "ready" && props.plugins.length > 0}>
          <p class="explore-note">{language.t("explore.plugins.install.manual")}</p>
        </Show>
      </aside>

      <section class="explore-plugins-detail" data-scrollable>
        <Show
          when={props.status === "ready" && selected()}
          fallback={
            <div class="explore-skills-placeholder">
              <p class="explore-skills-placeholder-title">{language.t("explore.plugins.select.title")}</p>
              <p class="explore-skills-placeholder-description">{language.t("explore.plugins.select.description")}</p>
            </div>
          }
        >
          {(plugin) => <PluginDetail plugin={plugin()} onInstall={props.onInstall} />}
        </Show>
      </section>
    </div>
  )
}

function PluginDetail(props: { plugin: PluginInfo; onInstall: () => void }) {
  const language = useLanguage()

  const failed = () => (props.plugin.state.status === "failed" ? props.plugin.state : undefined)

  return (
    <>
      <header class="explore-plugin-detail-header">
        <h3 class="explore-skills-title">
          <bdi dir="ltr">{pluginLabel(props.plugin)}</bdi>
        </h3>
        <div class="explore-plugin-detail-meta">
          <PluginSource source={props.plugin.source.type} />
          <Show when={sourceDetail(props.plugin)}>
            {(target) => (
              <span class="explore-skills-path" dir="ltr" title={target()}>
                {target()}
              </span>
            )}
          </Show>
        </div>
      </header>

      <dl class="explore-plugin-facts">
        <Show when={props.plugin.id}>
          {(id) => (
            <div>
              <dt>{language.t("explore.plugins.detail.id")}</dt>
              <dd>
                <code dir="ltr">{id()}</code>
              </dd>
            </div>
          )}
        </Show>

        <div>
          <dt>{language.t("explore.plugins.detail.state")}</dt>
          <dd>{language.t(failed() ? "explore.plugins.state.failed" : "explore.plugins.state.active")}</dd>
        </div>

        <Show when={featuresOf(props.plugin).length > 0}>
          <div>
            <dt>{language.t("explore.plugins.detail.features")}</dt>
            <dd>
              {featuresOf(props.plugin).map((feature) => (
                <span class="explore-plugin-feature">{language.t(featureLabels[feature])}</span>
              ))}
            </dd>
          </div>
        </Show>
      </dl>

      <Show when={failed()}>
        {(state) => (
          <p class="explore-form-error" role="alert">
            {state().error}
          </p>
        )}
      </Show>

      <p class="explore-note explore-plugin-detail-note">{language.t("explore.plugins.detail.install")}</p>

      <Button size="small" variant="neutral" icon="plus" onClick={props.onInstall}>
        {language.t("explore.plugins.install")}
      </Button>
    </>
  )
}

function ExploreStatus(props: { icon: IconProps["name"]; title: string; description: string; action?: JSX.Element }) {
  return (
    <div class="explore-status">
      <span class="explore-status-icon">
        <Icon name={props.icon} />
      </span>
      <p class="explore-status-title">{props.title}</p>
      <p class="explore-status-description">{props.description}</p>
      {props.action}
    </div>
  )
}
