import { Button } from "@aicraft/ui/button"
import { Badge } from "@aicraft/ui/badge"
import { useDialog } from "@aicraft/ui/context/dialog"
import { Icon } from "@aicraft/ui/icon"
import { RadioGroup, RadioItem } from "@aicraft/ui/radio"
import { Checkbox } from "@aicraft/ui/checkbox"
import { Loader } from "@aicraft/ui/loader"
import { TextField } from "@aicraft/ui/text-field"
import { DialogBody, DialogFooter, DialogHeader, DialogTitle, DialogTitleGroup, Dialog } from "@aicraft/ui/dialog"
import { TextInput } from "@aicraft/ui/text-input"
import { showToast } from "@/shell/notifications/toast"
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { useProviders } from "@/providers/catalog/providers"
import { isPopularProvider, providerRank } from "@/providers/catalog/order"
import { useCustomProviders } from "@/providers/catalog/custom"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { useIntegrations } from "@/providers/catalog/integrations"
import { ProviderModelGroup, ProviderModelIcon } from "@/providers/models/provider-group"
import type { ModelSelection } from "@/providers/models/selection"
import { decode64 } from "@/runtime/persistence/base64"
import { SettingsList } from "@/settings/list"
import { useTabs } from "@/shell/tabs/tabs"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { Schema } from "effect"
import type { FormAnswer, FormField, FormValue, IntegrationInfo } from "@aicraft/client/promise"
import { CLAUDE_AGENT_INTEGRATION, CONSOLE_INTEGRATION, createProviderConnectionController } from "./controller"
import { connectMethods, providerFormDefaults, type ProviderConnectMethod } from "./machine"
import { ConsoleAuthorization } from "./console"
import { DialogChatGPTPlanWelcome } from "./chatgpt-welcome"
import { authServerName, RemoteAuthNotice } from "./remote"
import { providerAccounts, type ProviderAccount } from "@/settings/providers/accounts"
import { ProviderAccountList } from "@/settings/providers/account-list"
import { useProviderAccountActions } from "@/settings/providers/account-actions"
import "@/shell/search-list.css"
import "./models.css"

export function useProviderConnectController() {
  const [store, setStore] = createStore<{ selected?: string }>({})
  const reset = () => setStore("selected", undefined)

  return {
    selected: () => store.selected,
    select: (provider?: string) => setStore("selected", provider),
    reset,
  }
}

export const DialogConnectProvider: Component<{
  directory?: string
  /** Connects at the server's default Location instead of the current route's directory. */
  defaultLocation?: boolean
  controller?: ReturnType<typeof useProviderConnectController>
  /** Opened for one provider from another flow, with no way back to the provider list. */
  standalone?: boolean
  selection?: ModelSelection
  onDone?: () => void
  onConnected?: (provider: string) => void
  /** Opens on the account list of an already connected provider, so Settings can manage accounts directly. */
  initialAccounts?: boolean
  /** Opens on the first step of adding an account rather than on the list of the ones already stored. */
  initialAdding?: boolean
}> = (props) => {
  const fallback = useProviderConnectController()
  const controller = props.controller ?? fallback

  const [state, setState] = createStore<{
    completed: boolean
    modelProvider?: { id: string; name: string }
    authorization: boolean
    chatgptWelcome: boolean
    picked: boolean
    stepBack: boolean
    accounts: boolean
    adding: boolean
    title: string
  }>({
    completed: false,
    authorization: false,
    chatgptWelcome: false,
    picked: props.initialAccounts === true || props.initialAdding === true,
    stepBack: false,
    accounts: props.initialAccounts === true,
    adding: props.initialAdding === true,
    title: "",
  })

  const language = useLanguage()
  const dialog = useDialog()

  const [welcome, setWelcome, , welcomeReady] = persisted(
    Persist.global("chatgpt-plan-welcome.v1"),
    Persistence.struct({ seen: Schema.Boolean }),
    { seen: false },
  )

  const reset = controller.reset
  const back = { current: reset }
  const accounts = () => state.accounts && !!controller.selected() && !state.modelProvider
  // The step views inside `ProviderConnection` own their own controller, so they report the footer's state up here.
  const [form, setForm] = createStore({ active: false, ready: true, busy: false })

  const reportForm = (next: { active: boolean; ready: boolean; busy: boolean }) => {
    if (form.active === next.active && form.ready === next.ready && form.busy === next.busy) return
    setForm(next)
  }

  let focusHost: HTMLDivElement | undefined
  const holdFocus = () => focusHost?.focus({ preventScroll: true })

  const select = (provider?: string) => {
    back.current = reset
    setState("picked", true)
    controller.select(provider)
  }

  function Content() {
    return (
      <Switch>
        <Match keyed when={controller.selected()}>
          {(provider) => (
            <ProviderConnection
              provider={provider}
              accounts={state.picked}
              initialAdding={props.initialAdding}
              directory={props.directory}
              defaultLocation={props.defaultLocation}
              onBack={reset}
              setBack={(handler) => (back.current = handler)}
              selection={props.selection}
              onDone={props.onDone ? () => setState("completed", true) : undefined}
              onConnected={(methodID) => {
                props.onConnected?.(provider)

                if (provider === "openai" && methodID === "chatgpt-token-sharing") setState("chatgptWelcome", true)
              }}
              onFirstConnection={(provider) => setState("modelProvider", provider)}
              onAuthorization={(authorization) => setState("authorization", authorization)}
              onStepBack={(stepBack) => setState("stepBack", stepBack)}
              onAccounts={(accounts) => setState("accounts", accounts)}
              onTitle={(title) => setState("title", title)}
              onForm={reportForm}
            />
          )}
        </Match>
        <Match when={true}>
          <ProviderPicker directory={props.directory} onSelect={select} onPrepare={holdFocus} />
        </Match>
      </Switch>
    )
  }

  return (
    <Dialog
      preventBackdropDismiss={state.authorization}
      // The list and a provider's details keep one height. A step that fits its own content only moves the bottom
      // edge: the top edge stays where the list put it, so the actions keep their place as the step changes.
      size="normal"
      containerClass={`!self-start [--connect-top:max(8px,calc((100vh_-_560px)/2))] !mt-[var(--connect-top)] ${
        controller.selected() && !state.modelProvider
          ? "!h-auto !max-h-[min(calc(100vh_-_8px_-_var(--connect-top)),560px)]"
          : "!h-[min(calc(100vh_-_8px_-_var(--connect-top)),560px)]"
      }`}
      onCloseAutoFocus={(event) => {
        if (state.completed && props.onDone) {
          event.preventDefault()
          props.onDone()
        }

        if (!state.chatgptWelcome) return
        void Promise.resolve(welcomeReady.promise).then(() => {
          if (welcome.seen) return
          setWelcome("seen", true)
          void dialog.show(() => <DialogChatGPTPlanWelcome />)
        })
      }}
      class="[font-family:var(--v2-font-family-sans)]"
      classList={{
        "search-dialog": !controller.selected() || accounts(),
      }}
    >
      <DialogHeader closeLabel={language.t("common.close")}>
        <Switch>
          <Match when={state.modelProvider}>
            {(provider) => (
              <div class="flex items-center gap-2">
                <ProviderModelIcon provider={provider()} class="shrink-0" />
                <DialogTitle>{language.t("provider.connect.models.title", { provider: provider().name })}</DialogTitle>
              </div>
            )}
          </Match>
          <Match when={accounts()}>
            <div class="flex min-w-0 flex-1 items-center gap-0.5">
              <Show when={!props.standalone}>
                <button
                  type="button"
                  class="shrink-0 rounded-sm text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint hover:text-v2-text-text-base focus-visible:text-v2-text-text-base focus-visible:outline-none"
                  onClick={() => back.current()}
                >
                  {language.t("dialog.provider.title")}
                </button>
                <Icon name="chevron-right" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              </Show>
              <DialogTitle>{state.title}</DialogTitle>
            </div>
          </Match>
          <Match when={controller.selected()}>
            {(provider) => (
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <Show when={!props.standalone || state.stepBack}>
                  <button
                    type="button"
                    class="-my-1 -ms-1 flex size-6 shrink-0 items-center justify-center rounded-md text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
                    onClick={() => back.current()}
                    aria-label={language.t("common.goBack")}
                  >
                    <Icon name="arrow-left" size="small" />
                  </button>
                </Show>
                <ProviderModelIcon
                  provider={{ id: provider(), name: state.title }}
                  class="shrink-0 text-v2-icon-icon-base"
                />
                <DialogTitle>{state.title}</DialogTitle>
              </div>
            )}
          </Match>
          <Match when={true}>
            <DialogTitleGroup
              title={language.t("dialog.provider.title")}
              description={language.t("dialog.provider.description")}
            />
          </Match>
        </Switch>
      </DialogHeader>
      <DialogBody class="min-h-0 flex-1 overflow-hidden">
        {/* Outside the scrolling content, so it can reach across the body's padding without scrolling sideways. */}
        <Show when={accounts()}>
          <div data-slot="search-dialog-divider" />
        </Show>
        <div ref={focusHost} tabIndex={-1} class="flex min-h-0 flex-1 flex-col outline-none">
          <Content />
        </div>
      </DialogBody>
      <Show when={form.active}>
        <DialogFooter>
          <Button variant="neutral" onClick={() => back.current()} disabled={form.busy}>
            {language.t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="provider-connect-form"
            variant="contrast"
            disabled={form.busy || !form.ready}
            aria-busy={form.busy}
          >
            {language.t("common.continue")}
          </Button>
        </DialogFooter>
      </Show>
    </Dialog>
  )
}

const CLAUDE_CODE_SETUP_URL = "https://code.claude.com/docs/en/setup"

// The TUI's integration groups and order, with connected integrations pulled up into their own group first.
function ProviderPicker(props: { directory?: string; onSelect: (provider: string) => void; onPrepare?: () => void }) {
  const integrations = useIntegrations(() => props.directory)
  const language = useLanguage()

  const [store, setStore] = createStore<{
    filter: string
    active?: string
  }>({
    filter: "",
  })

  const custom = useCustomProviders(() => props.directory)
  const customIDs = createMemo(() => new Set(custom.list().map((item) => item.id)))

  // MCP servers are connected and managed from the MCP dialog, not here. Every other integration is listed: the
  // pinned set stays on top, and the rest of the catalog follows by name rather than being hidden.
  const all = createMemo(() => {
    const query = store.filter.trim().toLowerCase()

    return integrations
      .list()
      .filter((row) => row.metadata?.source !== "mcp")
      .filter((row) => !query || `${row.id} ${row.name}`.toLowerCase().includes(query))
  })

  const connected = createMemo(() =>
    all()
      .filter((row) => row.connections.length > 0)
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  const unconnected = createMemo(() => all().filter((row) => row.connections.length === 0))

  const popular = createMemo(() =>
    unconnected()
      .filter((row) => isPopularProvider(row.id) && !customIDs().has(row.id))
      .toSorted((a, b) => providerRank(a.id) - providerRank(b.id)),
  )

  // A custom provider with no account yet gets its own group rather than `services`: that group sorts by name against
  // the whole catalog, which buries the one row the user just added.
  const customs = createMemo(() =>
    unconnected()
      .filter((row) => customIDs().has(row.id))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  const services = createMemo(() =>
    unconnected()
      .filter((row) => !isPopularProvider(row.id) && !customIDs().has(row.id))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  const groups = () => [
    { title: language.t("dialog.provider.connected"), items: connected },
    { title: language.t("dialog.provider.group.popular"), items: popular },
    { title: language.t("dialog.provider.group.services"), items: services },
    { title: language.t("dialog.provider.group.custom"), items: customs },
  ]

  // An integration that only reads environment variables has nothing to connect from here.
  const disabled = (row: IntegrationInfo) => connectMethods(row).length === 0 && providerAccounts(row).length === 0

  const rows = createMemo(() =>
    [...connected(), ...popular(), ...customs(), ...services()].filter((row) => !disabled(row)),
  )

  let picker: HTMLDivElement | undefined
  let search: HTMLInputElement | undefined

  onMount(() => search?.focus({ preventScroll: true }))

  const connect = (provider: string) => {
    props.onPrepare?.()
    props.onSelect(provider)
  }

  const move = (event: KeyboardEvent, direction: number) => {
    const items = rows()

    if (items.length === 0) return
    const index = items.findIndex((provider) => provider.id === store.active)
    const next = index < 0 ? (direction > 0 ? 0 : items.length - 1) : (index + direction + items.length) % items.length
    setStore("active", items[next].id)
    picker
      ?.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(items[next].id)}"]`)
      ?.focus({ preventScroll: true })
    event.preventDefault()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") return move(event, 1)

    if (event.key === "ArrowUp") return move(event, -1)

    if (event.key !== "Enter" || !store.active) return
    connect(store.active)
    event.preventDefault()
  }

  return (
    <div ref={picker} class="flex min-h-0 flex-1 flex-col gap-0.5" onKeyDown={handleKeyDown}>
      <div class="search-dialog-search shrink-0">
        <TextInput
          ref={search}
          type="search"
          class="!w-full [font-family:var(--v2-font-family-sans)]"
          leadingIcon={<Icon name="magnifying-glass" />}
          placeholder={language.t("common.search.placeholder")}
          aria-label={language.t("dialog.provider.search.placeholder")}
          value={store.filter}
          onInput={(event) => {
            setStore({ filter: event.currentTarget.value, active: undefined })
          }}
        />
      </div>
      {/* The fade masks the scrolled rows instead of painting the page color, which would show as an opaque strip on the glass panel. */}
      <div
        class="relative min-h-0 flex-1"
        style={{
          "mask-image": "linear-gradient(to bottom, black calc(100% - 40px), transparent)",
          "-webkit-mask-image": "linear-gradient(to bottom, black calc(100% - 40px), transparent)",
        }}
      >
        <div class="flex size-full min-h-0 flex-col gap-0.5 overflow-y-auto pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <For each={groups()}>
            {(group) => (
              <Show when={group.items().length > 0}>
                <section class="flex flex-col gap-0.5">
                  <div class="px-2 pt-2.5 pb-0.5 text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
                    {group.title}
                  </div>
                  <For each={group.items()}>
                    {(provider) => {
                      const connection = () => provider.connections[0]

                      // The server lists the active account first.
                      const account = () => {
                        const current = connection()

                        if (!current) return

                        return current.type === "credential" ? current.label : `$${current.name}`
                      }

                      return (
                        <button
                          type="button"
                          data-provider-id={provider.id}
                          class="flex min-h-8 w-full items-center gap-2 rounded-md py-1.5 ps-2 pe-1.5 text-left text-[15px] leading-5 tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus:bg-v2-overlay-simple-overlay-hover focus:outline-none disabled:pointer-events-none"
                          classList={{ "bg-v2-overlay-simple-overlay-hover": store.active === provider.id }}
                          onMouseEnter={() => setStore("active", provider.id)}
                          disabled={disabled(provider)}
                          onClick={() => connect(provider.id)}
                        >
                          <ProviderModelIcon
                            provider={provider}
                            class={`shrink-0 text-v2-icon-icon-base ${disabled(provider) ? "opacity-50" : ""}`}
                          />
                          <span
                            class="min-w-0 truncate font-[440]"
                            classList={{
                              "text-v2-text-text-base": !disabled(provider),
                              "text-v2-text-text-faint": disabled(provider),
                            }}
                          >
                            {provider.name}
                          </span>
                          <Show when={disabled(provider)}>
                            <span class="min-w-0 truncate font-[400] text-v2-text-text-faint">
                              {language.t("dialog.provider.environmentOnly")}
                            </span>
                          </Show>
                          <Show when={account()}>
                            {(label) => (
                              <Badge data-slot="provider-connected" class="min-w-0 shrink truncate">
                                {label()}
                              </Badge>
                            )}
                          </Show>
                          <Show when={!!connection()?.status}>
                            <span
                              data-slot="provider-status"
                              class="ms-auto shrink-0 pe-1 font-[400] text-[var(--v2-state-fg-warning)]"
                            >
                              {language.t("dialog.provider.needsSignIn")}
                            </span>
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                </section>
              </Show>
            )}
          </For>
          <Show when={all().length === 0}>
            <div class="flex h-24 items-center justify-center text-[15px] font-[400] text-v2-text-text-muted">
              {language.t("dialog.provider.empty")}
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

function ProviderConnection(props: {
  provider: string
  directory?: string
  defaultLocation?: boolean
  onBack: () => void
  setBack: (handler: () => void) => void
  selection?: ModelSelection
  onDone?: () => void
  onConnected?: (methodID?: string) => void
  onFirstConnection: (provider: { id: string; name: string }) => void
  onAuthorization: (authorization: boolean) => void
  onStepBack: (stepBack: boolean) => void
  onAccounts: (accounts: boolean) => void
  onTitle: (title: string) => void
  onForm: (form: { active: boolean; ready: boolean; busy: boolean }) => void
  accounts?: boolean
  initialAdding?: boolean
}) {
  const dialog = useDialog()
  const params = useParams()
  const language = useLanguage()
  const platform = usePlatform()
  const sdk = useServerSDK()
  const data = useData()
  const global = useGlobal()
  const tabs = useTabs()
  // A sign-in belongs to the Location where it began, even if the route changes underneath it.
  const initialDirectory = props.defaultLocation ? undefined : (props.directory ?? decode64(params.dir))
  const directory = () => initialDirectory
  const location = () => (initialDirectory ? { directory: initialDirectory } : undefined)
  const providers = useProviders(directory)
  const integrations = useIntegrations(directory)
  const accountActions = useProviderAccountActions(directory)
  const integrationID = props.provider
  const isConsole = props.provider === CONSOLE_INTEGRATION
  const isClaudeAgent = props.provider === CLAUDE_AGENT_INTEGRATION
  const remote = isConsole && authServerName(sdk.server) !== undefined

  const [state, setState] = createStore<{
    copied: boolean
    copyFailed: boolean
    models: boolean
    noModels: boolean
    catalogPending: boolean
    selectedModel: string
    collapsed: Record<string, boolean>
    adding: boolean
    direct: boolean
    confirming?: string
    switching?: string
    activating?: string
    renaming?: string
    claudeAgent?: "checking" | "confirming" | "timeout"
    // The Claude Agent accounts a check in progress replaces once it connects.
    replacing: string[]
  }>({
    replacing: [],
    adding: props.initialAdding === true,
    direct: false,
    copied: false,
    copyFailed: false,
    models: false,
    noModels: false,
    // The workspace providers had not loaded when the wait ran out.
    catalogPending: false,
    selectedModel: "",
    collapsed: {},
  })

  // Sorted by name so rows stay put when the server moves the active account first.
  const serverAccounts = () =>
    providerAccounts(integrations.list().find((integration) => integration.id === props.provider))

  const accounts = () => serverAccounts().toSorted((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))

  const activeAccount = () => state.activating ?? serverAccounts()[0]?.id

  const showAccounts = () => !!props.accounts && !state.adding && accounts().length > 0

  const controller = createProviderConnectionController({
    provider: integrationID,
    directory: initialDirectory,
    // Claude Agent explains its setup before connecting, so its lone method never starts on its own.
    manual: () => isClaudeAgent || (!!props.accounts && accounts().length > 0),
    prepare: isConsole ? prepareConsoleCatalog : undefined,
    pollInterval: isConsole ? 500 : undefined,
    onComplete: (method) => {
      props.onConnected?.(method.type === "oauth" ? method.id : undefined)

      // Saving the connection only records the choice; wait for the server's check of `claude`.
      if (isClaudeAgent) {
        // Each connect saves a new account, so drop the ones this check replaces.
        const replaced = state.replacing
        setState({ claudeAgent: "checking", replacing: [] })
        void Promise.all(
          replaced.map((credentialID) => sdk.api.credential.remove({ credentialID }).catch(() => undefined)),
        )

        return
      }

      showConnected()
    },
  })

  const view = controller.view
  // The form's primary action lives in the shared footer, so its readiness is mirrored out of the form component.
  const [formReady, setFormReady] = createSignal(true)

  // The footer sits outside this component, so the shell needs to know which step owns a form and how ready it is.
  createEffect(() =>
    props.onForm({
      active: !state.models && (view().screen === "form" || view().screen === "key" || view().screen === "code"),
      ready: formReady(),
      busy: !!view().submitting,
    }),
  )

  function showConnected() {
    // The picker only lists the newest model per family by default, which hides most of
    // what a new connection just unlocked. Show everything the connected integration offers.
    global.models.show(connectionModels().map((model) => ({ providerID: model.providerID, modelID: model.id })))

    if (state.catalogPending) {
      setState("noModels", true)

      return
    }

    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
      description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
    })

    // Like the TUI, every connection continues to that provider's models, not just the first.
    const first = connectionGroups()[0]?.models[0]

    if (first) {
      setState({ models: true, selectedModel: modelKey(first) })
      props.onFirstConnection({ id: props.provider, name: provider().name })

      return
    }

    // Keep the "connected, but no models" state visible so the workspace can be fixed.
    if (isConsole) {
      setState("noModels", true)

      return
    }

    dialog.close()
  }

  const connectionProviders = createMemo(() =>
    (data.location.provider.list(location()) ?? []).filter(
      (provider) => provider.id === props.provider || provider.integrationID === integrationID,
    ),
  )

  const connectionModels = createMemo(() => {
    const ids = new Set(connectionProviders().map((provider) => provider.id))

    return (data.location.model.list(location()) ?? []).filter(
      (model) => ids.has(model.providerID) && model.enabled && model.status !== "deprecated",
    )
  })

  const connectionGroups = createMemo(() => {
    const models = connectionModels()

    return connectionProviders()
      .map((provider) => ({ provider, models: models.filter((model) => model.providerID === provider.id) }))
      .filter((group) => group.models.length > 0)
  })

  const managedProviders = createMemo(() => (isConsole ? consoleProviderGroup(connectionProviders()) : undefined))

  // The server lists the active account first, and its status is the latest check of `claude`.
  const claudeAgentProblem = () => (isClaudeAgent ? serverAccounts()[0]?.status : undefined)

  // A healthy connection keeps the usual accounts list; anything else shows the setup and its latest check.
  const claudeAgentSetup = () =>
    isClaudeAgent &&
    view().status !== "failed" &&
    (!showAccounts() || !!state.claudeAgent || !!claudeAgentProblem() || view().methodIndex !== undefined)

  // A check that outlives the timeout can still finish, so a late result replaces the timeout message.
  createEffect(() => {
    if (!state.claudeAgent) return

    if (claudeAgentProblem()) return setState("claudeAgent", undefined)

    if (state.claudeAgent === "confirming" || connectionGroups().length === 0) return
    setState("claudeAgent", "confirming")
    void untrack(confirmClaudeAgent)
  })

  // A signed-out `claude` still lists its models, and the login problem arrives in a separate event,
  // so read the connection again before treating the models as a working login.
  async function confirmClaudeAgent() {
    const ref = location()
    data.location.integration.invalidate(ref)
    await data.location.integration.sync(ref).catch(() => undefined)

    if (state.claudeAgent !== "confirming" || claudeAgentProblem()) return
    setState("claudeAgent", undefined)
    showConnected()
  }

  createEffect(() => {
    if (state.claudeAgent !== "checking") return
    // The server allows 30 seconds for `claude` to start and 30 more to read each model's context size.
    const timer = setTimeout(() => setState("claudeAgent", "timeout"), 65_000)
    onCleanup(() => clearTimeout(timer))
  })

  // Connecting again is what makes the server check `claude` again.
  const checkClaudeAgent = () => {
    setState({ claudeAgent: undefined, replacing: serverAccounts().map((account) => account.id) })
    controller.select(0)
  }

  // The server loads the Console workspace's providers after the grant lands, so the first refresh
  // can still show only the free catalog. Poll briefly for the workspace providers before moving on.
  async function prepareConsoleCatalog(method: ProviderConnectMethod, active: () => boolean) {
    if (method.type === "key") return active()

    const loaded = () =>
      managedProviders() !== undefined || connectionProviders().some((provider) => provider.id !== "opencode")

    const deadline = Date.now() + 10_000

    while (!loaded() && active() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))

      if (!active()) return false
      data.location.provider.invalidate(location())
      data.location.model.invalidate(location())
      await Promise.all([data.location.provider.sync(location()), data.location.model.sync(location())]).catch(
        () => undefined,
      )
    }

    setState("catalogPending", !loaded())

    return active()
  }

  const connectionGroupName = (name: string) => {
    const managed = managedProviders()

    return managed ? consoleProviderName(managed, name) : name
  }

  const modelKey = (model: { providerID: string; id: string }) => `${model.providerID}:${model.id}`
  const selectedModel = () => connectionModels().find((model) => modelKey(model) === state.selectedModel)

  const copyLink = async () => {
    const url = view().authorization?.url

    if (!url) return

    const copied = await Promise.resolve()
      .then(() => (platform.writeClipboardText ? platform.writeClipboardText(url) : navigator.clipboard.writeText(url)))
      .then(() => true)
      .catch(() => false)

    if (view().authorization?.url !== url) return
    setState({ copied, copyFailed: !copied })
  }

  const attemptID = createMemo(() => view().authorization?.attemptID)
  createEffect(() => {
    attemptID()
    setState({ copied: false, copyFailed: false })
  })
  createEffect(() => props.onAuthorization(view().authorizing))

  const provider = createMemo(() => ({
    id: props.provider,
    name:
      integrations.list().find((item) => item.id === props.provider)?.name ??
      providers.all().get(props.provider)?.name ??
      view().integration?.name ??
      props.provider,
  }))

  const methodLabel = (value: ProviderConnectMethod) =>
    value.type === "key" ? (value.label ?? language.t("provider.connect.method.apiKey")) : value.label

  const code = createMemo(() => {
    const authorization = view().authorization

    if (!authorization) return
    const userCode = new URL(authorization.url).searchParams.get("user_code")

    if (userCode) return userCode
    const instructions = authorization.instructions

    if (instructions?.includes(":")) return instructions.split(":").pop()?.trim()

    return instructions
  })

  const consoleSignIn = () => isConsole && !state.noModels && view().screen === "browser"

  createEffect(() => {
    if (showAccounts() && !claudeAgentSetup()) return props.onTitle(provider().name)

    if (isConsole && view().status === "failed")
      return props.onTitle(language.t("provider.connect.aicraft.errorTitle"))

    if (consoleSignIn())
      return props.onTitle(
        language.t(
          props.provider === "opencode-go" ? "provider.connect.console.titleGo" : "provider.connect.console.title",
        ),
      )

    if (props.provider === "anthropic" && view().method?.label?.toLowerCase().includes("max"))
      return props.onTitle(language.t("provider.connect.title.anthropicProMax"))

    props.onTitle(
      language.t("provider.connect.title", {
        provider: props.provider === "opencode" ? language.t("provider.connect.aicraft.name") : provider().name,
      }),
    )
  })

  // Asks one visible field at a time, like the TUI, so `when` conditions see every earlier answer.
  function AuthFormView() {
    const method = view().method
    const fields = method && method.type !== "command" ? (method.form ?? []) : []
    const hidden = providerFormDefaults(fields)

    const [formStore, setFormStore] = createStore<{
      answer: FormAnswer
      index: number
      text: string
      choice?: string
      customOn: boolean
      customText: string
      picked: string[]
      opened: boolean
      error?: string
    }>({ answer: {}, index: -1, text: "", customOn: false, customText: "", picked: [], opened: false })

    const active = (field: FormField, answer: FormAnswer) => {
      if (field.type === "external" || !field.when) return true

      return field.when.every((condition) => {
        const value = answer[condition.key]

        if (value === undefined) return false
        const hit = Array.isArray(value) ? value.includes(String(condition.value)) : value === condition.value

        return condition.op === "eq" ? hit : !hit
      })
    }

    const asked = (field: FormField) => field.type === "external" || !field.hidden

    const field = createMemo(() => (formStore.index < 0 ? undefined : fields[formStore.index]))

    const external = () => {
      const current = field()

      return current?.type === "external" ? current : undefined
    }

    const multiselect = () => {
      const current = field()

      return current?.type === "multiselect" ? current : undefined
    }

    const text = () => {
      const current = field()

      return current?.type === "string" ? current : undefined
    }

    const required = () => {
      const current = field()

      return current?.type !== "external" && !!current?.required
    }

    // Prefills the next field from its default; the value only enters the answer once confirmed.
    function advance(answer: FormAnswer) {
      const merged = { ...hidden, ...answer }
      const index = fields.findIndex((item, i) => i > formStore.index && asked(item) && active(item, merged))

      if (index === -1) {
        controller.answer(answer)

        return
      }

      const next = fields[index]
      setFormStore({
        answer,
        index,
        text: "",
        choice: undefined,
        customOn: false,
        customText: "",
        picked: next.type === "multiselect" ? [...(next.default ?? [])] : [],
        opened: false,
        error: undefined,
      })

      if (next.type === "boolean" && next.default !== undefined) setFormStore("choice", String(next.default))

      if ((next.type === "number" || next.type === "integer") && next.default !== undefined)
        setFormStore("text", String(next.default))

      if (next.type !== "string" || next.default === undefined) return

      if (!next.options) return setFormStore("text", next.default)

      if (next.options.some((option) => option.value === next.default)) return setFormStore("choice", next.default)

      if (next.custom) setFormStore({ customOn: true, customText: next.default })
    }

    onMount(() => advance({}))

    const confirm = (value: FormValue | undefined) => {
      const current = field()

      if (!current) return

      if (value === undefined && required()) {
        setFormStore("error", language.t("provider.connect.form.required"))

        return
      }

      const answer = { ...formStore.answer }

      if (value !== undefined) answer[current.key] = value
      advance(answer)
    }

    const submitText = (event: SubmitEvent) => {
      event.preventDefault()
      const current = field()

      if (!current || current.type === "external") return
      const text = formStore.text.trim()

      if (!text) return confirm(undefined)

      if (current.type === "number" || current.type === "integer") {
        const value = Number(text)

        if (!Number.isFinite(value) || (current.type === "integer" && !Number.isInteger(value))) {
          setFormStore("error", language.t("provider.connect.form.number"))

          return
        }

        return confirm(value)
      }

      confirm(text)
    }

    const optionRows = (current: FormField) => {
      if (current.type === "boolean") {
        const rows = [
          { value: "true", label: language.t("provider.connect.form.yes"), description: undefined },
          { value: "false", label: language.t("provider.connect.form.no"), description: undefined },
        ]

        return current.default === false ? rows.toReversed() : rows
      }

      if (current.type === "string" || current.type === "multiselect")
        return (current.options ?? []).map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
        }))

      return []
    }

    const choose = () => {
      const current = field()

      if (!current) return

      if (current.type === "boolean")
        return confirm(formStore.choice === undefined ? undefined : formStore.choice === "true")

      if (formStore.customOn) return confirm(formStore.customText.trim() || undefined)
      confirm(formStore.choice)
    }

    const multiselectError = () => {
      const current = field()

      if (current?.type !== "multiselect") return
      const count = formStore.picked.length

      if (current.required && count === 0) return language.t("provider.connect.form.selectOne")

      if (current.minItems !== undefined && count < current.minItems)
        return language.t("provider.connect.form.minItems", { count: current.minItems })

      if (current.maxItems !== undefined && count > current.maxItems)
        return language.t("provider.connect.form.maxItems", { count: current.maxItems })
    }

    const openLink = async (url: string) => {
      const opened = await Promise.resolve()
        .then(() => {
          if (platform.openBrowser) return platform.openBrowser(url)
          platform.openExternal(url)

          return true
        })
        .catch(() => false)

      setFormStore("opened", (value) => value || opened)
    }

    const title = (current: FormField) => current.title ?? (current.type === "external" ? current.url : current.key)

    // The dialog's footer submits this form, so the current field decides what "continue" means.
    const submitForm = (event: SubmitEvent) => {
      event.preventDefault()
      const current = field()

      if (!current) return

      if (external()) return confirm(true)

      if (multiselect()) return confirm(formStore.picked.length ? [...formStore.picked] : undefined)

      if (current.type === "boolean" || (current.type === "string" && optionRows(current).length > 0)) return choose()
      submitText(event)
    }

    createEffect(() => {
      const current = field()

      if (!current) return setFormReady(false)

      if (external()) return setFormReady(formStore.opened)

      if (multiselect()) return setFormReady(multiselectError() === undefined)

      if (current.type === "boolean" || (current.type === "string" && optionRows(current).length > 0))
        return setFormReady(formStore.customOn ? !!formStore.customText.trim() : formStore.choice !== undefined)
      setFormReady(true)
    })

    return (
      <Show when={field()}>
        {(current) => (
          <form
            id="provider-connect-form"
            data-component="provider-connect-form"
            class="flex flex-col items-start gap-4 px-2"
            onSubmit={submitForm}
          >
            <div class="flex w-full flex-col gap-1">
              <div class="text-[15px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base">
                {title(current())}
              </div>
              <Show when={current().description}>
                {(description) => (
                  <div class="text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
                    {description()}
                  </div>
                )}
              </Show>
            </div>
            <Switch>
              <Match when={external()}>
                {(external) => (
                  <div class="flex flex-wrap items-center gap-2">
                    <Button variant="neutral" icon="arrow-up-right" onClick={() => void openLink(external().url)}>
                      {language.t(formStore.opened ? "provider.connect.form.openAgain" : "provider.connect.form.open")}
                    </Button>
                  </div>
                )}
              </Match>
              <Match when={multiselect()}>
                {(multi) => {
                  const options = () => optionRows(multi())
                  const custom = () => multi().custom

                  return (
                    <div class="flex w-full flex-col gap-4">
                      <div class="flex flex-col gap-2">
                        <For
                          each={[
                            ...options(),
                            ...formStore.picked
                              .filter((item) => !options().some((option) => option.value === item))
                              .map((value) => ({ value, label: value, description: undefined })),
                          ]}
                        >
                          {(option) => (
                            <Checkbox
                              checked={formStore.picked.includes(option.value)}
                              description={option.description}
                              onChange={(checked: boolean) =>
                                setFormStore("picked", (picked) =>
                                  checked ? [...picked, option.value] : picked.filter((item) => item !== option.value),
                                )
                              }
                            >
                              {option.label}
                            </Checkbox>
                          )}
                        </For>
                      </div>
                      <Show when={custom()}>
                        <div class="flex w-full items-center gap-2">
                          <TextInput
                            class="min-w-0 flex-1"
                            placeholder={language.t("ui.question.custom.placeholder")}
                            aria-label={language.t("ui.messagePart.option.typeOwnAnswer")}
                            value={formStore.customText}
                            onInput={(event) => setFormStore("customText", event.currentTarget.value)}
                          />
                          <Button
                            variant="neutral"
                            onClick={() => {
                              const value = formStore.customText.trim()

                              if (!value || formStore.picked.includes(value)) return
                              setFormStore({ picked: [...formStore.picked, value], customText: "" })
                            }}
                          >
                            {language.t("provider.connect.form.add")}
                          </Button>
                        </div>
                      </Show>
                      <Show when={multiselectError()}>
                        {(error) => <div class="text-xs text-v2-text-text-muted">{error()}</div>}
                      </Show>
                    </div>
                  )
                }}
              </Match>
              <Match
                when={current().type === "boolean" || (current().type === "string" && optionRows(current()).length > 0)}
              >
                <div class="flex w-full flex-col gap-4">
                  <RadioGroup
                    label={title(current())}
                    hideLabel
                    value={formStore.customOn ? "custom" : formStore.choice}
                    onChange={(value) => {
                      if (value === "custom") return setFormStore({ customOn: true, error: undefined })
                      setFormStore({ customOn: false, choice: value, error: undefined })
                    }}
                  >
                    <For each={optionRows(current())}>
                      {(option) => (
                        <RadioItem value={option.value} label={option.label} description={option.description} />
                      )}
                    </For>
                    <Show when={text()?.custom}>
                      <RadioItem value="custom" label={language.t("ui.messagePart.option.typeOwnAnswer")} />
                      <Show when={formStore.customOn}>
                        <div class="pl-6">
                          <TextField
                            ref={(input: HTMLInputElement) => queueMicrotask(() => input.focus())}
                            type="text"
                            label={language.t("ui.messagePart.option.typeOwnAnswer")}
                            hideLabel
                            placeholder={text()?.placeholder ?? language.t("ui.question.custom.placeholder")}
                            value={formStore.customText}
                            onChange={(value) => setFormStore("customText", value)}
                          />
                        </div>
                      </Show>
                    </Show>
                  </RadioGroup>
                  <Show when={!required()}>
                    <Button class="self-start" variant="ghost-muted" onClick={() => confirm(undefined)}>
                      {language.t("provider.connect.form.skip")}
                    </Button>
                  </Show>
                </div>
              </Match>
              <Match when={true}>
                <div class="flex w-full flex-col items-start gap-4">
                  <TextInput
                    ref={(input: HTMLInputElement) => queueMicrotask(() => input.focus({ preventScroll: true }))}
                    class="!w-full"
                    type="text"
                    inputMode={current().type === "string" ? undefined : "decimal"}
                    aria-label={title(current())}
                    placeholder={text()?.placeholder}
                    value={formStore.text}
                    invalid={formStore.error !== undefined}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => setFormStore({ text: event.currentTarget.value, error: undefined })}
                  />
                </div>
              </Match>
            </Switch>
            {/* One reserved line for a rejected answer, so the footer does not move when it appears. */}
            <div role="alert" class="min-h-5 text-xs text-v2-state-fg-danger">
              {formStore.error}
            </div>
          </form>
        )}
      </Show>
    )
  }

  const backToAccounts = () =>
    !!props.accounts && state.adding && accounts().length > 0 && (state.direct || view().methodIndex === undefined)

  const backToMethods = () => (isConsole || view().methods.length > 1) && view().methodIndex !== undefined

  createEffect(() => props.onStepBack(backToAccounts() || backToMethods()))
  onCleanup(() => props.onAccounts(false))
  createEffect(() =>
    props.onAccounts(
      showAccounts() &&
        view().methodIndex === undefined &&
        !claudeAgentSetup() &&
        !(state.noModels && view().status !== "failed"),
    ),
  )

  function goBack() {
    if (backToAccounts()) {
      controller.back()
      setState({ adding: false, direct: false })

      return
    }

    if (backToMethods()) {
      controller.back()

      return
    }

    props.onBack()
  }

  props.setBack(goBack)

  function MethodSelection() {
    return (
      <div class="flex flex-col">
        <For each={view().methods}>
          {(item, index) => (
            <button
              type="button"
              data-action="provider-connect-method"
              class="group flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[15px] leading-5 tracking-[-0.04px] hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
              onClick={() => controller.select(index())}
            >
              <span class="font-[530] text-v2-text-text-base">{methodLabel(item)}</span>
            </button>
          )}
        </For>
      </div>
    )
  }

  function CommandView() {
    return (
      <div class="flex flex-col gap-4 px-2 text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <Show when={view().commandOutput.trim()}>
          {(output) => (
            <pre
              data-component="provider-connect-command-output"
              class="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-v2-background-bg-layer-03 px-3 py-2 font-mono text-[13px] leading-[18px] text-v2-text-text-base"
            >
              {output()}
            </pre>
          )}
        </Show>
        <StatusRow>{language.t("provider.connect.command.waiting")}</StatusRow>
      </div>
    )
  }

  function StatusRow(input: { children: JSX.Element }) {
    return (
      <div class="flex items-center gap-2 text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
        <span>{input.children}</span>
      </div>
    )
  }

  function ErrorRow() {
    return (
      <div class="flex flex-col items-start" classList={{ "gap-3": !isConsole, "gap-4": isConsole }}>
        <div class="flex items-start gap-2 text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-base">
          <Icon name="circle-ban-sign" size="small" class="mt-0.5 shrink-0 text-v2-state-fg-danger" />
          <span role="alert">
            {isConsole ? view().error : language.t("provider.connect.status.failed", { error: view().error ?? "" })}
          </span>
        </div>
        <Button variant="contrast" onClick={() => controller.retry()}>
          {language.t(isConsole ? "provider.connect.console.retry" : "common.retry")}
        </Button>
      </div>
    )
  }

  const entryError = () => {
    const error = view().entryError

    if (error?.type === "rejected") return error.message

    if (!error) return

    return language.t(
      view().screen === "code" ? "provider.connect.oauth.code.required" : "provider.connect.apiKey.required",
    )
  }

  const submitEntry = (event: SubmitEvent, name: string) => {
    event.preventDefault()

    if (!(event.currentTarget instanceof HTMLFormElement)) return
    const value = new FormData(event.currentTarget).get(name)
    controller.submit(value instanceof File || value === null ? "" : value)
  }

  function ApiAuthView() {
    let apiKey: HTMLInputElement | undefined
    const errorID = createUniqueId()

    onMount(() => {
      apiKey?.focus({ preventScroll: true })
    })

    return (
      <div
        class="flex flex-col gap-5 px-2 text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted"
        classList={{ "pb-1": isConsole }}
      >
        <p>
          {isConsole
            ? language.t("provider.connect.console.serviceKeyDescription")
            : language.t("provider.connect.apiKey.description", { provider: provider().name })}
        </p>
        <form
          id="provider-connect-form"
          onSubmit={(event) => submitEntry(event, "apiKey")}
          class="flex flex-col items-start gap-5 self-stretch"
        >
          <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
            {language.t("provider.connect.apiKey.label", { provider: provider().name })}
            <TextInput
              ref={apiKey}
              class="!w-full"
              name="apiKey"
              data-input="provider-api-key"
              placeholder={language.t("provider.connect.apiKey.placeholder")}
              readOnly={view().submitting}
              invalid={entryError() !== undefined}
              aria-describedby={entryError() ? errorID : undefined}
              autocomplete="off"
              spellcheck={false}
            />
          </label>
          {/* One reserved line for a rejected key, so the footer keeps its place while the step verifies. */}
          <div id={errorID} role="alert" class="-mt-4 min-h-5 text-xs text-v2-state-fg-danger">
            {entryError()}
          </div>
        </form>
      </div>
    )
  }

  function OAuthCodeView() {
    let codeInput: HTMLInputElement | undefined
    const errorID = createUniqueId()

    onMount(() => {
      codeInput?.focus({ preventScroll: true })
    })

    return (
      <div class="flex flex-col gap-5 px-2 text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <div>{language.t("provider.connect.oauth.code.description", { provider: provider().name })}</div>
        <Button variant="neutral" icon="arrow-up-right" onClick={() => controller.openBrowser()}>
          {language.t("provider.connect.oauth.openBrowser")}
        </Button>
        <form
          id="provider-connect-form"
          onSubmit={(event) => submitEntry(event, "code")}
          class="flex flex-col items-start gap-5 self-stretch"
        >
          <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
            {language.t("provider.connect.oauth.code.label", { method: view().method?.label ?? "" })}
            <TextInput
              ref={codeInput}
              class="!w-full"
              name="code"
              placeholder={language.t("provider.connect.oauth.code.placeholder")}
              readOnly={view().submitting}
              invalid={entryError() !== undefined}
              aria-describedby={entryError() ? errorID : undefined}
              autocomplete="off"
              spellcheck={false}
            />
          </label>
          {/* One reserved line for a rejected code, so the footer keeps its place while the step verifies. */}
          <div id={errorID} role="alert" class="-mt-4 min-h-5 text-xs text-v2-state-fg-danger">
            {entryError()}
          </div>
        </form>
      </div>
    )
  }

  function OAuthAutoView() {
    return (
      <div class="flex flex-col gap-5 px-2 text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
        <div>{language.t("provider.connect.oauth.auto.description", { provider: provider().name })}</div>
        <StatusRow>{language.t("provider.connect.status.waiting")}</StatusRow>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="neutral" icon="arrow-up-right" onClick={() => controller.openBrowser()}>
            {language.t("provider.connect.oauth.openBrowser")}
          </Button>
        </div>
        <Show when={code()}>
          {(value) => (
            <TextField
              label={language.t("provider.connect.oauth.auto.confirmationCode")}
              description={language.t("provider.connect.oauth.auto.confirmationCode.description")}
              class="font-mono"
              value={value()}
              readOnly
              copyable
            />
          )}
        </Show>
      </div>
    )
  }

  const addAccount = () => {
    setState({ adding: true, direct: false, confirming: undefined })

    // Like the TUI: a lone method starts directly, several show the method list. Claude Agent shows its setup first.
    if (isClaudeAgent || view().methods.length !== 1) return
    setState("direct", true)
    controller.select(0)
  }

  const activateAccount = async (account: ProviderAccount) => {
    if (activeAccount() === account.id || state.switching) return
    setState({ switching: account.id, activating: account.id, confirming: undefined })
    await accountActions.activate({ integrationID: props.provider, provider: provider().name, account })
    setState({ switching: undefined, activating: undefined })
  }

  const removeAccount = async (account: ProviderAccount) => {
    const final = accounts().length === 1
    setState({ switching: account.id, confirming: undefined })
    await accountActions.remove({
      integrationID: props.provider,
      provider: provider().name,
      account,
      final,
    })
    setState("switching", undefined)

    // Removing the last account disconnects the integration, so the dialog is done, as in the TUI.
    if (final && accounts().length === 0) dialog.close()
  }

  // A connection that needs a fresh sign-in either has its own link or signs in again.
  const selectAccount = (account: ProviderAccount) => {
    const url = account.status?.url

    if (url) return void platform.openExternal(url)

    if (account.status) return addAccount()
    void activateAccount(account)
  }

  function AccountsView() {
    return (
      <ProviderAccountList
        accounts={accounts()}
        activeID={activeAccount()}
        size="comfortable"
        disabled={state.switching !== undefined}
        removeConfirm={(account) => language.t("dialog.provider.accounts.removeConfirm", { account: account.label })}
        onActivate={(account) => void activateAccount(account)}
        onReconnect={selectAccount}
        onRename={(account, label) => accountActions.rename(account, label)}
        onRemove={(account) => void removeAccount(account)}
        onAdd={addAccount}
        addDisabled={view().methods.length === 0}
      />
    )
  }

  function ClaudeAgentSetup() {
    const problem = () =>
      claudeAgentProblem()?.message ??
      (state.claudeAgent === "timeout" ? language.t("provider.connect.claudeAgent.timeout") : undefined)

    const checking = () =>
      state.claudeAgent === "checking" ||
      state.claudeAgent === "confirming" ||
      view().status === "starting" ||
      view().status === "refreshing"

    return (
      <div
        data-component="claude-agent-setup"
        class="flex flex-col items-start gap-5 px-2 pb-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted"
      >
        <p>{language.t("provider.connect.claudeAgent.description")}</p>
        <Show when={problem()}>
          {(message) => (
            <div class="flex items-start gap-2 text-v2-text-text-base">
              <Icon name="circle-ban-sign" size="small" class="mt-0.5 shrink-0 text-v2-state-fg-danger" />
              <span role="alert">{message()}</span>
            </div>
          )}
        </Show>
        <TextField
          label={language.t("provider.connect.claudeAgent.signIn.command")}
          hideLabel
          class="font-mono"
          value="claude auth login"
          readOnly
          copyable
        />
        <Show
          when={!checking()}
          fallback={<StatusRow>{language.t("provider.connect.claudeAgent.checking")}</StatusRow>}
        >
          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="contrast"
              data-action="provider-connect-submit"
              disabled={view().status === "loading"}
              onClick={checkClaudeAgent}
            >
              {language.t(
                serverAccounts().length > 0
                  ? "provider.connect.claudeAgent.checkAgain"
                  : "provider.connect.claudeAgent.connect",
              )}
            </Button>
            <Button
              variant="neutral"
              icon="arrow-up-right"
              onClick={() => platform.openExternal(claudeAgentProblem()?.url ?? CLAUDE_CODE_SETUP_URL)}
            >
              {language.t("provider.connect.claudeAgent.install")}
            </Button>
          </div>
        </Show>
      </div>
    )
  }

  function ConsoleNoModels() {
    return (
      <div role="status" class="flex flex-col items-start gap-5 px-2 text-[15px] leading-5 text-v2-text-text-muted">
        <div>
          <p class="flex items-center gap-2 font-medium text-v2-text-text-base">
            <Icon name="circle-check" />
            {language.t("provider.connect.console.connected")}
          </p>
          <p>
            {language.t(
              state.catalogPending ? "provider.connect.console.modelsLoading" : "provider.connect.console.noModels",
            )}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={!state.catalogPending}>
            <Button onClick={() => platform.openExternal("https://opencode.ai/console")}>
              {language.t("provider.connect.console.openAgain")}
            </Button>
          </Show>
          <Button
            disabled={view().status === "refreshing"}
            aria-busy={view().status === "refreshing"}
            onClick={() => controller.refresh()}
          >
            {language.t("provider.connect.console.refresh")}
          </Button>
        </div>
      </div>
    )
  }

  const startWithModel = async () => {
    const model = selectedModel()

    if (!model) return
    const selection = { providerID: model.providerID, modelID: model.id }

    if (props.selection) {
      props.selection.set(selection)
      props.onDone?.()
      dialog.close()

      return
    }

    dialog.close()
    await tabs.newDraft(
      {
        server: ServerConnection.key(sdk.server),
        directory: initialDirectory ?? data.location.default().directory,
      },
      undefined,
      selection,
    )
  }

  function ConnectionModelList(listProps: { items: ReturnType<typeof connectionModels> }) {
    return (
      <SettingsList>
        <For each={listProps.items}>
          {(model) => {
            const selected = () => state.selectedModel === modelKey(model)

            return (
              <div data-component="connected-model-row-shell" class="connected-model-row-shell">
                <button
                  type="button"
                  role="radio"
                  data-component="settings-row"
                  data-first-provider-model=""
                  data-selected={selected() ? "" : undefined}
                  aria-checked={selected()}
                  class="connected-model-row text-start focus-visible:outline-none"
                  onClick={() => setState("selectedModel", modelKey(model))}
                >
                  <div data-slot="settings-row-copy">
                    <div data-slot="settings-row-title">
                      <span class="min-w-0 truncate">{model.name}</span>
                    </div>
                  </div>
                  <div data-slot="settings-row-control" class="size-4">
                    <Show when={selected()}>
                      <Icon name="check" size="small" class="shrink-0 text-v2-icon-icon-base" />
                    </Show>
                  </div>
                </button>
              </div>
            )
          }}
        </For>
      </SettingsList>
    )
  }

  function FirstConnectionModels() {
    return (
      <div data-component="first-provider-models" class="flex min-h-0 flex-1 flex-col px-3">
        <p class="shrink-0 pb-5 text-[15px] leading-5 text-v2-text-text-muted">
          {language.t("provider.connect.models.description")}
        </p>
        <div
          data-component="first-provider-model-scroll"
          class="settings-panel settings-models min-h-0 flex-1 overflow-y-auto pb-4"
        >
          <div data-component="available-models-heading" class="flex items-center gap-1.5">
            <span class="text-[15px] font-[530] leading-4 text-v2-text-text-base">
              {language.t("provider.connect.models.available")}
            </span>
            <Show when={managedProviders()}>{(managed) => <Badge>{managed().workspace}</Badge>}</Show>
          </div>
          <div role="radiogroup" aria-label={language.t("provider.connect.models.list", { provider: provider().name })}>
            <Show
              when={managedProviders()}
              fallback={
                <Show
                  when={connectionGroups().length > 1}
                  fallback={<ConnectionModelList items={connectionGroups()[0]?.models ?? []} />}
                >
                  <For each={connectionGroups()}>
                    {(group) => {
                      const expanded = () => !state.collapsed[group.provider.id]

                      return (
                        <section class="settings-section" data-expanded={expanded() ? "" : undefined}>
                          <h3 class="settings-models-group-header sticky top-0 z-[1] box-content bg-v2-background-bg-base">
                            <button
                              type="button"
                              class="settings-models-group-trigger"
                              aria-expanded={expanded()}
                              onClick={() => setState("collapsed", group.provider.id, expanded())}
                            >
                              <span class="settings-models-group-chevron">
                                <Icon name="chevron-down" size="small" classList={{ collapsed: !expanded() }} />
                              </span>
                              <span class="settings-models-group-label">
                                <ProviderModelIcon provider={group.provider} class="shrink-0" />
                                <span class="settings-section-title">{group.provider.name}</span>
                              </span>
                            </button>
                          </h3>
                          <Show when={expanded()}>
                            <ConnectionModelList items={group.models} />
                          </Show>
                        </section>
                      )
                    }}
                  </For>
                </Show>
              }
            >
              <div class="provider-model-groups provider-model-groups--dialog">
                <For each={connectionGroups()}>
                  {(group) => (
                    <ProviderModelGroup
                      provider={group.provider}
                      name={connectionGroupName(group.provider.name)}
                      expanded={!state.collapsed[group.provider.id]}
                      onExpandedChange={(value) => setState("collapsed", group.provider.id, !value)}
                    >
                      <ConnectionModelList items={group.models} />
                    </ProviderModelGroup>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
        <div
          data-component="first-provider-model-footer"
          class="-mx-5 flex h-15 shrink-0 items-center justify-end border-t border-v2-border-border-muted px-4"
        >
          <Button variant="contrast" disabled={!selectedModel()} onClick={() => void startWithModel()}>
            {language.t("common.continue")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Show when={!state.models} fallback={<FirstConnectionModels />}>
      <div
        data-component="provider-connect-content"
        class={
          isConsole
            ? `flex min-h-0 flex-1 flex-col overflow-y-auto ${showAccounts() ? "" : "pb-4"}`
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        <Show when={remote}>
          <div class="mb-5 px-3">
            <RemoteAuthNotice server={sdk.server} />
          </div>
        </Show>
        <Switch>
          <Match when={state.noModels && view().status !== "failed"}>
            <ConsoleNoModels />
          </Match>
          <Match when={consoleSignIn()}>
            <div class="px-3">
              <ConsoleAuthorization
                code={code()}
                browserFailed={view().browserFailed}
                copied={state.copied}
                copyFailed={state.copyFailed}
                onCopy={() => void copyLink()}
                onOpen={() => controller.openBrowser()}
              />
            </div>
          </Match>
          <Match when={claudeAgentSetup()}>
            <ClaudeAgentSetup />
          </Match>
          <Match when={showAccounts() && view().methodIndex === undefined}>
            <AccountsView />
          </Match>
          <Match when={view().screen === "busy"}>
            <div class="px-3">
              <StatusRow>{language.t("provider.connect.status.inProgress")}</StatusRow>
            </div>
          </Match>
          <Match when={view().screen === "environment-only"}>
            <div class="px-3 text-[15px] font-[400] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
              {language.t("dialog.provider.environmentOnly")}
            </div>
          </Match>
          <Match when={view().screen === "methods"}>
            <MethodSelection />
          </Match>
          <Match when={view().screen === "form"}>
            <AuthFormView />
          </Match>
          <Match when={view().screen === "failed"}>
            <div class="px-3">
              <ErrorRow />
            </div>
          </Match>
          <Match when={view().screen === "command"}>
            <CommandView />
          </Match>
          <Match when={view().screen === "key"}>
            <ApiAuthView />
          </Match>
          <Match when={view().screen === "code"}>
            <OAuthCodeView />
          </Match>
          <Match when={view().screen === "browser"}>
            <OAuthAutoView />
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
