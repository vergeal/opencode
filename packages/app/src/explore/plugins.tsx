import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon, type IconProps } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { createMemo, createResource, Match, Show, Switch, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { ServerConnection } from "@/runtime/server/registry"
import { ExtensionPlugins } from "@/runtime/plugin/extension-plugins"
import { useLayout } from "@/shell/state/layout"
import "@/settings/settings.css"
import { PluginInstallDialog } from "./plugin-install-dialog"

/** The plugins a server lists, with the desktop window's own controls when it runs this server. */
export function ExplorePlugins() {
  const language = useLanguage()
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

  return (
    <div class="explore-scroll min-h-0 flex-1 overflow-y-auto px-6 py-4" data-scrollable>
      <section class="explore-section">
        <header class="explore-section-header">
          <div class="explore-section-copy">
            <h2 class="explore-section-title">{language.t("explore.plugins.installed")}</h2>
            <p class="explore-section-description">{language.t("explore.plugins.installed.description")}</p>
          </div>
          <Button variant="contrast" size="small" icon="plus" onClick={install}>
            {language.t("explore.plugins.install")}
          </Button>
        </header>

        <Switch>
          <Match when={!connected()}>
            <ExploreStatus
              icon="circle-ban-sign"
              title={language.t("explore.plugins.offline.title")}
              description={language.t("explore.plugins.offline.description")}
            />
          </Match>

          <Match when={plugins.loading && listed().length === 0}>
            <div class="explore-loading" role="status" aria-busy="true">
              <Loader />
              <span>{language.t("explore.plugins.loading")}</span>
            </div>
          </Match>

          <Match when={plugins.error}>
            {(error) => (
              <ExploreStatus
                icon="outline-hexagonal-warning"
                title={language.t("explore.plugins.error.title")}
                description={error() instanceof Error ? error().message : String(error())}
                action={
                  <Button size="small" variant="neutral" onClick={() => void refetch()}>
                    {language.t("explore.plugins.error.retry")}
                  </Button>
                }
              />
            )}
          </Match>

          <Match when={listed().length === 0}>
            <ExploreStatus
              icon="cube"
              title={language.t("explore.plugins.empty.title")}
              description={language.t("explore.plugins.empty.description")}
              action={
                <Button size="small" variant="neutral" icon="plus" onClick={install}>
                  {language.t("explore.plugins.install")}
                </Button>
              }
            />
          </Match>

          <Match when={true}>
            <ExtensionPlugins plugins={plugins() ?? []} own={own()} showSource />
          </Match>
        </Switch>
      </section>

      <Show when={connected() && listed().length > 0}>
        <p class="explore-note">{language.t("explore.plugins.install.manual")}</p>
      </Show>
    </div>
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
