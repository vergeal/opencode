import { createEffect, createMemo, createSignal, on, onCleanup, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Predicate } from "effect"
import { abort } from "@opencode/util/abort"
import { createAnimatedPresence } from "@/runtime/animated-presence"
import type { SessionUserActions } from "@opencode/session-ui/actions"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { InlineInput } from "@opencode/ui/inline-input"
import { Keybind } from "@opencode/ui/keybind"
import type { BackgroundTask, MountedSession, SessionScreen } from "@opencode/plugin/gui"
import { PluginSlot } from "@/runtime/plugin/render"
import { usePluginHost } from "@/runtime/plugin/host"
import { usePluginAttachment } from "@/runtime/plugin/attachment"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"
import { useServer } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { Timeline, TimelineRow, isInterruptedError } from "@opencode/session-ui/timeline/projection"
import { createSessionTimelineRowRenderer } from "@opencode/session-ui/timeline/row"
import { getReadyMarkdown, preloadMarkdown } from "@opencode/session-ui/markdown-cache"
import { createTimelineController, type TimelineController, type TimelineSessionSource } from "./controller"
import type { TimelineFollow } from "./follow"
import { createTimelineVirtualizer } from "./virtualizer"
import { createSelectedEffect } from "./selected-effect"
import { containsDirectory } from "@opencode/util/path"
import { isWorkspaceDirectory } from "@/workspaces/paths"
import { parseCommentNote, readPromptPresentation } from "@/composer/comment-note"
import { parseVoiceDelegation } from "./voice-delegation"
import { useCommand } from "@/shell/commands/command"
import { usePluginScoped } from "@/runtime/plugin/commands"
import {
  SessionAncestorTrail,
  SessionHeaderLayout,
  SessionLocation,
  SessionTitleHeader,
} from "../session-identity-header"
import { SessionHeaderSpacer } from "@/session/header/session-header"
import { SessionHeaderGap } from "@/session/header/drag-area"
import { SessionWorkingIndicator } from "@/session/header/session-working-indicator"
import {
  SessionAssistantActivity,
  SessionInterruptedHeader,
  SessionWorkedHeader,
  SessionWorkingHeader,
} from "./working-activity"
import { buildWorkingStep } from "./working-step"

type BlockingTask = { type: "shell" | "subagent"; partID: string; id?: string; label?: string }

type SessionBackground = {
  blocking: Accessor<BlockingTask[]>
  tasks: Accessor<readonly BackgroundTask[]>
  move: () => Promise<void>
}

export function BackgroundMoveHint(props: { keybind?: string[]; onMove?: () => void }) {
  const language = useLanguage()
  const command = useCommand()
  const keys = () => props.keybind ?? command.keybindParts("session.background")
  const keybind = () => props.keybind?.join("+") ?? command.keybind("session.background")

  return (
    <Button
      data-component="session-background-hint"
      type="button"
      variant="ghost-faint"
      size="small"
      class="max-w-full"
      aria-label={language.t("session.background.moveInline", { keybind: keybind() })}
      onClick={() => props.onMove?.()}
    >
      <span class="min-w-0 truncate">{language.t("session.background.moveRunning")}</span>
      <Keybind keys={keys()} variant="neutral" />
    </Button>
  )
}

type MessageTimelineProps = {
  hideHeader?: boolean
  /** Hands the header's empty gap to the pane's window drag area. */
  registerHeaderGap?: (gap: HTMLElement) => () => void
  active?: boolean
  session: TimelineSessionSource
  view: MountedSession
  screen: SessionScreen
  background: SessionBackground
  actions?: SessionUserActions
  scroll: { overflow: boolean; jump: boolean }
  onResumeScroll: (behavior?: ScrollBehavior) => void
  setScrollRef: (el: HTMLDivElement | undefined) => void
  onScheduleScrollState: (el: HTMLDivElement) => void
  follow: TimelineFollow
  onUserScroll: (target?: EventTarget | null) => void
  onHistoryScroll: () => void
  centered: boolean
  reserveReviewToggle: boolean
  onContentResize: () => void
  bottomInset?: number
  setVisibleRef?: (el: HTMLDivElement | undefined) => void
  anchor: (id: string) => string
  setRevealMessage?: (fn: (id: string, partID?: string) => void) => void
  setRevealPart?: (fn: (target: string) => boolean) => void
  setScrollToEnd?: (fn: (behavior?: ScrollBehavior) => void) => void
  setPage?: (fn: (direction: 1 | -1) => void) => void
  reveal?: { target: () => string | undefined; done: () => void }
  search?: JSX.Element
}

export function MessageTimeline(props: MessageTimelineProps) {
  const controller = createTimelineController({ session: props.session, active: () => props.active !== false })
  const tail = props.follow.following() ? controller.data.projection.rows().at(-1) : undefined

  if (tail?._tag === "AssistantPart" && tail.group.type === "part") {
    const message = controller.data.projection.messageByID().get(tail.group.ref.messageID)

    if (message?.type === "assistant" && message.time.completed !== undefined) {
      const content = Timeline.resolveContent(message, tail.group.ref.partID)

      // Start the required worker job while the rest of the selected view is constructed.
      if (content?.type === "text" && content.text.trim()) {
        const preload = new AbortController()
        onCleanup(() => abort(preload))
        void preloadMarkdown(content.text, tail.group.ref.partID, preload.signal).catch(() => undefined)
      }
    }
  }

  return (
    <MessageTimelineView {...props} data={controller.data} action={controller.action} pending={controller.pending} />
  )
}

function MessageTimelineView(
  props: MessageTimelineProps & {
    data: TimelineController["data"]
    action: TimelineController["action"]
    pending: TimelineController["pending"]
  },
) {
  const language = useLanguage()
  const command = useCommand()
  const pluginScoped = usePluginScoped()
  const server = useServer()
  const data = server.ctx.data
  const sdk = useWorkspaceLocation()
  const plugins = usePluginHost()
  const attachment = usePluginAttachment()
  const sessionID = props.data.sessionID
  const sessionStatus = props.data.status
  const titleLabel = props.data.titleLabel
  const parentID = props.data.parentID
  const parentTitle = props.data.parentTitle
  const childTitle = props.data.childTitle
  const projection = props.data.projection
  const sessionDirectory = createMemo(() => props.session.data.info()?.location.directory ?? sdk().directory)

  const project = createMemo(() => {
    const session = props.session.data.info()
    const projects = server.ctx.sync.data.project

    return session
      ? server.ctx.projects.forSession(session)
      : projects.find((item) => containsDirectory(item.worktree, sessionDirectory()))
  })

  const workspaceSession = createMemo(() => isWorkspaceDirectory(project(), sessionDirectory()))

  const headerProject = createMemo(() => {
    const session = props.session.data.info()

    if (!session) return

    return server.ctx.projects.forSession(session)
  })

  createSelectedEffect(
    project,
    () => props.active !== false,
    (project) => {
      const directory = project?.worktree

      if (!directory) return
      void data.location.vcs.sync({ directory }).catch(() => undefined)
    },
  )
  const turnPadding = () => "px-4 md:px-6"
  const showHeader = createMemo(() => !props.hideHeader && (props.data.showHeader() || workspaceSession()))
  const messageByID = projection.messageByID

  const virtualized = createTimelineVirtualizer({
    active: () => props.active !== false,
    sessionKey: () => `${server.key}/${props.data.sessionID()}`,
    presentationKey: () => JSON.stringify(props.data.timelineDetail()),
    projection,
    showHeader,
    follow: props.follow,
    scroll: () => props.scroll,
    onResumeScroll: props.onResumeScroll,
    setScrollRef: props.setScrollRef,
    onContentResize: props.onContentResize,
    bottomInset: () => props.bottomInset ?? 0,
    setVisibleRef: props.setVisibleRef,
    onScheduleScrollState: props.onScheduleScrollState,
    onUserScroll: props.onUserScroll,
    onHistoryScroll: props.onHistoryScroll,
    canRenderImmediately: (row, disclosure) => {
      if (
        Predicate.isTagged(row, "TurnGap") ||
        Predicate.isTagged(row, "TurnDivider") ||
        Predicate.isTagged(row, "CompactionQueued") ||
        Predicate.isTagged(row, "Activity")
      )
        return true

      if (Predicate.isTagged(row, "Notice")) {
        const message = messageByID().get(row.messageID)

        return (
          (message?.type === "system" || message?.type === "synthetic") &&
          (message.description ?? message.text).length <= 1024
        )
      }

      if (Predicate.isTagged(row, "UserMessage")) {
        const message = messageByID().get(row.userMessageID)

        if (message?.type !== "user" || message.text.length > 1024 || message.files?.length || message.agents?.length)
          return false
        const presentation = readPromptPresentation(message.metadata)

        return (
          (presentation?.displayText ?? message.text).length <= 1024 &&
          !presentation?.comments?.length &&
          !presentation?.attachments.length &&
          !parseCommentNote(message.text)
        )
      }

      if (!Predicate.isTagged(row, "AssistantPart") || row.group.type !== "part") return false
      const message = messageByID().get(row.group.ref.messageID)

      if (message?.type !== "assistant" || message.time.completed === undefined) return false
      const content = Timeline.resolveContent(message, row.group.ref.partID)

      if (content?.type === "reasoning")
        return !(disclosure[row.group.ref.partID] ?? props.data.reasoningMode() === "full")

      return (
        content?.type === "text" &&
        content.text.length <= 1024 &&
        !!getReadyMarkdown({ raw: content.text, src: content.text }, `${row.group.ref.partID}:0:full`)
      )
    },
    setRevealMessage: props.setRevealMessage,
    setRevealPart: props.setRevealPart,
    setScrollToEnd: props.setScrollToEnd,
    setPage: props.setPage,
    reveal: props.reveal,
  })

  const VirtualizedTimeline = virtualized.View

  const [title, setTitle] = createStore({
    draft: "",
    editing: false,
    menuOpen: false,
    pendingRename: false,
  })

  let titleRef: HTMLInputElement | undefined

  createEffect(
    on(
      props.data.sessionKey,
      () =>
        setTitle({
          draft: "",
          editing: false,
          menuOpen: false,
          pendingRename: false,
        }),
      { defer: true },
    ),
  )

  const openTitleEditor = () => {
    if (!sessionID() || parentID()) return
    setTitle({ editing: true, draft: titleLabel() ?? "" })
    requestAnimationFrame(() => {
      if (!titleRef) return
      titleRef.focus()
      titleRef.select()
    })
  }

  const closeTitleEditor = () => {
    if (props.pending.rename()) return
    setTitle("editing", false)
  }

  const saveTitleEditor = async () => {
    if (!title.editing || props.pending.rename()) return

    if (await props.action.rename(title.draft)) setTitle("editing", false)
  }

  command.register(() =>
    props.active === false || props.hideHeader
      ? []
      : [
          {
            id: "session.rename",
            category: language.t("command.category.session"),
            title: language.t("command.session.rename"),
            keybind: "ctrl+r",
            disabled: !sessionID() || !!parentID() || title.editing,
            skip: (event) => pluginScoped(event.target),
            onSelect: openTitleEditor,
          },
          {
            id: "session.delete",
            category: language.t("command.category.session"),
            title: language.t("command.session.delete"),
            disabled: !sessionID() || !!parentID(),
            onSelect: () => {
              const id = sessionID()

              if (id) props.action.showDelete(id)
            },
          },
        ],
  )

  createEffect(() => {
    if (props.active !== false) return
    setTitle({ draft: "", editing: false, menuOpen: false, pendingRename: false })
  })

  const settings = useSettings()

  const rowRenderer = createSessionTimelineRowRenderer({
    foldUserMessages: settings.general.foldUserMessages,
    sessionID: () => sessionID()!,
    status: sessionStatus,
    projection,
    presentation: (message) => {
      const value = readPromptPresentation(message.metadata)
      const parsed = value ? undefined : parseCommentNote(message.text)
      const voice = parseVoiceDelegation(value?.displayText ?? message.text)

      return {
        displayText: voice ? (voice.framing ?? voice.instruction) : value?.displayText,
        comments: value?.comments ?? (parsed ? [parsed] : []),
        references: value?.attachments,
        voice: !!voice,
      }
    },
    actions: props.actions,
    reasoningMode: props.data.reasoningMode,
    shellToolDefaultOpen: props.data.shellToolPartsExpanded,
    editToolDefaultOpen: props.data.editToolPartsExpanded,
    timelineDetail: props.data.timelineDetail,
    disclosure: virtualized.disclosure,
    centered: () => props.centered,
    padding: turnPadding,
    anchor: props.anchor,
    revealPart: virtualized.revealPart,
  })

  const backgroundHintPartID = createMemo(() => {
    const blocking = new Set(props.background.blocking().map((task) => task.partID))

    if (blocking.size === 0) return

    return projection
      .rows()
      .flatMap((row) =>
        Predicate.isTagged(row, "AssistantPart") ? (row.group.type === "part" ? [row.group.ref] : row.group.refs) : [],
      )
      .findLast((ref) => blocking.has(ref.partID))?.partID
  })

  const [backgroundHintRef, setBackgroundHintRef] = createSignal<HTMLDivElement>()

  const backgroundHintPresence = createAnimatedPresence(
    backgroundHintPartID,
    () => backgroundHintRef() ?? null,
    sessionID,
    1000,
  )

  const workingMessages = createMemo(() => {
    const active = projection.activeMessageID()

    return active ? (projection.assistantMessagesByParent().get(active) ?? []) : []
  })

  const workingStartedAt = createMemo(() => {
    const active = projection.activeMessageID()
    const message = active ? messageByID().get(active) : undefined

    if (message?.type === "user") return message.time.created

    return workingMessages()[0]?.time.created ?? Date.now()
  })

  const currentWorkingStep = createMemo(() => buildWorkingStep(workingMessages()))

  const assistantActivityPlacement = createMemo(() => {
    const active = projection.activeMessageID()
    const assistant = workingMessages().at(-1)

    if (!active || !assistant) return
    const rows = projection.rows()
    const activeRows = rows.filter(
      (row) =>
        row.userMessageID === active &&
        (Predicate.isTagged(row, "UserMessage") ||
          Predicate.isTagged(row, "AssistantPart") ||
          Predicate.isTagged(row, "Thinking") ||
          Predicate.isTagged(row, "Notice") ||
          Predicate.isTagged(row, "Shell") ||
          Predicate.isTagged(row, "TurnDiff")),
    )
    const ownRow = activeRows.findLast((row) => {
      if (Predicate.isTagged(row, "Thinking")) return row.ref.messageID === assistant.id
      if (!Predicate.isTagged(row, "AssistantPart")) return false

      return (row.group.type === "part" ? [row.group.ref] : row.group.refs).some(
        (ref) => ref.messageID === assistant.id,
      )
    })
    const anchor = ownRow ?? activeRows.at(-1)

    if (!anchor) return

    return { key: TimelineRow.key(anchor) }
  })

  // The turn header already owns the gap above the step when nothing visible precedes it; adding the step's own top
  // margin there would double the spacing to 30px.
  const activityFollowsContent = createMemo(() => {
    const active = projection.activeMessageID()
    const placement = assistantActivityPlacement()

    if (!active || !placement) return false
    const rows = projection.rows()
    const index = rows.findIndex((row) => TimelineRow.key(row) === placement.key)

    if (index < 0) return false

    return rows
      .slice(0, index + 1)
      .some(
        (row) =>
          row.userMessageID === active &&
          (Predicate.isTagged(row, "AssistantPart") || Predicate.isTagged(row, "Thinking")),
      )
  })

  const openWorkingFile = (path: string) => {
    void plugins.links.open({ href: path, exact: true, background: true, session: attachment.current() })
  }

  const showWorking = createMemo(() => {
    const id = sessionID()

    if (!id || sessionStatus().type !== "busy") return false

    if (data.session.permission.list(id)?.length || data.session.form.list(id)?.length) return false
    const active = projection.activeMessageID()

    if (!active) return false
    const assistant = projection.assistantMessagesByParent().get(active)?.at(-1)

    if (assistant?.retry) return false

    // Pending steers still project under the previous response until delivery.
    // Its error must not hide feedback for a newly submitted prompt.
    if (
      assistant?.error &&
      !data.session.pending.list(id).some((item) => item.type === "user" && item.delivery === "steer")
    )
      return false
    return !projection.rows().some((row) => {
      if (row.userMessageID !== active || !Predicate.isTagged(row, "Notice")) return false

      const message = messageByID().get(row.messageID)

      return message?.type === "compaction" && message.status === "running"
    })
  })

  // A turn that ran tools freezes its live header in place, so the answer keeps one settled row above it.
  const workedHeaders = createMemo(() => {
    const result = new Map<string, { started: number; completed: number }>()
    const active = projection.activeMessageID()
    const running = sessionStatus().type !== "idle"

    for (const [turnID, messages] of projection.assistantMessagesByParent()) {
      const last = messages.at(-1)

      // A running turn can look settled between tool calls, because its last message completes before the next
      // one starts. Folding it then would hide the text already written until the whole turn finishes.
      if (running && turnID === active) continue
      if (!last?.time.completed || last.error || last.retry) continue
      // A settled header only frames a turn that both ran work and left words behind.
      if (!messages.some((message) => message.content.some((content) => content.type !== "text"))) continue
      if (
        !messages.some((message) => message.content.some((content) => content.type === "text" && content.text.trim()))
      )
        continue
      result.set(turnID, {
        started: messageByID().get(turnID)?.time.created ?? messages[0]!.time.created,
        completed: last.time.completed,
      })
    }

    return result
  })

  // A stopped turn ends with an aborted assistant message, so `workedHeaders` drops it and the turn would otherwise
  // settle with no header at all. It gets its own footer instead, stating that the user interrupted it.
  const interruptedHeaders = createMemo(() => {
    const result = new Map<string, { started: number; completed: number }>()
    const active = projection.activeMessageID()
    const running = sessionStatus().type !== "idle"

    for (const [turnID, messages] of projection.assistantMessagesByParent()) {
      if (running && turnID === active) continue
      const last = messages.at(-1)

      if (!last?.time.completed || last.retry || !isInterruptedError(last.error)) continue
      result.set(turnID, {
        started: messageByID().get(turnID)?.time.created ?? messages[0]!.time.created,
        completed: last.time.completed,
      })
    }

    return result
  })

  const [expandedTurns, setExpandedTurns] = createSignal<ReadonlySet<string>>(new Set())

  const toggleWorked = (turnID: string) => {
    const expanded = expandedTurns().has(turnID)
    const selector = `[data-timeline-row="UserMessage"][data-message-id="${CSS.escape(turnID)}"]`
    const top = () => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect().top

    setExpandedTurns((current) => {
      const next = new Set(current)

      if (next.has(turnID)) next.delete(turnID)
      else next.add(turnID)

      return next
    })

    if (expanded) return

    // Expanding adds rows above the viewport's anchor; compensate once the virtualizer has measured them so the
    // header stays put and the revealed rows grow downward instead of pushing the turn up.
    const before = top()
    const scroller = document.querySelector<HTMLElement>(selector)?.closest<HTMLElement>("[data-scrollable]")

    if (before === undefined || !scroller) return

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const after = top()

        if (after !== undefined) scroller.scrollTop += after - before
      })
    })
  }

  // A settled turn keeps only the words written after its last tool call; everything before that folds away behind
  // the Worked header. A turn with no answer after its last tool call has nothing to fold to, so it stays open.
  const workedFinalAnswer = createMemo(() => {
    const result = new Map<string, string>()

    for (const [turnID, messages] of projection.assistantMessagesByParent()) {
      if (!workedHeaders().has(turnID)) continue

      const entries = messages.flatMap((message) =>
        Timeline.contentEntries(message).map((entry) => ({ messageID: message.id, entry })),
      )
      const lastTool = entries.findLastIndex(({ entry }) => entry.content.type === "tool")

      if (lastTool < 0) continue
      const answer = entries
        .slice(lastTool + 1)
        .find(({ entry }) => entry.content.type === "text" && entry.content.text.trim())

      if (!answer) continue
      result.set(turnID, `${answer.messageID}:${answer.entry.id}`)
    }

    return result
  })

  const collapsedRowKeys = createMemo(() => {
    const starts = workedFinalAnswer()
    const expanded = expandedTurns()
    const keys = new Set<string>()
    const reached = new Set<string>()

    for (const row of projection.rows()) {
      const start = starts.get(row.userMessageID)

      if (!start || expanded.has(row.userMessageID) || reached.has(row.userMessageID)) continue
      if (!Predicate.isTagged(row, "AssistantPart") && !Predicate.isTagged(row, "Thinking")) continue

      const refs = Predicate.isTagged(row, "AssistantPart")
        ? row.group.type === "part"
          ? [row.group.ref]
          : row.group.refs
        : [row.ref]

      if (refs.some((ref) => `${ref.messageID}:${ref.partID}` === start)) {
        reached.add(row.userMessageID)
        continue
      }

      keys.add(TimelineRow.key(row))
    }

    return keys
  })

  // The first prompt keeps a gap under the window bar, the way the composer keeps one at the other end.
  const firstUserRowKey = createMemo(() => {
    const row = projection.rows().find((row) => Predicate.isTagged(row, "UserMessage"))

    return row ? TimelineRow.key(row) : undefined
  })

  // A turn header already supplies the gap above the turn's first assistant row. Clear that row's own text margin
  // for settled turns as well, otherwise the gap jumps from 15px to 39px when Working settles into Worked.
  const firstAssistantRowKeys = createMemo(() => {
    const active = projection.activeMessageID()
    const headers = workedHeaders()
    const interrupted = interruptedHeaders()
    const collapsed = collapsedRowKeys()
    const keys = new Set<string>()
    const seen = new Set<string>()

    for (const row of projection.rows()) {
      if (!Predicate.isTagged(row, "AssistantPart") || seen.has(row.userMessageID)) continue
      // The folded first row disappears, so the answer below it becomes the row that owns the header gap.
      if (collapsed.has(TimelineRow.key(row))) continue

      seen.add(row.userMessageID)
      if (
        !headers.has(row.userMessageID) &&
        !interrupted.has(row.userMessageID) &&
        !(showWorking() && row.userMessageID === active)
      )
        continue

      keys.add(TimelineRow.key(row))
    }

    return keys
  })

  // The bottom lane keeps the background hint in place without competing with the task-level Working header.
  const activity = () => (
    <div
      classList={{
        "min-w-0 w-full max-w-full": true,
        "md:max-w-session md:mx-auto": props.centered,
      }}
    >
      <div
        class={`flex min-h-9 items-start gap-3 pb-1 pt-3 text-[15px] font-[530] leading-text-compact ${turnPadding()}`}
      >
        <Show when={backgroundHintPresence.present()}>
          <div
            ref={setBackgroundHintRef}
            data-component="session-background-hint-row"
            class="duration-150 motion-reduce:animate-none"
            classList={{
              "animate-in fade-in": backgroundHintPresence.animate() && backgroundHintPresence.show(),
              "animate-out fade-out fill-mode-forwards":
                backgroundHintPresence.animate() && !backgroundHintPresence.show(),
            }}
          >
            <BackgroundMoveHint onMove={props.background.move} />
          </div>
        </Show>
      </div>
    </div>
  )

  return (
    <VirtualizedTimeline
      bottomSpacer={activity()}
      deferred={(row) => {
        if (!Predicate.isTagged(row, "AssistantPart") || row.group.type !== "part") return false
        const content = Timeline.resolveContent(messageByID().get(row.group.ref.messageID), row.group.ref.partID)

        return content?.type === "tool" && ["edit", "write"].includes(content.name)
      }}
      renderRow={(row, onSizeChange) => {
        if (collapsedRowKeys().has(TimelineRow.key(row()))) return <></>

        const assistantActivity = () => (
          <Show
            when={
              showWorking() && !!currentWorkingStep() && assistantActivityPlacement()?.key === TimelineRow.key(row())
            }
          >
            <div class={`w-full ${turnPadding()}`} classList={{ "pt-[15px]": activityFollowsContent() }}>
              <div classList={{ "md:max-w-session md:mx-auto": props.centered }}>
                <SessionAssistantActivity step={currentWorkingStep()} onOpenFile={openWorkingFile} />
              </div>
            </div>
          </Show>
        )

        return (
          <Show
            when={Predicate.isTagged(row(), "Activity")}
            fallback={
              <>
                <Show
                  when={firstAssistantRowKeys().has(TimelineRow.key(row()))}
                  fallback={
                    <Show
                      when={firstUserRowKey() === TimelineRow.key(row())}
                      fallback={<rowRenderer.Row row={row} onSizeChange={onSizeChange} />}
                    >
                      <div data-session-first-message>
                        <rowRenderer.Row row={row} onSizeChange={onSizeChange} />
                      </div>
                    </Show>
                  }
                >
                  <div data-session-first-assistant>
                    <rowRenderer.Row row={row} onSizeChange={onSizeChange} />
                  </div>
                </Show>
                <Show when={Predicate.isTagged(row(), "UserMessage")}>
                  <Show
                    when={showWorking() && row().userMessageID === projection.activeMessageID()}
                    fallback={
                      <>
                        <Show when={workedHeaders().get(row().userMessageID)}>
                          {(header) => (
                            <div class={`w-full pb-[15px] pt-4 ${turnPadding()}`}>
                              <div classList={{ "md:max-w-session md:mx-auto": props.centered }}>
                                <SessionWorkedHeader
                                  started={header().started}
                                  completed={header().completed}
                                  expandable={workedFinalAnswer().has(row().userMessageID)}
                                  expanded={expandedTurns().has(row().userMessageID)}
                                  onToggle={() => toggleWorked(row().userMessageID)}
                                />
                              </div>
                            </div>
                          )}
                        </Show>
                        <Show when={interruptedHeaders().get(row().userMessageID)}>
                          {(header) => (
                            <div class={`w-full pb-[15px] pt-4 ${turnPadding()}`}>
                              <div classList={{ "md:max-w-session md:mx-auto": props.centered }}>
                                <SessionInterruptedHeader
                                  started={header().started}
                                  completed={header().completed}
                                />
                              </div>
                            </div>
                          )}
                        </Show>
                      </>
                    }
                  >
                    <div class={`w-full pb-[15px] pt-4 ${turnPadding()}`}>
                      <div classList={{ "md:max-w-session md:mx-auto": props.centered }}>
                        <SessionWorkingHeader started={workingStartedAt()} />
                      </div>
                    </div>
                  </Show>
                </Show>
                {assistantActivity()}
              </>
            }
          >
            {(_) => {
              // This row sits above input still waiting for delivery. Until live status first shows, it takes no room,
              // so the waiting input keeps the place delivery leaves it. Once shown, the lane stays for the life of the
              // row: Working hides and returns several times in one step, and each change would move that input 36px.
              const shown = createMemo((was) => was || backgroundHintPresence.present(), false)

              return <Show when={shown()}>{activity()}</Show>
            }}
          </Show>
        )
      }}
      header={
        <Show when={!props.hideHeader}>
          <SessionTitleHeader>
            <SessionHeaderLayout
              title={title.editing ? title.draft : childTitle()}
              location={
                <>
                  <SessionLocation
                    project={headerProject()}
                    directory={sessionDirectory()}
                    compact={!!parentID()}
                    trailing={!!(parentID() || childTitle() || title.editing)}
                    context={{
                      get session() {
                        return props.view
                      },
                      get screen() {
                        return props.screen
                      },
                    }}
                  />
                  <Show when={parentID()}>
                    {(id) => (
                      <SessionAncestorTrail
                        sessionID={sessionID() ?? ""}
                        parentID={id()}
                        parentTitle={parentTitle()}
                        trailing={!!(childTitle() || title.editing)}
                      />
                    )}
                  </Show>
                </>
              }
              actions={(fit) => (
                <Show when={sessionID()} keyed>
                  {(_id) => (
                    <>
                      {props.search}
                      <PluginSlot
                        at="session.header"
                        input={{
                          get session() {
                            return props.view
                          },
                          get screen() {
                            return props.screen
                          },
                          get active() {
                            return props.active !== false
                          },
                          get compact() {
                            return fit.compact
                          },
                        }}
                      />
                      <SessionHeaderSpacer visible={props.reserveReviewToggle} />
                    </>
                  )}
                </Show>
              )}
            >
              <Show when={parentID() && childTitle()}>
                {(value) => (
                  <>
                    <SessionWorkingIndicator sessionID={sessionID()} />
                    <h1
                      data-slot="session-title-child"
                      dir="auto"
                      class="max-w-[45%] shrink-0 w-fit truncate rounded-[6px] px-1 py-1.5 text-[13.5px] font-semibold leading-[18px] tracking-[-0.02em] text-v2-text-text-base"
                    >
                      {value()}
                    </h1>
                  </>
                )}
              </Show>
              <Show when={!parentID() && (childTitle() || title.editing)}>
                <Show
                  when={title.editing}
                  fallback={
                    <h1
                      data-slot="session-title-child"
                      class="truncate text-[13.5px] font-semibold leading-[18px] tracking-[-0.02em] text-v2-text-text-base w-fit rounded-[6px] px-1 py-1.5 hover:bg-v2-overlay-simple-overlay-hover"
                      classList={{ "max-w-[45%] shrink-0": !!parentID() }}
                      onClick={openTitleEditor}
                    >
                      {childTitle()}
                    </h1>
                  }
                >
                  <InlineInput
                    ref={(el) => {
                      titleRef = el
                    }}
                    data-slot="session-title-child"
                    dir="auto"
                    value={title.draft}
                    disabled={props.pending.rename()}
                    class="block text-[13.5px] font-semibold leading-[18px] tracking-[-0.02em] text-v2-text-text-base field-sizing-content rounded-[6px] px-1 py-1.5"
                    classList={{ "max-w-[45%] shrink-0": !!parentID() }}
                    style={{
                      "text-align": "start",
                    }}
                    onInput={(event) => setTitle("draft", event.currentTarget.value)}
                    onKeyDown={(event) => {
                      event.stopPropagation()

                      if (event.isComposing || event.keyCode === 229) return

                      if (event.key === "Enter") {
                        event.preventDefault()
                        void saveTitleEditor()

                        return
                      }

                      if (event.key === "Escape") {
                        event.preventDefault()
                        closeTitleEditor()
                      }
                    }}
                    onBlur={() => void saveTitleEditor()}
                  />
                </Show>
              </Show>
              <Show when={!parentID() && sessionID()} keyed>
                {(id) => (
                  <Menu
                    gutter={6}
                    placement="bottom-start"
                    open={title.menuOpen}
                    onOpenChange={(open) => setTitle("menuOpen", open)}
                  >
                    <Menu.Trigger
                      as={IconButton}
                      icon={<Icon name="outline-dots" />}
                      variant="ghost-muted"
                      size="large"
                      class="shrink-0"
                      aria-label={language.t("common.moreOptions")}
                      aria-expanded={title.menuOpen}
                    />
                    <Menu.Portal>
                      <Menu.Content
                        class="session-options-menu w-max"
                        style={{ "min-width": "0" }}
                        onCloseAutoFocus={(event) => {
                          if (!title.pendingRename) return
                          event.preventDefault()
                          setTitle("pendingRename", false)
                          openTitleEditor()
                        }}
                      >
                        <Menu.Item
                          onSelect={() => {
                            setTitle("pendingRename", true)
                            setTitle("menuOpen", false)
                          }}
                        >
                          {language.t("common.rename")}
                        </Menu.Item>
                        <Menu.Item onSelect={() => void props.action.export(id)}>
                          {language.t("common.export")}…
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.Item onSelect={() => props.action.showDelete(id)}>
                          {language.t("common.delete")}…
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu>
                )}
              </Show>
              <Show when={!title.editing}>
                <SessionHeaderGap active={props.active !== false} register={props.registerHeaderGap} />
              </Show>
            </SessionHeaderLayout>
          </SessionTitleHeader>
        </Show>
      }
    />
  )
}
