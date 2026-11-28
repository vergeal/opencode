import { Button } from "@aicraft/ui/button"
import { Badge } from "@aicraft/ui/badge"
import { useDialog } from "@aicraft/ui/context/dialog"
import { Icon } from "@aicraft/ui/icon"
import { Loader } from "@aicraft/ui/loader"
import { Menu } from "@aicraft/ui/menu"
import { AicraftLogo } from "@/providers/aicraft-logo"
import { showToast } from "@/shell/notifications/toast"
import { useQuery } from "@tanstack/solid-query"
import { CustomProviderEditor } from "./custom/editor"
import { DialogDeleteCustomProvider } from "./custom/delete-dialog"
import { customProvidersFrom, readOnlyProvidersFrom, type CustomProvider } from "./custom/record"
import { useProviders } from "@/providers/catalog/providers"
import { isPopularProvider, providerRank } from "@/providers/catalog/order"
import { consoleProviderGroup } from "@/providers/catalog/console"
import { useIntegrations } from "@/providers/catalog/integrations"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Component, For, Match, type JSX, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { CONSOLE_INTEGRATION } from "@/providers/connect/controller"
import { DialogConnectProvider, useProviderConnectController } from "@/providers/connect/dialog"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { SettingsList } from "@/settings/list"
import { activeProviderAccount, providerAccounts, type ProviderAccount } from "./accounts"
import { ProviderAccountList } from "./account-list"
import { useProviderAccountActions } from "./account-actions"
import { SettingsPageHeader } from "@/settings/page-header"
import {
  connectedProviders,
  createProviderDisconnectState,
  transitionProviderDisconnect,
  type ProviderDisconnectEffect,
  type ProviderDisconnectEvent,
} from "./machine"
import "@/settings/settings.css"
import "./providers.css"

type ProviderSource = "env" | "api" | "account" | "config" | "custom"

type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

/**
 * A disconnect the list asks to confirm. Deleting a credential is the one action here that loses the user's data, so a
 * single menu click never performs it. Accounts are removed inside their own list, which asks there.
 */
type PendingRemoval = {
  readonly kind: "disconnect"
  readonly providerID: string
  readonly integrationID: string
  readonly providerIDs: readonly string[]
  readonly providerName: string
}

const PROVIDER_NOTES = [
  { match: (id: string) => id === "opencode", key: "dialog.provider.aicraft.note" },
  { match: (id: string) => id === "opencode-go", key: "dialog.provider.aicraftGo.tagline" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id === "claude-agent", key: "dialog.provider.claudeAgent.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component<{
  directory: string | undefined
  onSelectProvider?: (providerID: string) => void
  headerAction?: JSX.Element
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const providers = useProviders(() => props.directory)
  const integrations = useIntegrations(() => props.directory)
  const providerConnect = useProviderConnectController()
  const accountActions = useProviderAccountActions(() => props.directory)

  const [state, setState] = createStore<{
    consoleExpanded: boolean
    held?: ProviderItem[]
    confirming?: PendingRemoval
    /** The page that replaces the list: a provider being created, or one being edited by id. */
    editor?: { mode: "create" } | { mode: "edit"; id: string }
  }>({
    consoleExpanded: false,
  })

  const [disconnects, setDisconnects] = createSignal(createProviderDisconnectState())

  // Custom providers are the ones declared in the document the server would write; everything else in a
  // configuration file stays read-only here.
  const config = useQuery(() => ({
    queryKey: [serverSdk.scope, "settings-provider-config", props.directory],
    enabled: serverSdk.connection.status() === "connected",
    queryFn: () =>
      serverSdk.api.config.get({ location: props.directory ? { directory: props.directory } : undefined }),
  }))

  onCleanup(serverSdk.event.on("config.updated", () => void config.refetch()))

  // The integration list carries the accounts but not which one is active, so the credential list supplies that bit.
  const credentials = useQuery(() => ({
    queryKey: [serverSdk.scope, "settings-provider-credentials"],
    enabled: serverSdk.connection.status() === "connected",
    queryFn: () => serverSdk.api.credential.list(),
  }))

  const isActiveCredential = (credentialID: string) =>
    credentials.data?.some((entry) => entry.id === credentialID && entry.active)

  // Discovery borrows the key the provider already stores while the key field stays empty, the same way saving an
  // unchanged field keeps it. The copy never reaches the form or the configuration document.
  const existingApiKey = (provider?: CustomProvider) => {
    if (!provider) return

    const entry = credentials.data?.find(
      (credential) => credential.integrationID === provider.id && credential.active,
    )

    if (entry?.value.type === "key") return entry.value.key
  }

  const custom = createMemo(() =>
    customProvidersFrom(config.isPending || config.isError ? [] : (config.data ?? [])),
  )

  const customProvider = (id: string) => custom().find((item) => item.id === id)

  // A provider the page cannot edit because only a read-only document declares it still gets a row, so it says why
  // instead of simply losing its actions.
  const readOnly = createMemo(() =>
    readOnlyProvidersFrom(config.isPending || config.isError ? [] : (config.data ?? [])),
  )

  const dispatch = (event: ProviderDisconnectEvent) => {
    const result = transitionProviderDisconnect(untrack(disconnects), event)
    setDisconnects(result.state)
    result.effects.forEach(run)
  }

  // Results that arrive after Settings closes still report through a toast, as the user asked for the change.
  const run = (effect: ProviderDisconnectEffect) => {
    if (effect.type === "disconnect.run") {
      void serverSdk.api.integration
        .get({
          integrationID: effect.integrationID,
          location: props.directory ? { directory: props.directory } : undefined,
        })
        .then(async (integration) => {
          const credentials = integration.data?.connections.filter((item) => item.type === "credential") ?? []

          if (credentials.length === 0) {
            dispatch({ type: "disconnect.failed", attempt: effect.attempt, reason: { kind: "no-credentials" } })

            return
          }

          await Promise.all(
            credentials.map((credential) => serverSdk.api.credential.remove({ credentialID: credential.id })),
          )
          dispatch({ type: "disconnect.succeeded", attempt: effect.attempt })
        })
        .catch((error) =>
          dispatch({ type: "disconnect.failed", attempt: effect.attempt, reason: { kind: "request", error } }),
        )

      return
    }

    if (effect.type === "toast.disconnected") {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.disconnect.toast.disconnected.title", { provider: effect.providerName }),
        description: language.t("provider.disconnect.toast.disconnected.description", {
          provider: effect.providerName,
        }),
      })

      return
    }

    showToast({
      title: language.t("common.requestFailed"),
      description:
        effect.reason.kind === "no-credentials"
          ? language.t("provider.disconnect.toast.noCredentials.description", { provider: effect.providerName })
          : language.tDynamic(
              "provider.disconnect.toast.failed.description",
              formatServerError(effect.reason.error, language.t),
              { provider: effect.providerName },
            ),
    })
  }

  // Console-managed providers (`opencode-go`, `console-*`) connect through the `opencode`
  // integration, so the lookup must follow `integrationID` rather than the provider id.
  const integration = (item: ProviderItem) => {
    const id = item.integrationID ?? item.id

    return integrations.list().find((entry) => entry.id === id)
  }

  const connect = (provider?: string) => {
    // The list stays as it was while the dialog connects, so a new sign-in that briefly drops the
    // Console workspace providers from the catalog can't flash rows behind the dialog.
    setState("held", available())
    providerConnect.select(provider)
    void dialog.show(
      () => (
        <DialogConnectProvider
          directory={props.directory}
          defaultLocation={props.directory === undefined}
          controller={providerConnect}
          onConnected={(providerID) => dispatch({ type: "provider.reconnected", providerID })}
        />
      ),
      () =>
        void accountActions
          .refresh()
          .catch(() => undefined)
          .finally(() => {
            void credentials.refetch()
            setState("held", undefined)
          }),
    )
  }

  // Accounts belong to the provider, and the list sits under the provider's own row: names, masked keys, reveal,
  // activation, rename, removal and adding all happen in place. Keeping them here instead of a dialog means the page
  // never hides what it is asking about.
  const accountList = (item: ProviderItem) => {
    const current = integration(item)

    return {
      integrationID: item.integrationID ?? item.id,
      activeID: activeProviderAccount(current, isActiveCredential)?.id,
      items: providerAccounts(current),
    }
  }

  // The credential list is the only place the stored secret is readable, and it is what the row masks.
  const accountKey = (account: ProviderAccount) => {
    const entry = credentials.data?.find((item) => item.id === account.id)

    return entry?.value.type === "key" ? entry.value.key : undefined
  }

  // An environment variable is the provider's only source, so offering to store a key there would contradict the row.
  const canStoreKey = (item: ProviderItem) => source(item) !== "env"

  const available = createMemo(() => {
    if (state.held) return state.held
    const connected = providers.connected()
    const managedConsole = consoleProviderGroup(connected)

    const consoleConnected = integrations
      .list()
      .find((item) => item.id === CONSOLE_INTEGRATION)
      ?.connections.some((connection) => connection.type === "credential" || connection.type === "env")

    return connected
      .filter(
        (provider) =>
          provider.id !== "opencode" ||
          managedConsole !== undefined ||
          consoleConnected ||
          Object.values(provider.models).some((model) => model.cost.input > 0),
      )
      .toSorted((a, b) => Number(b.id === "opencode-go") - Number(a.id === "opencode-go"))
  })

  // Tells the machine which providers the server catalog lists, so a confirmed removal stops hiding a
  // provider once the server drops it and shows it again if it is later reconnected.
  createEffect(
    on(
      () => available().map((item) => item.id),
      (providerIDs) => dispatch({ type: "catalog.synced", providerIDs }),
    ),
  )

  const connected = createMemo(() => connectedProviders(disconnects(), available()))

  const consoleGroup = createMemo(() => consoleProviderGroup(available()))

  // Providers the Console groups under one account are folded into that group, and custom providers get their own
  // section, so "connected" only lists what the catalog connects directly.
  const groupedIDs = createMemo(() => {
    const group = consoleGroup()

    return new Set(group ? group.providers.filter((item) => item.id !== group.root.id).map((item) => item.id) : [])
  })

  const customIDs = createMemo(() => new Set(custom().map((item) => item.id)))

  const displayed = createMemo(() =>
    connected().filter((item) => !groupedIDs().has(item.id) && !customIDs().has(item.id)),
  )

  const customRows = createMemo(() => connected().filter((item) => !groupedIDs().has(item.id) && customIDs().has(item.id)))

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    // The Console account (integration `opencode`) shares its id with the Zen provider. A stored API
    // key, including one imported from a v1 auth.json, makes Zen "connected" without any account, so
    // the Popular list keeps the sign-in row until the active credential is an OAuth grant. Until the
    // integration list arrives the row is still the models.dev Zen provider, so dedupe it as before.
    const account = integrations.list().find((entry) => entry.id === CONSOLE_INTEGRATION)

    const items = integrations
      .list()
      .filter((p) => !customIDs().has(p.id) && isPopularProvider(p.id))
      .map((p) => ({ id: p.id, name: p.name }))
      .filter((p) => {
        if (p.id !== CONSOLE_INTEGRATION || !account) return !connectedIDs.has(p.id)

        return account.connections.find((connection) => connection.type === "credential")?.method !== "oauth"
      })
      .slice()

    items.sort((a, b) => providerRank(a.id) - providerRank(b.id))

    return items
  })

  // The rest of the catalog, sorted by name. Together with `popular` this is every integration the server reports, so
  // the page never hides a provider.
  const services = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))

    return integrations
      .list()
      .filter((p) => !customIDs().has(p.id) && !isPopularProvider(p.id) && !connectedIDs.has(p.id))
      .map((p) => ({ id: p.id, name: p.name }))
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })

  const providerIDs = createMemo(() => [
    ...connected().map((item) => item.id),
    ...popular().map((item) => item.id),
    ...services().map((item) => item.id),
    ...custom().map((item) => item.id),
  ])

  // The accounts a custom provider already stores, read from the same lists the row does, so switching or renaming one
  // inside the dialog needs no second source of truth.
  const providerAccountList = (provider: CustomProvider) => {
    const current = integrations.list().find((entry) => entry.id === provider.id)
    const items = providerAccounts(current)

    if (items.length === 0) return undefined

    return {
      integrationID: current?.id ?? provider.id,
      activeID: activeProviderAccount(current, isActiveCredential)?.id,
      items,
    }
  }

  // Adding and editing a custom provider is a page, not a dialog: the form owns more fields than a sheet may hold.
  const openEditor = (provider?: CustomProvider) => {
    setState("editor", provider ? { mode: "edit", id: provider.id } : { mode: "create" })
  }

  const closeEditor = () => {
    setState("editor", undefined)
    void config.refetch()
  }

  const editingProvider = createMemo(() => {
    const target = state.editor

    return target?.mode === "edit" ? customProvider(target.id) : undefined
  })

  // A provider deleted elsewhere — from another window, or by editing the configuration file — takes its page with it.
  createEffect(() => {
    if (state.editor?.mode === "edit" && editingProvider() === undefined) setState("editor", undefined)
  })

  const deleteCustom = (provider: CustomProvider) => {
    setState("held", available())
    void dialog.show(
      () => (
        <DialogDeleteCustomProvider
          directory={props.directory}
          providerID={provider.id}
          name={provider.name}
          models={provider.models.length}
          accounts={providerAccountList(provider)?.items.length ?? 0}
          onDeleted={() => void config.refetch()}
        />
      ),
      () => setState("held", undefined),
    )
  }

  // Connection state comes from the integration list like the TUI: credential
  // connections mean an API key or an account login, env connections mean detected
  // environment variables, and a connectionless integration is config-provided.
  const source = (item: ProviderItem): ProviderSource | undefined => {
    const current = integration(item)
    const credential = current?.connections.find((connection) => connection.type === "credential")

    if (credential) return credential.method === "key" ? "api" : "account"

    if (current?.connections.some((connection) => connection.type === "env")) return "env"

    if (current) return "config"

    if (!("source" in item)) return
    const value = item.source

    if (value === "env" || value === "api" || value === "config" || value === "custom") return value

    return
  }

  // Where a provider's credential comes from. The row shows it under the name as secondary text: the chip beside the
  // name answers whether the provider is ready, and this line answers why.
  const sourceLabel = (item: ProviderItem) => {
    const current = source(item)

    if (current === "env") return language.t("settings.providers.source.environment")

    if (current === "api") return language.t("settings.providers.source.api")

    if (current === "account") return language.t("settings.providers.source.account")

    if (current === "config") return language.t("settings.providers.source.config")

    if (current === "custom") return language.t("settings.providers.source.custom")

    return language.t("settings.providers.source.other")
  }

  // A stored account that has expired is still connected on paper: the row names the fix instead of claiming success.
  const attention = (item: ProviderItem) =>
    activeProviderAccount(integration(item), isActiveCredential)?.status

  const statusLabel = (item: ProviderItem) =>
    attention(item) ? language.t("settings.providers.status.attention") : language.t("settings.providers.status.connected")

  const canDisconnect = (item: ProviderItem) => {
    const current = integration(item)

    if (current) return current.connections.some((connection) => connection.type === "credential")
    const currentSource = source(item)

    return currentSource !== "env" && currentSource !== "config"
  }

  const canManageAccounts = (item: ProviderItem) => providerAccounts(integration(item)).length > 0

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const requestDisconnect = (item: ProviderItem, name: string) => {
    const group = consoleGroup()
    const providerIDs = group?.root.id === item.id ? group.providers.map((provider) => provider.id) : [item.id]

    setState("confirming", {
      kind: "disconnect",
      providerID: item.id,
      integrationID: item.integrationID ?? item.id,
      providerIDs,
      providerName: name,
    })
  }

  const cancelRemoval = () => setState("confirming", undefined)

  const confirmRemoval = () => {
    const pending = state.confirming

    if (!pending) return
    setState("confirming", undefined)
    dispatch({
      type: "disconnect.requested",
      providerIDs: [...pending.providerIDs],
      integrationID: pending.integrationID,
      providerName: pending.providerName,
    })
  }

  // One provider row, shared by every section of the page: the connected list, the custom list and the account
  // area under it differ only in which ids they pass.
  function ProviderRow(row: { item: ProviderItem }) {
    const managedGroup = () => (consoleGroup()?.root.id === row.item.id ? consoleGroup() : undefined)

    return (
      <Show
        when={managedGroup()}
        fallback={
          <div class="settings-provider-group">
            <div class="settings-provider-row">
              <div class="settings-provider-lead">
                <ProviderModelIcon provider={row.item} class="settings-provider-icon shrink-0" />
              </div>

              <div class="settings-provider-copy">
                <div class="settings-provider-main">
                  <span class="settings-provider-name truncate">{row.item.name}</span>
                  <span
                    class="settings-provider-status"
                    data-tone={attention(row.item) ? "attention" : "connected"}
                  >
                    <span class="settings-provider-status-dot" aria-hidden="true" />
                    {statusLabel(row.item)}
                  </span>
                </div>
                <p class="settings-provider-description">{sourceLabel(row.item)}</p>
                <Show when={!customProvider(row.item.id) && readOnly().has(row.item.id)}>
                  <p class="settings-provider-description">
                    {language.t("settings.providers.custom.readOnly")}
                  </p>
                </Show>
              </div>
              <Show
                when={confirmingFor(row.item)}
                fallback={
                  <div class="settings-provider-actions">
                    {/* The row has one control. Accounts, the provider form and its removal all live in
                        that menu: a row-wide account trigger printed a name that repeated the provider
                        name above it, and its second dots menu put two identical icons on one row. */}
                    <Show when={attention(row.item)}>
                      {(status) => (
                        <Button
                          size="small"
                          variant="ghost-muted"
                          class="text-[var(--v2-state-fg-warning)]"
                          title={status().message}
                          onClick={() => connect(row.item.id)}
                        >
                          {language.t("dialog.provider.needsSignIn")}
                        </Button>
                      )}
                    </Show>
                    {/* A provider with nothing to offer keeps no menu: an empty dots button would open
                        a blank surface. */}
                    <Show when={canManageAccounts(row.item) || canDisconnect(row.item) || customProvider(row.item.id)}>
                      <RowMenu item={row.item} name={row.item.name} />
                    </Show>
                  </div>
                }
              >
                <ConfirmRemoval />
              </Show>
            </div>
            {/* A custom provider's accounts live in its own edit dialog, so the row prints none: the keys it stores
                are configuration detail, not something to scan in the list. */}
            <Show when={canStoreKey(row.item) && !customProvider(row.item.id)}>
              <div class="settings-provider-accounts">
                <ProviderAccountList
                  accounts={accountList(row.item).items}
                  activeID={accountList(row.item).activeID}
                  size="compact"
                  removeConfirm={(account, final) =>
                    language.t(
                      final
                        ? "settings.providers.account.removeLast.confirm"
                        : "settings.providers.account.remove.confirm",
                      { account: account.label },
                    )
                  }
                  onActivate={(account) =>
                    void accountActions
                      .activate({
                        integrationID: accountList(row.item).integrationID,
                        provider: row.item.name,
                        account,
                      })
                      .then(() => credentials.refetch())
                  }
                  onRename={async (account, label) => {
                    const renamed = await accountActions.rename(account, label)

                    if (renamed) void credentials.refetch()

                    return renamed
                  }}
                  onRemove={(account) =>
                    void accountActions
                      .remove({
                        integrationID: accountList(row.item).integrationID,
                        provider: row.item.name,
                        account,
                        final: accountList(row.item).items.length === 1,
                      })
                      .then(() => credentials.refetch())
                  }
                  secret={accountKey}
                  create={(input) =>
                    accountActions
                      .create({
                        integrationID: accountList(row.item).integrationID,
                        provider: row.item.name,
                        ...input,
                      })
                      .then((created) => {
                        void credentials.refetch()

                        return created
                      })
                  }
                />
              </div>
            </Show>
          </div>
        }
      >
        {(group) => (
          <div class="settings-provider-console group">
            <div class="settings-provider-console-header">
              <div class="settings-provider-lead">
                <span class="settings-provider-lead-icon">
                  <AicraftLogo class="settings-provider-icon size-4 shrink-0" />
                </span>
                <div class="settings-provider-console-summary">
                  <div class="settings-provider-main">
                    <span class="settings-provider-name truncate">
                      {language.t("provider.connect.aicraft.name")}
                    </span>
                    <Badge>{group().workspace}</Badge>
                  </div>
                  <Show when={group().providers.length > 1}>
                    <button
                      type="button"
                      class="settings-provider-console-toggle"
                      aria-expanded={state.consoleExpanded}
                      onClick={() => setState("consoleExpanded", (value) => !value)}
                    >
                      <span>
                        {language.plural(
                          "settings.providers.console.available",
                          group().providers.length,
                          { count: group().providers.length },
                        )}
                      </span>
                      <Icon
                        name="chevron-right"
                        size="small"
                        classList={{
                          "settings-provider-console-chevron": true,
                          open: state.consoleExpanded,
                        }}
                      />
                    </button>
                  </Show>
                </div>
              </div>
              <Show
                when={confirmingFor(row.item)}
                fallback={
                  <Show
                    when={canManageAccounts(row.item)}
                    fallback={
                      <Button
                        size="normal"
                        variant="ghost-muted"
                        onClick={() =>
                          requestDisconnect(row.item, language.t("provider.connect.aicraft.name"))
                        }
                      >
                        {language.t("common.disconnect")}
                      </Button>
                    }
                  >
                    <RowMenu item={row.item} name={language.t("provider.connect.aicraft.name")} />
                  </Show>
                }
              >
                <ConfirmRemoval />
              </Show>
            </div>
            <Show when={state.consoleExpanded}>
              <div class="settings-provider-console-list">
                <div class="settings-provider-console-separator" aria-hidden="true" />
                <For each={group().providers}>
                  {(provider) => (
                    <button
                      type="button"
                      class="settings-provider-console-item"
                      onClick={() => props.onSelectProvider?.(provider.id)}
                    >
                      <span>{provider.name.slice(group().prefix.length)}</span>
                      <Icon
                        name="chevron-right"
                        size="small"
                        class="settings-provider-console-item-chevron"
                      />
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    )
  }

  // Every row offers exactly one menu, and that menu only holds what the row itself owns. Accounts are not in it: a
  // bundled provider already shows them under the row with their names and masked keys, and a custom one manages them
  // inside its edit dialog. Either way a menu entry would only be a second way to the same list.
  function RowMenu(menuProps: { item: ProviderItem; name: string }) {
    const custom = () => customProvider(menuProps.item.id)
    const disconnect = () => !custom() && canDisconnect(menuProps.item)

    return (
      <Menu placement="bottom-end" gutter={6}>
        <Menu.Trigger
          as={Button}
          variant="ghost-muted"
          size="small"
          aria-label={language.t("settings.providers.row.menu", { provider: menuProps.name })}
        >
          {language.t("settings.providers.row.manage")}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content class="settings-provider-row-menu">
            <Show when={custom()}>
              {(provider) => (
                <>
                  <Menu.Item onSelect={() => openEditor(provider())}>
                    {language.t("settings.providers.custom.edit")}
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item data-variant="critical" onSelect={() => deleteCustom(provider())}>
                    {language.t("settings.providers.custom.delete.menu")}
                  </Menu.Item>
                </>
              )}
            </Show>
            <Show when={disconnect()}>
              <Menu.Item onSelect={() => requestDisconnect(menuProps.item, menuProps.name)}>
                {language.t("common.disconnect")}
              </Menu.Item>
            </Show>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    )
  }

  // The row keeps its layout and turns its action area into the question, the way the connect dialog's account list
  // does. The sentence truncates rather than pushing the buttons out of the row.
  function ConfirmRemoval() {
    return (
      <div class="settings-provider-confirm">
        <span role="alert" class="settings-provider-confirm-text">
          {language.t("settings.providers.disconnect.confirm")}
        </span>
        <Button size="small" variant="ghost-muted" onClick={cancelRemoval}>
          {language.t("common.cancel")}
        </Button>
        <Button size="small" variant="neutral" onClick={confirmRemoval}>
          {language.t("common.disconnect")}
        </Button>
      </div>
    )
  }

  const confirmingFor = (item: ProviderItem) =>
    state.confirming?.providerID === item.id ? state.confirming : undefined

  return (
    <Switch>
      <Match when={state.editor?.mode === "create"}>
        <CustomProviderEditor directory={props.directory} taken={providerIDs()} onClose={closeEditor} />
      </Match>
      <Match when={editingProvider()}>
        {(provider) => (
          <CustomProviderEditor
            directory={props.directory}
            provider={provider()}
            existingApiKey={existingApiKey(provider())}
            // A read borrows the stored key on edit, so it has to wait for the list that supplies it.
            existingKeyLoading={!credentials.data}
            taken={providerIDs()}
            accounts={providerAccountList(provider())}
            accountSecret={accountKey}
            onCreateAccount={(input) =>
              accountActions
                .create({ integrationID: provider().id, provider: provider().name, ...input })
                .then((created) => {
                  void credentials.refetch()

                  return created
                })
            }
            // Switching an account changes which key a read borrows, so the credential list has to be reloaded.
            onAccountChanged={() => void credentials.refetch()}
            onRequestDelete={() => deleteCustom(provider())}
            onClose={closeEditor}
          />
        )}
      </Match>
      <Match when={true}>
        <>
          <SettingsPageHeader
            title={language.t("settings.providers.title")}
        description={language.t("settings.providers.description")}
        actions={props.headerAction}
      />

      <div class="settings-tab-body settings-tab-body--sectioned settings-providers">
        <Show when={displayed().length > 0 || customRows().length === 0}>
          <div class="settings-section" data-component="connected-providers-section">
            <h3 class="settings-section-title">
              {language.t("settings.providers.section.connected")}
              <Show when={providers.ready() && displayed().length > 0}>
                <span class="settings-section-count">{displayed().length}</span>
              </Show>
            </h3>
            <SettingsList variant="catalog">
              <Switch>
                {/* A failed catalog leaves the lists undefined forever, which used to read as "loading". The failure
                    owns this branch so the retry is reachable. */}
                <Match when={providers.error() !== undefined}>
                  <div class="settings-models-status">
                    <span>{language.t("settings.providers.catalog.failed")}</span>
                    <Button size="small" variant="neutral" onClick={() => providers.retry()}>
                      {language.t("common.retry")}
                    </Button>
                  </div>
                </Match>
                <Match when={!providers.ready()}>
                  <div class="settings-models-status">
                    <Loader class="size-4" />
                    <span>
                      {language.t("common.loading")}
                      {language.t("common.loading.ellipsis")}
                    </span>
                  </div>
                </Match>
                <Match when={displayed().length === 0 && customRows().length === 0}>
                  <div class="settings-provider-empty">
                    <span class="settings-provider-empty-icon">
                      <Icon name="server" size="large" />
                    </span>
                    <span>{language.t("settings.providers.connected.empty")}</span>
                  </div>
                </Match>
              </Switch>
              <Show when={providers.ready() && displayed().length > 0}>
                <For each={displayed()}>
                  {(item) => <ProviderRow item={item} />}
                </For>
              </Show>
            </SettingsList>
          </div>
        </Show>

        {/* A custom provider is not a catalog entry: adding, editing and deleting one all write the configuration
            document, so the custom list and its add row share one card instead of growing off the connected list. */}
        <div class="settings-section">
          <Show when={customRows().length > 0}>
            <h3 class="settings-section-title">
              {language.t("settings.providers.tag.custom")}
              <span class="settings-section-count">{customRows().length}</span>
            </h3>
          </Show>
          <SettingsList variant="catalog">
            <For each={customRows()}>
              {(item) => <ProviderRow item={item} />}
            </For>
            <div class="settings-provider-add-row" data-slot="settings-provider-add-row">
              {/* Adding, editing and deleting a custom provider all read or write the configuration document, so
                  without it the slot explains the failure and offers the refetch instead of opening a broken form. */}
              <Show
                when={config.isError}
                fallback={
                  <button type="button" onClick={() => openEditor()}>
                    <Icon name="plus" size="small" />
                    <span>{language.t("settings.providers.custom.add")}</span>
                  </button>
                }
              >
                <div class="settings-provider-add-error">
                  <span>{language.t("settings.providers.config.failed")}</span>
                  <Button size="small" variant="neutral" onClick={() => void config.refetch()}>
                    {language.t("common.retry")}
                  </Button>
                </div>
              </Show>
            </div>
          </SettingsList>
        </div>

        {/* Every provider is connected: an empty Popular card would only be a blank panel under the list. */}
        <Show when={popular().length > 0}>
          <div class="settings-section">
            <h3 class="settings-section-title">
              {language.t("settings.providers.section.popular")}
              <span class="settings-section-count">{popular().length}</span>
            </h3>
            <SettingsList variant="catalog">
              <For each={popular()}>
                {(item) => (
                  <div class="settings-provider-row settings-provider-row--popular">
                    <div class="settings-provider-lead">
                      <ProviderModelIcon provider={item} class="settings-provider-icon shrink-0" />
                    </div>

                    <div class="settings-provider-copy">
                      <div class="settings-provider-main">
                        <span class="settings-provider-name">{item.name}</span>
                        <Show when={item.id === "opencode" || item.id === "opencode-go"}>
                          <Badge variant="accent">{language.t("dialog.provider.tag.recommended")}</Badge>
                        </Show>
                      </div>
                      <Show when={note(item.id)}>
                        {(key) => <p class="settings-provider-description">{language.t(key())}</p>}
                      </Show>
                    </div>
                    <Button size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                      {language.t("common.connect")}
                    </Button>
                  </div>
                )}
              </For>
            </SettingsList>
          </div>
        </Show>

        {/* The rest of the catalog: every provider the pinned set leaves out, so nothing the server reports is
            unreachable from this page. */}
        <Show when={services().length > 0}>
          <div class="settings-section">
            <h3 class="settings-section-title">
              {language.t("dialog.provider.group.services")}
              <span class="settings-section-count">{services().length}</span>
            </h3>
            <SettingsList variant="catalog">
              <For each={services()}>
                {(item) => (
                  <div class="settings-provider-row settings-provider-row--popular">
                    <div class="settings-provider-lead">
                      <ProviderModelIcon provider={item} class="settings-provider-icon shrink-0" />
                    </div>

                    <div class="settings-provider-copy">
                      <div class="settings-provider-main">
                        <span class="settings-provider-name">{item.name}</span>
                      </div>
                    </div>
                    <Button size="normal" variant="neutral" icon="plus" onClick={() => connect(item.id)}>
                      {language.t("common.connect")}
                    </Button>
                  </div>
                )}
              </For>
            </SettingsList>
            <button type="button" class="settings-providers-view-all" onClick={() => connect()}>
              {language.t("dialog.provider.viewAll")}
            </button>
          </div>
        </Show>
          </div>
        </>
      </Match>
    </Switch>
  )
}
