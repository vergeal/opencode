import {
  batch,
  ErrorBoundary,
  For,
  Show,
  Match,
  Switch,
  createMemo,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js"
import { createStore } from "solid-js/store"
import { ResizeHandle } from "@aicraft/ui/resize-handle"
import type { BackgroundTask, MountedSession, SessionScreen } from "@aicraft/aix/gui"
import { MessageTimeline } from "@/session/timeline/message-timeline"
import { ComposerDropzone } from "@/composer/dropzone"
import { useSettings } from "@/settings/model"
import type { SessionModel } from "@/session/model"
import { SESSION_PANEL_WIDTH_MIN } from "@/session/session-panel-width"
import { useLayout } from "@/shell/state/layout"
import { SessionPanelFrame } from "@/session/session-frame"
import { PluginLinks } from "@/runtime/plugin/render"
import { createPanelSidebar, createRegion, MobilePanel } from "@/runtime/plugin/panels"
import { createMobileViews, MobileViewTabs } from "@/runtime/plugin/mobile"
import { usePluginAttachment } from "@/runtime/plugin/host-apis"
import { createMountedSession } from "@/runtime/plugin/mounted-session"
import { useUsageExceededDialogs } from "./usage-exceeded-dialogs"
import { SessionErrorFallback } from "./route-error"
import { createSessionScreenLayout } from "./screen-layout"
import { PaneTabs, SideRegion } from "@/runtime/plugin/side-region"
import { createPaneDrag } from "@/runtime/plugin/pane-drag"
import { useLanguage } from "@/runtime/i18n/language"
import { IconButton } from "@aicraft/ui/icon-button"
import { Icon } from "@aicraft/ui/icon"
import { Loader } from "@aicraft/ui/loader"
import { Tooltip } from "@aicraft/ui/tooltip"
import { createSessionTimelineInteraction } from "./timeline/interaction"
import { createTimelineSearchController } from "./timeline/search-controller"
import { TimelineSearchBar } from "./timeline/search-bar"
import { createTimelineQuote, TimelineQuote } from "./timeline/quote"
import { createTimelineQuoteHighlight } from "./timeline/quote-highlight"
import { ActiveSessionComposerRegion, createActiveSessionRegion } from "./composer/region"
import { SessionLocation } from "./session-identity-header"
import { SessionHeaderDrag, windowDragEnabled } from "./header/drag-area"
import { usePlatform } from "@/runtime/platform/platform"
import { useServer } from "@/runtime/server/current"
import { createTimelineCache } from "./timeline/cache"
import { useSelectedSessionKey } from "./route-view-cache"
import { createPanelMotion, holdLandingWidth, panelOpacity, setPanelResizing } from "@/shell/panel-motion"

export function SessionScreenView(props: { session: SessionModel }) {
  // Link handling for the rest of the screen; each cached timeline provides its own for its session.
  const mounted = createMountedSession(props.session)

  return (
    <PluginLinks session={mounted.view()}>
      <SessionScreenContent
        session={props.session}
        screen={mounted.screen}
        view={mounted.view}
        bindBackground={mounted.bindBackground}
        bindPrompt={mounted.bindPrompt}
      />
    </PluginLinks>
  )
}

function SessionScreenContent(props: {
  session: SessionModel
  /** One object per routed session; renders receive each through a reactive prop instead of remounting. */
  view: Accessor<MountedSession>
  screen: SessionScreen
  bindBackground: (tasks: () => readonly BackgroundTask[]) => void
  bindPrompt: (prompt: { quotable: () => boolean; focus: () => void; focused: () => boolean }) => void
}) {
  const session = props.session
  const language = useLanguage()
  const attachment = usePluginAttachment()
  const settings = useSettings()
  const server = useServer()
  const isDesktop = session.isDesktop
  const bottomMobileTabs = () => settings.general.mobileTitlebarPosition() === "bottom"
  const sidebar = createPanelSidebar()

  const region = createRegion({
    region: "side",
    view: props.view,
    screen: props.screen,
    tabs: session.layout.tabs,
    closed: attachment.closed,
    open: (key) => attachment.openTab(key, props.view()),
    side: () => session.layout.view().side,
    // Closing the last tab closes the side region, which opens with a new tab next time. The user's own hand closed
    // it, so it goes at once.
    onEmptied: () => {
      if (!session.layout.view().side.opened()) return
      session.layout.view().side.toggle()
      sideMotion.sync(false)
    },
    settled: (run) => sideMotion.whenSettled(run),
  })

  onCleanup(attachment.region(region))
  const mobile = createMobileViews()

  const bottomTabs = createMemo(() => region.pane("bottom").keys().length > 0)
  const bottomOpen = createMemo(() => bottomTabs() && session.layout.view().bottom.opened())

  const drag = createPaneDrag({
    identity: session.layout.tabKey,
    shown: (pane) => (pane === "bottom" ? bottomOpen() : region.pane(pane).keys().length > 0),
    drop: (key, target) =>
      batch(() => {
        session.layout.tabs().move(key, target.pane, target.before)

        if (target.pane === "bottom") session.layout.view().bottom.setOpened(true)
      }),
  })

  const screen = createSessionScreenLayout(session, {
    wide: region.wide,
    panel: region.pane("side").selected,
    widths: useLayout().panelWidth,
  })

  const timeline = createSessionTimelineInteraction(session)

  const timelineSearch = createTimelineSearchController({
    sessionID: session.identity.sessionID,
    scrollRef: timeline.scroller,
    revealMessage: timeline.actions.revealMessage,
    pauseAutoScroll: () => timeline.follow.dispatch({ type: "detach" }),
  })

  const messagesReady = timeline.ready

  const [store, setStore] = createStore<{
    timelineScrollbarHidden: boolean
    sideMounted: boolean
    mobileCached: string[]
  }>({
    timelineScrollbarHidden: false,
    sideMounted: false,
    mobileCached: [],
  })

  const sideVisible = createMemo(() => isDesktop() && screen.side.open())

  // A panel that reads as its own screen takes the whole content area instead of sharing the row with the
  // conversation: the chat beside it is hidden and the region drops its card edge.
  const fullSide = createMemo(() => sideVisible() && !!region.pane("side").selected()?.provider.full)

  const location = {
    directory: () => session.data.info()?.location.directory,
    project: createMemo(() => {
      const info = session.data.info()

      return info ? server.ctx.projects.forSession(info) : undefined
    }),
  }

  // The chat keeps its open width as the far end of a close's travel.
  const chatOpenWidth = createMemo<string>((previous) => (sideVisible() ? screen.panel.width() : previous), "100%")
  let chat: HTMLDivElement | undefined
  let sidePresence: HTMLDivElement | undefined

  // Once opened, the side region stays mounted and is skipped by content-visibility when a close settles, so neither
  // direction mounts its contents mid-flight, and a reopen reuses their style and layout.
  let sideContent: HTMLDivElement | undefined
  // While the left sidebar moves the side panel's edge, its contents keep the width they land at, and centred content,
  // like a Markdown preview, keeps its place rather than jumping by half the change. The side region's content box is
  // the one element whose own width reads the hold.
  holdLandingWidth(
    () => sideContent,
    "blocks",
    () => sideContent?.querySelector<HTMLElement>('[data-slot="session-review-content"]'),
  )

  const sideMotion = createPanelMotion({
    open: sideVisible,
    identity: session.layout.tabKey,
    // The chat's real width moves the side panel's edge, whose contents keep their open width pinned to it.
    paint: (closed) => {
      // Dims the contents as they leave and fades them in as they arrive.
      if (sideContent) sideContent.style.opacity = panelOpacity(closed)

      if (!chat) return
      const open = chatOpenWidth()

      if (closed === 1) {
        chat.style.width = "100%"

        return
      }

      chat.style.width = closed === 0 ? open : `calc(${open} + (100% - ${open}) * ${closed})`
    },
    element: () => sidePresence,
    distance: screen.side.width,
  })

  const revealTimelineScrollbar = (event: Event) => {
    if (!store.timelineScrollbarHidden) return

    if (!(event.target instanceof Element) || !event.target.closest('[data-slot="session-timeline-scroll"]')) return
    setStore("timelineScrollbarHidden", false)
  }

  createEffect(() => {
    if (screen.side.open()) setStore("sideMounted", true)
  })

  const mobileView = attachment.mobile.current

  const mobileEntry = createMemo(() => {
    const key = mobileView()

    return key === "session" ? undefined : mobile.find(key)
  })

  const conversationVisible = createMemo(() => isDesktop() || mobileView() === "session")

  // Narrow-screen views that ask to stay mounted once shown, e.g. a terminal that keeps its shell's screen.
  createEffect(() => {
    const entry = mobileEntry()

    if (isDesktop() || !entry?.mobile.cached || store.mobileCached.includes(entry.key)) return
    setStore("mobileCached", (keys) => [...keys, entry.key])
  })

  const cachedViews = createMemo(() => store.mobileCached.flatMap((key) => mobile.find(key) ?? []))

  const composer = createActiveSessionRegion({
    session,
    screen,
    timeline,
    region,
    visible: conversationVisible,
  })

  props.bindBackground(composer.requests.background.tasks)
  props.bindPrompt({ quotable: composer.quote.available, focus: composer.quote.focus, focused: composer.focused })
  useUsageExceededDialogs({
    selection: () => composer.active()?.composer.model.selection,
    onDone: () => composer.active()?.composer.restoreFocus(),
  })

  const quote = createTimelineQuote({
    root: timeline.scroller,
    sessionKey: session.identity.sessionKey,
    enabled: () => conversationVisible() && composer.quote.available(),
    add: composer.quote.add,
  })

  createTimelineQuoteHighlight({
    root: timeline.scroller,
    source: composer.quote.source,
    enabled: () => conversationVisible() && composer.quote.available(),
  })

  const sessionErrorFallback = (cause: unknown, reset: () => void) => {
    createEffect(on(session.identity.sessionKey, reset, { defer: true }))

    return <SessionErrorFallback error={cause} sessionID={session.identity.params.id} />
  }

  const platform = usePlatform()
  const [headerGap, setHeaderGap] = createSignal<HTMLElement>()

  const registerHeaderGap = (gap: HTMLElement) => {
    setHeaderGap(gap)

    return () => setHeaderGap((current) => (current === gap ? undefined : current))
  }

  const selectedSessionKey = useSelectedSessionKey()

  const timelineView = createTimelineCache(
    session,
    (source, active) => {
      // A cached timeline keeps its own session's latest object while another session is routed.
      const own = createMemo<MountedSession>((previous) => {
        if (!active()) return previous
        const view = props.view()

        return view.id === source.identity.sessionID() ? view : previous
      }, untrack(props.view))

      const actions = composer.actions.timeline({
        sessionID: source.identity.sessionID,
        isChild: () => source.data.info()?.subagent === true,
      })

      return (
        <PluginLinks session={own()} active={active()}>
          <MessageTimeline
            active={active()}
            hideHeader={!isDesktop()}
            registerHeaderGap={registerHeaderGap}
            session={source}
            view={own()}
            screen={props.screen}
            background={composer.requests.background}
            actions={actions}
            setScrollRef={timeline.view.setScrollRef}
            follow={timeline.follow}
            onUserScroll={timeline.view.markUserScroll}
            onHistoryScroll={timeline.view.onHistoryScroll}
            centered={screen.centered()}
            reserveReviewToggle={!sideVisible()}
            onContentResize={timeline.view.contentResized}
            bottomInset={timeline.inset()}
            setVisibleRef={timeline.view.setVisibleRef}
            anchor={timeline.view.anchor}
            setRevealMessage={timeline.view.setRevealMessage}
            setRevealPart={timeline.view.setRevealPart}
            reveal={timeline.view.reveal}
            setScrollToEnd={timeline.view.setScrollToEnd}
            setPage={timeline.view.setPage}
            search={
              <Show when={active()}>
                <TimelineSearchBar controller={timelineSearch} />
              </Show>
            }
          />
        </PluginLinks>
      )
    },
    // The route view cache swaps the selected session through this signal: a view that is mounted again has
    // to know it stopped being the one on screen, or its landing never re-arms after the DOM moves back in.
    () => conversationVisible() && messagesReady() && selectedSessionKey() === untrack(session.identity.sessionKey),
    (sessionID) => server.ctx.data.session.message.list(sessionID),
  )

  const mobileTabs = () => (
    <Show when={session.identity.sessionKey()} keyed>
      {(_key) => (
        <MobileViewTabs
          bottom={bottomMobileTabs()}
          screen={props.screen}
          views={mobile}
          region={region}
          current={mobileView()}
          session={props.view()}
          sidebar={sidebar}
          onSelect={attachment.mobile.select}
        />
      )}
    </Show>
  )

  const sessionPanelContent = () => (
    <>
      <ComposerDropzone
        active={composer.drop.active()}
        input={composer.drop.input()}
        identity={session.layout.tabKey}
      />
      <TimelineQuote controller={quote} />
      <Show when={!isDesktop() && !!session.identity.params.id && !bottomMobileTabs()}>{mobileTabs()}</Show>
      {/* Narrow screens hide the timeline header, so the session's location gets its own bar. */}
      <Show when={!isDesktop() && !!session.identity.params.id && mobileView() === "session"}>
        <div
          data-slot="session-location-bar"
          class="flex h-9 shrink-0 items-center border-b border-v2-border-border-base px-2"
        >
          <SessionLocation
            project={location.project()}
            directory={location.directory()}
            compact={!!session.data.info()?.parentID}
            context={{
              get session() {
                return props.view()
              },
              screen: props.screen,
            }}
          />
        </div>
      </Show>
      {/* Surface query errors without suspending session metadata while messages load. */}
      <Show when={timeline.resource.error}>
        {(error) => {
          throw error()
        }}
      </Show>
      <div class="relative isolate flex-1 min-h-0 overflow-hidden">
        <Show when={!isDesktop() && session.identity.params.id}>
          <For each={cachedViews()}>
            {(entry) => (
              <div
                class="absolute inset-0"
                classList={{ invisible: mobileView() !== entry.key }}
                inert={mobileView() !== entry.key || undefined}
              >
                <MobilePanel
                  screen={props.screen}
                  entry={entry}
                  view={props.view()}
                  sidebar={sidebar}
                  visible={mobileView() === entry.key}
                  open={() => region.openFor(entry.plugin)}
                />
              </div>
            )}
          </For>
        </Show>
        <Switch>
          <Match when={!isDesktop() && mobileEntry()?.mobile.cached}>
            <></>
          </Match>
          <Match when={!isDesktop() && session.identity.params.id ? mobileEntry() : undefined}>
            {(entry) => (
              <MobilePanel
                screen={props.screen}
                entry={entry()}
                view={props.view()}
                sidebar={sidebar}
                visible
                open={() => region.openFor(entry().plugin)}
              />
            )}
          </Match>
          <Match when={session.identity.params.id}>
            <Show when={messagesReady()} fallback={<SessionHistoryLoading />}>
              {timelineView()}
            </Show>
          </Match>
        </Switch>
      </div>

      {/* The composer region overflows this zero-height row upward, over a timeline that scrolls on underneath it. It
          stays shallower than the timeline's observed elements, so their resizes from its inset arrive in the same
          ResizeObserver pass. */}
      <div class="relative z-[70] flex h-0 shrink-0 flex-col justify-end">
        <Show when={composer.active()} keyed>
          {(model) => (
            <ActiveSessionComposerRegion
              session={session}
              view={props.view}
              screen={props.screen}
              model={model}
              suggestionBoundary={timeline.visible}
              onReveal={timeline.actions.revealPart}
            />
          )}
        </Show>
      </div>
      <Show when={!isDesktop() && !!session.identity.params.id && bottomMobileTabs()}>{mobileTabs()}</Show>
    </>
  )

  return (
    <>
      <div
        class="flex-1 min-h-0 flex flex-col gap-2 ps-0 pe-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]"
        classList={{ "gap-0 pe-0 pb-0 pt-0": fullSide() }}
      >
        <div
          ref={screen.panel.ref}
          data-pane-row
          class="relative flex-1 min-h-0 flex flex-col md:flex-row gap-2"
          classList={{ "gap-0": fullSide() }}
        >
          <div
            ref={chat}
            class="relative z-10 min-w-0 shrink-0 flex flex-col min-h-0 h-full flex-1 md:flex-none"
            classList={{ hidden: fullSide() }}
            data-slot="session-chat-panel"
            data-scrollbar-hidden={store.timelineScrollbarHidden}
            onPointerMove={revealTimelineScrollbar}
            onPointerDown={revealTimelineScrollbar}
            on:wheel={{ passive: true, handleEvent: revealTimelineScrollbar }}
            onKeyDown={revealTimelineScrollbar}
          >
            <Show when={!!session.identity.params.id}>
              <SessionPanelFrame raised>
                <ErrorBoundary fallback={sessionErrorFallback}>{sessionPanelContent()}</ErrorBoundary>
              </SessionPanelFrame>
            </Show>
            <Show when={windowDragEnabled(platform)}>
              <SessionHeaderDrag pane={chat} gap={headerGap()} />
            </Show>

            {/* Hidden rather than unmounted: removing it makes the transcript frame the last child, and structural
                selectors in the transcript then restyle every element in it as the side panel starts to close. */}
            <div classList={{ hidden: !screen.panel.resizable() || fullSide() }} onPointerDown={() => screen.size.start()}>
              <ResizeHandle
                direction="horizontal"
                size={screen.panel.resizedWidth()}
                min={SESSION_PANEL_WIDTH_MIN}
                max={screen.panel.max()}
                onResize={(width) => {
                  screen.size.touch()
                  screen.panel.resize(width)
                }}
                onDraggingChange={setPanelResizing}
              />
            </div>
          </div>

          <Show when={sideMotion.present() || store.sideMounted}>
            <div
              ref={sidePresence}
              data-slot="session-side-panel-presence"
              class={`z-0 min-w-0 h-full overflow-visible ${
                !sideMotion.present()
                  ? // Out of the row, so a closed panel takes no space or gap.
                    "absolute inset-y-0 end-0 w-0 [content-visibility:hidden]"
                  : "relative flex-1"
              }`}
            >
              <div
                ref={sideContent}
                data-slot="session-side-panel-content"
                class="absolute inset-y-0 start-0 size-full [contain:layout_style] will-change-[opacity]"
              >
                <div data-slot="session-side-region" class="absolute inset-0 min-h-0 overflow-visible">
                  <Show when={store.sideMounted}>
                    <div data-slot="session-side-region-presence" class="absolute inset-0">
                      <SideRegion
                        screen={props.screen}
                        view={props.view()}
                        region={region}
                        sidebar={sidebar}
                        present={sideMotion.present()}
                        size={screen.size}
                        full={fullSide()}
                        drag={drag}
                      />
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>

        {/* Hidden rather than unmounted while the user hides it, so its terminals keep their screens. */}
        <Show when={isDesktop() && !!session.identity.params.id && bottomTabs()}>
          <div
            data-slot="session-bottom-pane"
            class="relative shrink-0 min-h-0"
            classList={{ hidden: !bottomOpen() }}
            style={{ height: `${session.layout.view().bottom.height()}px` }}
          >
            <div onPointerDown={() => screen.size.start()}>
              <ResizeHandle
                class="-top-1"
                direction="vertical"
                edge="start"
                size={session.layout.view().bottom.height()}
                min={BOTTOM_PANE_HEIGHT_MIN}
                max={typeof window === "undefined" ? 600 : Math.round(window.innerHeight * 0.7)}
                onResize={(height) => {
                  screen.size.touch()
                  session.layout.view().bottom.resize(height)
                }}
                onDraggingChange={setPanelResizing}
              />
            </div>
            <section
              id="bottom-panel"
              aria-label={language.t("session.panel.bottom")}
              inert={!bottomOpen() || undefined}
              class="size-full min-w-0 flex flex-col overflow-hidden bg-v2-background-bg-base rounded-[10px] shadow-[var(--v2-elevation-raised)]"
            >
              <PaneTabs
                pane={region.pane("bottom")}
                region={region}
                view={props.view()}
                screen={props.screen}
                sidebar={sidebar}
                shown={bottomOpen}
                present={bottomOpen}
                animate={() => !screen.size.active()}
                drag={drag}
                end={
                  <Tooltip value={language.t("session.panel.bottom.hide")} placement="bottom">
                    <IconButton
                      icon={<Icon name="chevron-down" />}
                      variant="ghost-muted"
                      size="large"
                      aria-label={language.t("session.panel.bottom.hide")}
                      onClick={() => session.layout.view().bottom.setOpened(false)}
                    />
                  </Tooltip>
                }
              />
            </section>
          </div>
        </Show>
      </div>
      <drag.Layer />
    </>
  )
}

const BOTTOM_PANE_HEIGHT_MIN = 120

/** Shown while a session's history is still loading, so the transcript is revealed once instead of filling in. */
function SessionHistoryLoading() {
  const language = useLanguage()

  return (
    <div data-component="session-history-loading" class="flex size-full flex-col">
      <div
        role="status"
        aria-live="polite"
        class="flex min-h-0 flex-1 items-center justify-center gap-2 pb-10 text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted"
      >
        <Loader />
        <span>{language.t("session.history.loading")}</span>
      </div>
    </div>
  )
}
