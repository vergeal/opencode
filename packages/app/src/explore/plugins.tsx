import type { PluginInfo } from "@opencode/client"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { createMemo, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useExploreInstalled } from "@/explore/installed"
import { pluginLabel } from "@/providers/catalog/plugin"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { PluginSource } from "@/runtime/plugin/extension-plugins"
import { PageHeader } from "@/shell/page"
import { useLayout } from "@/shell/state/layout"
import "@/settings/settings.css"
import "./explore.css"
import { loadCatalog, PLUGIN_CATEGORIES, type CatalogPlugin, type PluginCategory } from "./catalog"
import { PluginInstallDialog } from "./plugin-install-dialog"
import { PluginIcon } from "./plugin-icon"
import { ExploreStatus } from "./status"

const CATEGORY_LABELS: Record<PluginCategory, string> = {
  "developer-tools": "explore.plugins.category.developer-tools",
  productivity: "explore.plugins.category.productivity",
  automation: "explore.plugins.category.automation",
}

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

const pluginKey = (plugin: PluginInfo) => plugin.id ?? pluginLabel(plugin)

/** One installed plugin's card, with the generic plugins mark. */

/** The published plugins this project can install, and whichever entry the list or the column opened. */
export function ExplorePlugins() {
  const layout = useLayout()
  const dialog = useDialog()
  const installed = useExploreInstalled()

  const [catalog] = createResource(loadCatalog)

  // Reading the resource before its first value would suspend the whole pane, so the list stays empty until it lands.
  const catalogPlugins = () => {
    if (catalog.state !== "ready" && catalog.state !== "refreshing") return []

    return catalog.latest?.plugins ?? []
  }

  const selected = createMemo(() =>
    installed.plugins().find((plugin) => pluginKey(plugin) === layout.destination.explore.selected()),
  )

  const catalogEntry = createMemo(() =>
    catalogPlugins().find((entry) => entry.id === layout.destination.explore.catalog()),
  )

  const install = () =>
    void dialog.show(() => <PluginInstallDialog onInstalled={() => void installed.refetchPlugins()} />)

  const installFromCatalog = (entry: CatalogPlugin) =>
    void dialog.show(() => (
      <PluginInstallDialog
        package={entry.package}
        name={entry.name}
        integrated={entry.integrated}
        bundle={entry.bundle}
        id={entry.id}
        entry={entry}
        onInstalled={() => void installed.refetchPlugins()}
      />
    ))

  const back = () => {
    layout.destination.explore.setSelected(undefined)
    layout.destination.explore.setCatalog(undefined)
  }

  return (
    <ExplorePluginsView
      installed={installed.plugins()}
      catalog={catalogPlugins()}
      selected={selected()}
      catalogEntry={catalogEntry()}
      onSelectCatalog={(id) => layout.destination.explore.setCatalog(id)}
      onBack={back}
      onInstall={install}
      onInstallCatalog={installFromCatalog}
      onRefresh={() => void installed.refetchPlugins()}
    />
  )
}

/**
 * The plugins page's presentational half: the catalog grouped by category, or the full page for whichever entry
 * the user opened. It owns no server state, so the same view renders the real page and the component test.
 */
export function ExplorePluginsView(props: {
  /** Plugins this project already loads, so the column and cards can mark an entry installed. */
  installed?: readonly PluginInfo[]
  /** Publishable plugins from the catalog. */
  catalog?: readonly CatalogPlugin[]
  /** The installed plugin the navigation column opened. */
  selected?: PluginInfo
  /** The catalog entry the list opened. */
  catalogEntry?: CatalogPlugin
  onSelectCatalog?: (id: string) => void
  onBack: () => void
  onInstall: () => void
  onInstallCatalog?: (entry: CatalogPlugin) => void
  onRefresh?: () => void
}) {
  const language = useLanguage()

  const [state, setState] = createStore<{ query: string }>({ query: "" })

  const query = () => state.query.trim().toLowerCase()

  // A catalog entry that the server already loads must not offer a second install.
  const installedIDs = createMemo(
    () => new Set((props.installed ?? []).flatMap((plugin) => (plugin.id ? [plugin.id] : []))),
  )

  const groups = createMemo(() => {
    const needle = query()
    const items = (props.catalog ?? []).filter((entry) => {
      if (!needle) return true

      return `${entry.name}\n${entry.description}\n${entry.package}\n${entry.author}`.toLowerCase().includes(needle)
    })

    return PLUGIN_CATEGORIES.flatMap((category) => {
      const entries = items.filter((entry) => entry.category === category)

      return entries.length > 0 ? [{ category, entries }] : []
    })
  })

  // An installed plugin opened from the column, or a catalog entry opened from the list, takes over the page.
  const detail = createMemo(() => {
    if (props.selected) return "installed" as const

    if (props.catalogEntry) return "catalog" as const

    return undefined
  })

  return (
    <Show
      when={detail()}
      fallback={
        <>
          <PageHeader
            title={language.t("explore.plugins.title")}
            description={language.t("explore.plugins.description")}
            inset
            actions={
              <>
                <div class="explore-page-search">
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
                <button
                  type="button"
                  class="explore-plugins-icon-button"
                  aria-label={language.t("explore.plugins.refresh")}
                  title={language.t("explore.plugins.refresh")}
                  onClick={() => props.onRefresh?.()}
                >
                  <Icon name="refresh" />
                </button>
                <Button variant="contrast" size="small" icon="plus" onClick={props.onInstall}>
                  {language.t("explore.plugins.add")}
                </Button>
              </>
            }
          />

          <div class="explore-catalog-body" data-scrollable>
            <div class="explore-page-inner">
              <Show
                when={groups().length > 0}
                fallback={
                  <ExploreStatus
                    icon="outline-pair"
                    title={language.t(query() ? "explore.plugins.noResults.title" : "explore.plugins.none.title")}
                    description={language.t(
                      query() ? "explore.plugins.noResults.description" : "explore.plugins.none.description",
                    )}
                  />
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <section class="explore-catalog-group">
                      <h2 class="explore-catalog-group-title">{language.t(CATEGORY_LABELS[group.category])}</h2>
                      <div class="explore-catalog-grid">
                        <For each={group.entries}>
                          {(entry) => (
                            <PluginCard
                              name={entry.name}
                              description={entry.description}
                              onOpen={() => props.onSelectCatalog?.(entry.id)}
                            />
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </>
      }
    >
      <Show
        when={props.selected}
        fallback={
          <Show when={props.catalogEntry}>
            {(entry) => (
              <CatalogPluginDetail
                entry={entry()}
                installed={installedIDs().has(entry().id)}
                onBack={props.onBack}
                onInstall={() => props.onInstallCatalog?.(entry())}
              />
            )}
          </Show>
        }
      >
        {(plugin) => <PluginDetail plugin={plugin()} onBack={props.onBack} />}
      </Show>
    </Show>
  )
}

/** One catalog plugin: the whole row opens its page. The page owns the install action, so the list only shows what exists. */
function PluginCard(props: {
  name: string
  description: string
  onOpen?: () => void
}) {
  return (
    <div class="explore-catalog-card">
      <button type="button" class="explore-catalog-card-main" onClick={() => props.onOpen?.()}>
        <span class="explore-catalog-card-icon">
          <PluginIcon />
        </span>
        <span class="explore-catalog-card-copy">
          <span class="explore-catalog-card-name">
            <bdi dir="ltr">{props.name}</bdi>
          </span>
          <span class="explore-catalog-card-description">{props.description}</span>
        </span>
      </button>
    </div>
  )
}

function DetailCrumbs(props: { current: string; onBack: () => void }) {
  const language = useLanguage()

  return (
    <nav class="explore-catalog-crumbs" aria-label={language.t("explore.plugins.back")}>
      <button type="button" class="explore-catalog-crumb" onClick={props.onBack}>
        {language.t("explore.plugins.title")}
      </button>
      <Icon name="outline-chevron-right" class="explore-catalog-crumb-separator" />
      <span class="explore-catalog-crumb-current">{props.current}</span>
    </nav>
  )
}

/** A catalog entry's full page: who publishes it, what it does, and the install that adds it to the project. */
function CatalogPluginDetail(props: { entry: CatalogPlugin; installed?: boolean; onBack: () => void; onInstall: () => void }) {
  const language = useLanguage()

  const details = () => props.entry.details ?? props.entry.description

  return (
    <div class="explore-catalog-page" data-scrollable>
      <div class="explore-page-inner">
        <DetailCrumbs current={props.entry.name} onBack={props.onBack} />

        <div class="explore-catalog-page-body">
          <header class="explore-catalog-hero">
            <span class="explore-catalog-hero-icon">
              <PluginIcon />
            </span>
            <div class="explore-catalog-hero-copy">
              <h1 class="explore-catalog-hero-name">
                <bdi dir="ltr">{props.entry.name}</bdi>
              </h1>
              <p class="explore-catalog-hero-meta">
                {language.t("explore.plugins.by", { author: props.entry.author })} · {props.entry.description}
              </p>
            </div>
            <Show
              when={!props.installed}
              fallback={
                <span class="explore-catalog-hero-installed">{language.t("explore.plugins.installed")}</span>
              }
            >
              <Button variant="contrast" size="small" icon="plus" onClick={props.onInstall}>
                {language.t("explore.plugins.install")}
              </Button>
            </Show>
          </header>

          <p class="explore-catalog-about">{details()}</p>

          <Show when={props.entry.mcpServers?.length}>
            {(count) => (
              <section class="explore-catalog-section">
                <h2 class="explore-catalog-section-title">
                  {language.t("explore.plugins.detail.mcp")}
                  <span class="explore-catalog-section-count">{count()}</span>
                </h2>
                <ul class="explore-catalog-list">
                  <For each={props.entry.mcpServers}>
                    {(server) => (
                      <li class="explore-catalog-list-row">
                        <span class="explore-catalog-list-icon">
                          <Icon name="outline-pair" />
                        </span>
                        <span class="explore-catalog-list-name">{server.name}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </Show>

          <Show when={props.entry.skills?.length}>
            {(count) => (
              <section class="explore-catalog-section">
                <h2 class="explore-catalog-section-title">
                  {language.t("explore.plugins.detail.skills")}
                  <span class="explore-catalog-section-count">{count()}</span>
                </h2>
                <ul class="explore-catalog-list">
                  <For each={props.entry.skills}>
                    {(skill) => (
                      <li class="explore-catalog-list-row explore-catalog-skill">
                        <span class="explore-catalog-list-icon">
                          <Icon name="post-skill" />
                        </span>
                        <span class="explore-catalog-skill-copy">
                          <span class="explore-catalog-list-name">{skill.name}</span>
                          <span class="explore-catalog-skill-description">{skill.description}</span>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </Show>

          <dl class="explore-catalog-facts">
            <div>
              <dt>
                {language.t(
                  props.entry.integrated ? "explore.plugins.discover.integration" : "explore.plugins.discover.package",
                )}
              </dt>
              <dd>
                {props.entry.integrated ? (
                  language.t("explore.plugins.install.integrated")
                ) : (
                  <code dir="ltr">{props.entry.package}</code>
                )}
              </dd>
            </div>
            <div>
              <dt>{language.t("explore.plugins.discover.repository")}</dt>
              <dd>
                <ExternalLink href={props.entry.repository}>{props.entry.repository}</ExternalLink>
              </dd>
            </div>
          </dl>

          <p class="explore-note">
            {language.t(
              props.entry.integrated ? "explore.plugins.install.integrated.note" : "explore.plugins.install.manual",
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

/** An installed plugin's page: how it loads, whether it is healthy, and where its module lives. */
function PluginDetail(props: { plugin: PluginInfo; onBack: () => void }) {
  const language = useLanguage()

  const failed = () => (props.plugin.state.status === "failed" ? props.plugin.state : undefined)

  return (
    <div class="explore-catalog-page" data-scrollable>
      <div class="explore-page-inner">
        <DetailCrumbs current={pluginLabel(props.plugin)} onBack={props.onBack} />

        <div class="explore-catalog-page-body">
          <header class="explore-catalog-hero">
            <span class="explore-catalog-hero-icon">
              <PluginIcon />
            </span>
            <div class="explore-catalog-hero-copy">
              <h1 class="explore-catalog-hero-name">
                <bdi dir="ltr">{pluginLabel(props.plugin)}</bdi>
              </h1>
              <p class="explore-catalog-hero-meta">
                <PluginSource source={props.plugin.source.type} />
                <Show when={sourceDetail(props.plugin)}>
                  {(target) => (
                    <span class="explore-catalog-path" dir="ltr" title={target()}>
                      {target()}
                    </span>
                  )}
                </Show>
              </p>
            </div>
          </header>

          <dl class="explore-catalog-facts">
            <Show when={props.plugin.id && !props.plugin.display}>
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

            <Show when={!props.plugin.display && featuresOf(props.plugin).length > 0}>
              <div>
                <dt>{language.t("explore.plugins.detail.features")}</dt>
                <dd>
                  {featuresOf(props.plugin).map((feature) => (
                    <span class="explore-catalog-feature">{language.t(featureLabels[feature])}</span>
                  ))}
                </dd>
              </div>
            </Show>
          </dl>

          <Show when={props.plugin.display?.description}>
            {(description) => <p class="explore-catalog-about">{description()}</p>}
          </Show>

          <Show when={props.plugin.display?.skills?.length}>
            {(count) => (
              <section class="explore-catalog-section">
                <h2 class="explore-catalog-section-title">
                  {language.t("explore.plugins.detail.skills")}
                  <span class="explore-catalog-section-count">{count()}</span>
                </h2>
                <ul class="explore-catalog-list">
                  <For each={props.plugin.display?.skills}>
                    {(skill) => (
                      <li class="explore-catalog-list-row explore-catalog-skill">
                        <span class="explore-catalog-list-icon">
                          <Icon name="post-skill" />
                        </span>
                        <span class="explore-catalog-skill-copy">
                          <span class="explore-catalog-list-name">{skill.name}</span>
                          <span class="explore-catalog-skill-description">{skill.description}</span>
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </Show>

          <Show when={props.plugin.display?.tools?.length}>
            {(count) => (
              <section class="explore-catalog-section">
                <h2 class="explore-catalog-section-title">
                  {language.t("explore.plugins.detail.tools")}
                  <span class="explore-catalog-section-count">{count()}</span>
                </h2>
                <ul class="explore-catalog-list">
                  <For each={props.plugin.display?.tools}>
                    {(tool) => (
                      <li class="explore-catalog-list-row">
                        <span class="explore-catalog-list-icon">
                          <Icon name="outline-pair" />
                        </span>
                        <code class="explore-catalog-list-name" dir="ltr">
                          {tool}
                        </code>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </Show>

          <Show when={failed()}>
            {(state) => (
              <p class="explore-form-error" role="alert">
                {state().error}
              </p>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
