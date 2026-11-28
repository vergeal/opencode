import {
  ErrorBoundary,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  type ParentProps,
} from "solid-js"
import { Title } from "@solidjs/meta"
import { useParams } from "@solidjs/router"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { DataProvider } from "@aicraft/session-ui/context"
import { SessionUserMessage } from "@aicraft/session-ui/message"
import { TextShimmer } from "@aicraft/ui/text-shimmer"
import { isFallbackTitle } from "@aicraft/util/session-title-fallback"
import { CommentsProvider } from "@/composer/comments"
import { readPromptPresentation } from "@/composer/comment-note"
import { FileProvider } from "@/workspaces/files/model"
import { LocationProvider } from "@/workspaces/location"
import { ModelsProvider } from "@/providers/models/models"
import { useProviders } from "@/providers/catalog/providers"
import { useLanguage } from "@/runtime/i18n/language"
import { useNotification } from "@/shell/notifications/notification"
import { ComposerPersistenceProvider } from "@/composer/persistence"
import { useData, useServer } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { useSettingsCommand } from "@/settings/command"
import { useSettings } from "@/settings/model"
import { SessionUIProvider } from "@/shell/routes/session-ui-provider"
import { useTabs, type PendingSession } from "@/shell/tabs/tabs"
import { requireServerKey } from "@/shell/routes/session"
import { ErrorPage } from "@/shell/errors/error"
import { useSessionModel } from "./model"
import { SessionPanelFrame } from "./session-frame"
import { SessionIdentityHeader } from "./session-identity-header"
import { ServerUnavailablePanel } from "./server-unavailable-panel"
import { SessionErrorFallback, SessionNotFoundPanel } from "./route-error"
import { sessionRouteView } from "./resolution-machine"
import { createSessionResolution } from "./session-resolution"
import { useSessionKey } from "./session-layout"
import { CachedSessionRouteView, setSelectedSessionKey } from "./route-view-cache"
import { SessionScreenView } from "./screen"
import { PreparingComposer } from "./preparing-composer"
import "./session-pending.css"

// Design 17: a resolution faster than this shows the session directly, without flashing the skeleton.
const PENDING_SKELETON_DELAY_MS = 400

export function TargetSessionRouteContent() {
  const params = useParams<{ serverKey: string; id: string }>()
  const data = useData()
  const server = useServer()
  const tabs = useTabs()
  const directory = createMemo(() => data.session.get(params.id)?.location.directory)

  return (
    <>
      <MarkSessionViewed sessionID={() => params.id} />
      <SessionDocumentTitle sessionID={() => params.id} />
      <ModelsProvider directory={directory()}>
        <TargetSessionSettingsCommand />
        <SessionRouteErrorBoundary sessionID={params.id} serverKey={requireServerKey(params.serverKey)}>
          <Show when={tabs.pendingSession(server.key, params.id)} fallback={<ResolvedTargetSessionRoute />}>
            {(pending) => <PreparingSession sessionID={params.id} pending={pending()} />}
          </Show>
        </SessionRouteErrorBoundary>
      </ModelsProvider>
    </>
  )
}

function PreparingSession(props: { sessionID: string; pending: PendingSession }) {
  const language = useLanguage()
  const providers = useProviders(() => props.pending.draft.directory)
  const settings = useSettings()

  return (
    <SessionStatePanel>
      <DataProvider
        directory={props.pending.draft.directory}
        agents={settings.visibility.customAgents()}
        data={{
          session: [],
          session_status: {},
          session_diff: {},
          provider: { all: providers.all(), default: providers.default(), connected: [] },
        }}
      >
        <div data-component="session-preparing" data-scrollable class="min-h-0 flex-1 overflow-y-auto">
          <SessionIdentityHeader sessionID={props.sessionID} />
          <div class="mx-auto w-full min-w-0 px-4 pb-5 md:max-w-session md:px-6">
            <SessionUserMessage
              sessionID={props.sessionID}
              message={props.pending.message}
              comments={readPromptPresentation(props.pending.message.metadata)?.comments}
              historicalAgent={props.pending.selection.agent}
              historicalModel={{
                id: props.pending.selection.model.modelID,
                providerID: props.pending.selection.model.providerID,
                variant: props.pending.selection.variant,
              }}
            />
            <div
              role="status"
              class="mt-3 flex flex-col gap-1 text-[15px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-muted"
            >
              <TextShimmer text={language.t(props.pending.view().status)} active />
              <span class="text-[13px] font-[400] text-v2-text-text-faint">
                {language.t(
                  props.pending.view().preparingMcp
                    ? "session.new.preparing.mcp"
                    : "session.new.preparing.description",
                )}
              </span>
            </div>
          </div>
        </div>
        <PreparingComposer pending={props.pending} />
      </DataProvider>
    </SessionStatePanel>
  )
}

function TargetSessionSettingsCommand() {
  useSettingsCommand()

  return null
}

// Session resolution never throws; this only catches render crashes. Every session tab on a server
// shares the route, so a crash belongs to one target and clears when the tab changes.
function SessionRouteErrorBoundary(props: ParentProps<{ sessionID?: string; serverKey?: ServerConnection.Key }>) {
  return (
    <ErrorBoundary
      fallback={(error, reset) => {
        createEffect(on([() => props.serverKey, () => props.sessionID], reset, { defer: true }))

        return (
          <SessionStatePanel>
            <SessionErrorFallback error={error} sessionID={props.sessionID} serverKey={props.serverKey} />
          </SessionStatePanel>
        )
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}

function ResolvedTargetSessionRoute() {
  const params = useParams<{ id: string }>()
  const server = useServer()
  const tabs = useTabs()
  const data = useData()

  const resolution = createSessionResolution(
    () => params.id,
    () => data.session,
    { children: true, connected: () => server.ctx.sdk.connection.status() === "connected" },
  )

  const view = createMemo(() => sessionRouteView(resolution.state(), server.health))

  // Kept once the session leaves `ready`: the session providers can still read it while the route
  // swaps them out, where a narrowed <Match> value would throw a stale read.
  const directory = createMemo((previous: string) => {
    const current = view()

    return current.type === "ready" ? current.session.location.directory : previous
  }, "")

  const failure = createMemo(() => {
    const current = view()

    return current.type === "error" ? current : undefined
  })

  const closeTab = () => tabs.removeSessionTab({ server: server.key, sessionId: params.id })

  return (
    <Switch>
      <Match when={view().type === "incompatible"}>
        <SessionStatePanel>
          <ServerUnavailablePanel reason="incompatible" onClose={closeTab} />
        </SessionStatePanel>
      </Match>
      {/* Not keyed inside the cached view: the screen and its providers survive tab switches through the
          route view cache below, which reads each session through retained inputs instead of remounting. */}
      <Match when={view().type === "ready"}>
        <LocationProvider directory={directory()}>
          <ReadySessionRouteView directory={directory()} serverKey={server.key} />
        </LocationProvider>
      </Match>
      <Match when={view().type === "not-found"}>
        <SessionStatePanel>
          <SessionNotFoundPanel sessionID={params.id} serverKey={server.key} onRetry={resolution.retry} />
        </SessionStatePanel>
      </Match>
      <Match when={failure()} keyed>
        {(value) => (
          <SessionStatePanel>
            <ErrorPage error={value.error} />
          </SessionStatePanel>
        )}
      </Match>
      <Match when={view().type === "unreachable"}>
        <SessionStatePanel>
          <ServerUnavailablePanel reason="unreachable" onClose={closeTab} />
        </SessionStatePanel>
      </Match>
      <Match when={view().type === "resolving"}>
        <PendingSessionState sessionID={params.id} />
      </Match>
    </Switch>
  )
}

// The router keys its outlet by path, so this component itself is rebuilt on every session switch. It hands
// the heavy subtree to the route view cache: the first mount renders it into a detached root, later switches
// to the same session just move that DOM back in.
function ReadySessionRouteView(props: { directory: string; serverKey: ServerConnection.Key }) {
  const { sessionKey } = useSessionKey()

  // Announce the activation from `onMount`, once the cached DOM sits in the document: landing that starts
  // before insertion reads zero scroll heights from the detached tree, which placed the view wrong and
  // jumped it after the move. Clearing on cleanup makes a return to the same session re-arm its restore.
  onMount(() => {
    const key = untrack(sessionKey)

    setSelectedSessionKey(key)
    onCleanup(() => setSelectedSessionKey(undefined))
  })

  return (
    <CachedSessionRouteView
      key={sessionKey()}
      render={() => (
        <SessionUIProvider directory={props.directory} server={props.serverKey}>
          <TargetSessionPage />
        </SessionUIProvider>
      )}
    />
  )
}

function PendingSessionState(props: { sessionID: string }) {
  return (
    <SessionStatePanel>
      <div data-component="session-pending" data-scrollable class="min-h-0 flex-1 overflow-y-auto">
        <SessionIdentityHeader sessionID={props.sessionID} />
        <SessionPendingSkeleton />
      </div>
    </SessionStatePanel>
  )
}

// The deep-linked session is still resolving: show the timeline's shape instead of an empty panel, so the
// wait reads as loading rather than a black screen.
function SessionPendingSkeleton() {
  const [revealed, setRevealed] = createSignal(false)
  const timer = setTimeout(() => setRevealed(true), PENDING_SKELETON_DELAY_MS)
  onCleanup(() => clearTimeout(timer))

  return (
    <div
      aria-hidden="true"
      data-component="session-pending-skeleton"
      data-visible={revealed() || undefined}
      class="mx-auto w-full min-w-0 px-4 pb-5 pt-3 md:max-w-session md:px-6"
    >
      <div class="flex flex-col gap-3">
        <span class="h-16 w-full rounded-[8px] bg-v2-background-bg-layer-02" />
        <span class="h-3 w-full rounded-[4px] bg-v2-background-bg-layer-02" />
        <span class="h-3 w-11/12 rounded-[4px] bg-v2-background-bg-layer-02" />
        <span class="h-3 w-2/3 rounded-[4px] bg-v2-background-bg-layer-02" />
      </div>
    </div>
  )
}

function SessionStatePanel(props: ParentProps) {
  return (
    <div class="flex min-h-0 flex-1 ps-0 pe-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
      <SessionPanelFrame raised>{props.children}</SessionPanelFrame>
    </div>
  )
}

function TargetSessionPage() {
  return (
    // These providers select their scoped state reactively and retain bounded caches,
    // so keep their owners alive while navigating between workspaces on this server.
    <FileProvider>
      <ComposerPersistenceProvider>
        <CommentsProvider>
          <SessionPage />
        </CommentsProvider>
      </ComposerPersistenceProvider>
    </FileProvider>
  )
}

function SessionPage() {
  const session = useSessionModel()

  return <SessionScreenView session={session} />
}

function MarkSessionViewed(props: { sessionID: () => string | undefined }) {
  const notification = useNotification()
  const [focus, setFocus] = createStore({ window: document.hasFocus() })
  const update = () => setFocus("window", document.hasFocus())
  makeEventListener(window, "focus", update)
  makeEventListener(window, "blur", update)
  makeEventListener(document, "visibilitychange", update)

  // Viewed state is shared by every client, so only a focused window reports what its user has seen.
  // markViewed reads the session's idle watermark, so a turn finishing while it stays open re-runs this.
  createEffect(() => {
    const sessionID = props.sessionID()

    if (!sessionID || !focus.window) return
    notification.session.markViewed(sessionID)
  })

  return null
}

// Browser tabs and desktop windows are otherwise indistinguishable, so name them after the open session.
function SessionDocumentTitle(props: { sessionID: () => string }) {
  const data = useData()

  const title = createMemo(() => {
    const value = data.session.get(props.sessionID())?.title

    return isFallbackTitle(value) ? undefined : value
  })

  // Keyed: <Title> reads its text inside a meta effect, which would hit a stale Show accessor once the session is deleted.
  return (
    <Show when={title()} keyed>
      {(value) => <Title>{`${value} · AI Craft`}</Title>}
    </Show>
  )
}
