import type { PluginInfo } from "@opencode/client"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon, type IconProps } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { createMemo, createResource, For, Show, type JSX } from "solid-js"
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

  const install = () => void dialog.show(() => <PluginInstallDialog directory={installed.directory()} />)

  const installFromCatalog = (entry: CatalogPlugin) =>
    void dialog.show(() => <PluginInstallDialog directory={installed.directory()} package={entry.package} />)

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
      onSelectInstalled={(id) => layout.destination.explore.setSelected(id)}
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
  /** Plugins this project already loads, listed under the personal tab. */
  installed?: readonly PluginInfo[]
  /** Publishable plugins from the catalog. */
  catalog?: readonly CatalogPlugin[]
  /** The installed plugin the navigation column opened. */
  selected?: PluginInfo
  /** The catalog entry the list opened. */
  catalogEntry?: CatalogPlugin
  onSelectInstalled?: (id: string) => void
  onSelectCatalog?: (id: string) => void
  onBack: () => void
  onInstall: () => void
  onInstallCatalog?: (entry: CatalogPlugin) => void
  onRefresh?: () => void
}) {
  const language = useLanguage()

  const [state, setState] = createStore<{ query: string; tab: "public" | "personal" }>({
    query: "",
    tab: "public",
  })

  const query = () => state.query.trim().toLowerCase()

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

  const personal = createMemo(() => {
    const needle = query()

    if (!needle) return props.installed ?? []

    return (props.installed ?? []).filter((plugin) =>
      `${pluginLabel(plugin)}\n${plugin.source.type}`.toLowerCase().includes(needle),
    )
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

          <div class="explore-plugins-body" data-scrollable>
            <div class="explore-plugin-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                class="explore-plugin-tab"
                aria-selected={state.tab === "public"}
                data-selected={state.tab === "public" ? "" : undefined}
                onClick={() => setState("tab", "public")}
              >
                {language.t("explore.plugins.tab.public")}
              </button>
              <button
                type="button"
                role="tab"
                class="explore-plugin-tab"
                aria-selected={state.tab === "personal"}
                data-selected={state.tab === "personal" ? "" : undefined}
                onClick={() => setState("tab", "personal")}
              >
                {language.t("explore.plugins.tab.personal")}
              </button>
            </div>

            <Show
              when={state.tab === "public"}
              fallback={<InstalledGrid plugins={personal()} onOpen={props.onSelectInstalled} />}
            >
              <Show
                when={groups().length > 0}
                fallback={
                  <ExploreStatus
                    icon="magnifying-glass"
                    title={language.t("explore.plugins.noResults.title")}
                    description={language.t("explore.plugins.noResults.description")}
                  />
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <section class="explore-plugin-group">
                      <h2 class="explore-plugin-group-title">{language.t(CATEGORY_LABELS[group.category])}</h2>
                      <div class="explore-plugin-grid">
                        <For each={group.entries}>
                          {(entry) => (
                            <PluginCard
                              name={entry.name}
                              description={entry.description}
                              folder
                              addLabel={language.t("explore.plugins.install")}
                              onOpen={() => props.onSelectCatalog?.(entry.id)}
                              onAdd={() => props.onInstallCatalog?.(entry)}
                            />
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </Show>
            </Show>
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
                onBack={props.onBack}
                onInstall={() => props.onInstallCatalog?.(entry())}
              />
            )}
          </Show>
        }
      >
        {(plugin) => <PluginDetail plugin={plugin()} onBack={props.onBack} onInstall={props.onInstall} />}
      </Show>
    </Show>
  )
}

function InstalledGrid(props: { plugins: readonly PluginInfo[]; onOpen?: (id: string) => void }) {
  const language = useLanguage()

  return (
    <Show
      when={props.plugins.length > 0}
      fallback={
        <ExploreStatus
          icon="outline-pair"
          title={language.t("explore.plugins.empty.title")}
          description={language.t("explore.plugins.empty.description")}
        />
      }
    >
      <div class="explore-plugin-grid">
        <For each={props.plugins}>
          {(plugin) => (
            <PluginCard
              name={pluginLabel(plugin)}
              description={plugin.source.type === "package" ? plugin.source.target : (sourceDetail(plugin) ?? "")}
              onOpen={() => props.onOpen?.(pluginKey(plugin))}
            />
          )}
        </For>
      </div>
    </Show>
  )
}

/** One catalog or installed plugin: the whole row opens its page, the trailing plus installs it. */
function PluginCard(props: {
  name: string
  description: string
  folder?: boolean
  addLabel?: string
  onOpen?: () => void
  onAdd?: () => void
}) {
  return (
    <div class="explore-plugin-card">
      <button type="button" class="explore-plugin-card-main" onClick={() => props.onOpen?.()}>
        <span class="explore-plugin-card-icon">
          <Icon name="outline-pair" />
        </span>
        <span class="explore-plugin-card-copy">
          <span class="explore-plugin-card-name">
            <bdi dir="ltr">{props.name}</bdi>
            <Show when={props.folder}>
              <Icon name="folder" class="explore-plugin-card-folder" />
            </Show>
          </span>
          <span class="explore-plugin-card-description">{props.description}</span>
        </span>
      </button>
      <Show when={props.onAdd}>
        <button
          type="button"
          class="explore-plugin-card-add"
          aria-label={props.addLabel}
          title={props.addLabel}
          onClick={() => props.onAdd?.()}
        >
          <Icon name="plus" />
        </button>
      </Show>
    </div>
  )
}

function DetailCrumbs(props: { current: string; onBack: () => void }) {
  const language = useLanguage()

  return (
    <nav class="explore-plugin-crumbs" aria-label={language.t("explore.plugins.back")}>
      <button type="button" class="explore-plugin-crumb" onClick={props.onBack}>
        {language.t("explore.plugins.title")}
      </button>
      <Icon name="outline-chevron-right" class="explore-plugin-crumb-separator" />
      <span class="explore-plugin-crumb-current">{props.current}</span>
    </nav>
  )
}

/** A catalog entry's full page: who publishes it, what it does, and the install that adds it to the project. */
function CatalogPluginDetail(props: { entry: CatalogPlugin; onBack: () => void; onInstall: () => void }) {
  const language = useLanguage()

  const details = () => props.entry.details ?? props.entry.description

  return (
    <div class="explore-plugin-page" data-scrollable>
      <DetailCrumbs current={props.entry.name} onBack={props.onBack} />

      <div class="explore-plugin-page-body">
        <header class="explore-plugin-hero">
          <span class="explore-plugin-hero-icon">
            <Icon name="outline-pair" />
          </span>
          <div class="explore-plugin-hero-copy">
            <h1 class="explore-plugin-hero-name">
              <bdi dir="ltr">{props.entry.name}</bdi>
              <Icon name="folder" class="explore-plugin-card-folder" />
            </h1>
            <p class="explore-plugin-hero-meta">
              {language.t("explore.plugins.by", { author: props.entry.author })} · {props.entry.description}
            </p>
          </div>
          <Button variant="contrast" size="small" icon="plus" onClick={props.onInstall}>
            {language.t("explore.plugins.install")}
          </Button>
        </header>

        <p class="explore-plugin-about">{details()}</p>

        <Show when={props.entry.mcpServers?.length}>
          {(count) => (
            <section class="explore-plugin-section">
              <h2 class="explore-plugin-section-title">
                {language.t("explore.plugins.detail.mcp")}
                <span class="explore-plugin-section-count">{count()}</span>
              </h2>
              <ul class="explore-plugin-list">
                <For each={props.entry.mcpServers}>
                  {(server) => (
                    <li class="explore-plugin-list-row">
                      <span class="explore-plugin-list-icon">
                        <Icon name="outline-pair" />
                      </span>
                      <span class="explore-plugin-list-name">{server.name}</span>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          )}
        </Show>

        <Show when={props.entry.skills?.length}>
          {(count) => (
            <section class="explore-plugin-section">
              <h2 class="explore-plugin-section-title">
                {language.t("explore.plugins.detail.skills")}
                <span class="explore-plugin-section-count">{count()}</span>
              </h2>
              <ul class="explore-plugin-list">
                <For each={props.entry.skills}>
                  {(skill) => (
                    <li class="explore-plugin-list-row explore-plugin-skill">
                      <span class="explore-plugin-list-icon">
                        <Icon name="post-skill" />
                      </span>
                      <span class="explore-plugin-skill-copy">
                        <span class="explore-plugin-list-name">{skill.name}</span>
                        <span class="explore-plugin-skill-description">{skill.description}</span>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          )}
        </Show>

        <dl class="explore-plugin-facts">
          <div>
            <dt>{language.t("explore.plugins.discover.package")}</dt>
            <dd>
              <code dir="ltr">{props.entry.package}</code>
            </dd>
          </div>
          <div>
            <dt>{language.t("explore.plugins.discover.repository")}</dt>
            <dd>
              <ExternalLink href={props.entry.repository}>{props.entry.repository}</ExternalLink>
            </dd>
          </div>
        </dl>

        <p class="explore-note">{language.t("explore.plugins.install.manual")}</p>
      </div>
    </div>
  )
}

/** An installed plugin's page: how it loads, whether it is healthy, and where its module lives. */
function PluginDetail(props: { plugin: PluginInfo; onBack: () => void; onInstall: () => void }) {
  const language = useLanguage()

  const failed = () => (props.plugin.state.status === "failed" ? props.plugin.state : undefined)

  return (
    <div class="explore-plugin-page" data-scrollable>
      <DetailCrumbs current={pluginLabel(props.plugin)} onBack={props.onBack} />

      <div class="explore-plugin-page-body">
        <header class="explore-plugin-hero">
          <span class="explore-plugin-hero-icon">
            <Icon name="outline-pair" />
          </span>
          <div class="explore-plugin-hero-copy">
            <h1 class="explore-plugin-hero-name">
              <bdi dir="ltr">{pluginLabel(props.plugin)}</bdi>
            </h1>
            <p class="explore-plugin-hero-meta">
              <PluginSource source={props.plugin.source.type} />
              <Show when={sourceDetail(props.plugin)}>
                {(target) => (
                  <span class="explore-skills-path" dir="ltr" title={target()}>
                    {target()}
                  </span>
                )}
              </Show>
            </p>
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
      </div>
    </div>
  )
}

function ExploreStatus(props: { icon: IconProps["name"]; title: string; description: string; action?: JSX.Element }) {
  return (
    <div class="explore-status">
      <Icon name={props.icon} size="small" class="explore-status-icon" />
      <p class="explore-status-title">{props.title}</p>
      <p class="explore-status-description">{props.description}</p>
      {props.action}
    </div>
  )
}
