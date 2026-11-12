export * as SessionCompaction from "./compaction.js"

import {
  ai,
  AIError,
  type ContentPart,
  InvalidProviderOutputError,
  isContextOverflowFailure,
  LLMClient,
  LLMEvent,
  type LLMRequest,
  Message,
  type ToolEntry,
  UnknownProviderError,
  type Usage,
} from "@opencode/ai/effect"
import type { StreamOptions } from "@opencode/ai/route"
import type { SessionCompactionResult } from "@opencode/plugin/effect/session"
import type { SessionError } from "@opencode/schema/session-error"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Clock, Context, DateTime, Effect, Exit, Fiber, Layer, Result, Scope, Stream } from "effect"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { llmClient } from "../effect/app-node-platform.js"
import { Instructions } from "../instructions/index.js"
import { Model } from "../model.js"
import { State } from "../state.js"
import { Token } from "../util/token.js"
import type { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import { SessionHistory } from "./history.js"
import type { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionRunnerRetry } from "./runner/retry.js"
import { toLLMMessages } from "./runner/to-llm-message.js"
import { SessionRecentText } from "./recent-text.js"
import { contentFilterError, toSessionError } from "./to-session-error.js"
import { SessionUsage } from "./usage.js"

export type Settings = {
  auto: boolean
  /** Room kept free below the model's limits before compacting: a share such as "20%", or tokens. Unset keeps 15%, and at least 16k, free. */
  buffer?: number | string
  /** Tokens of recent conversation kept verbatim beside the summary. */
  keep: number
  /** Summarize in the background as the context nears the threshold, so automatic compaction can swap it in. */
  precompute: boolean
}

export type Editor = {
  configure: (settings: Partial<Settings>) => void
}

/** A prompt's size: `measured` is what the provider reported at the latest response, `estimated` is the text since. */
export type Estimate = { readonly measured: number; readonly estimated: number }

export type Trigger =
  /** `overflow`: the provider just rejected this context as too long. `estimate` is `estimatePrompt(context)`. */
  | { readonly reason: "auto" | "overflow"; readonly context: SessionContext.Loaded; readonly estimate?: Estimate }
  /** `inputID` is the `/compact` inbox item, whose message shows the outcome. */
  | { readonly reason: "manual"; readonly context: SessionContext.Loaded; readonly inputID: SessionMessage.ID }

export type Outcome =
  /** Only `auto` skips: the context fits, or automatic compaction is off. */
  | { readonly status: "skipped" }
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly error: SessionError.Error }

export interface Interface extends State.Transformable<Editor> {
  readonly compact: (trigger: Trigger) => Effect.Effect<Outcome>
  /**
   * Starts a background summary when the context nears the threshold. Never waits for it. Loads `context` only when
   * background summaries are on. `estimate`, when given, is `estimatePrompt` of the loaded context.
   */
  readonly precompute: <E>(
    context: Effect.Effect<SessionContext.Loaded, E>,
    estimate?: Estimate,
  ) => Effect.Effect<void, E>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

/**
 * A summary fills `text`, and references the messages it keeps verbatim with `metadata.keepID`; history
 * rebuilds their text from that. A native compaction fills `native.messages` with its replacement window.
 */
type Result = {
  readonly text: string
  readonly native?: SessionMessage.Native
  readonly metadata?: Record<string, unknown>
}

type Failure = {
  readonly error: SessionError.Error
}

type Prepared = Effect.Success<ReturnType<SessionModelRequest.Interface["compaction"]>>

type Streamed = {
  readonly text: string
}

/** A summary run off the critical path: it covers only `messages`, streams no deltas, and bills into `usage`. */
type Background = {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly usage: (usage: SessionUsage.Recorded) => void
}

/** A background summary of everything before `keepID`, held until automatic compaction is due. */
type Precomputed = {
  readonly firstID: SessionMessage.ID | undefined
  readonly keepID: SessionMessage.ID
  readonly model: SessionContext.Loaded["model"]["ref"]
  readonly initial: string
  /** The longest tail since `keepID` that compaction still accepts beside this summary. */
  readonly tailLimit: number
  /** Background summaries that failed since the last compaction, this one included once it has. */
  readonly failures: number
  readonly usage: SessionUsage.Recorded[]
  readonly fiber: Fiber.Fiber<Result, Failure>
}

const NOTHING_TO_COMPACT: Failure = { error: { type: "compaction.unavailable", message: "Nothing to compact yet" } }
/** After each "too long" rejection, the next attempt aims at this share of the first rejected request's size. */
const SHRINK_STEPS = [0.85, 0.7, 0.5, 0.35]
// The least of the window kept free for the last reply before compaction and for the summary itself.
const RESERVE_MIN = 16_000
/**
 * Share of the window kept free before automatic compaction. Above `RESERVE_MIN`, the margin between it and
 * `summaryRoom` absorbs a large step past the trigger, so the whole conversation still goes out unchanged and reuses
 * the cache. Single steps grew by up to ~22k tokens at p99 in real sessions.
 */
const RESERVE_SHARE = 0.15
/** A common window size, assumed for the compaction request when the model's window is unknown. */
const UNKNOWN_WINDOW = 200_000
/** A summary gets at least this much output, or the room left if less, even when the estimate margin leaves less. */
const SUMMARY_OUTPUT_FLOOR = 32_000
/**
 * How far one exchange of a summary transcript is shortened, in the order the levels apply: whole; tool outputs cut;
 * tool outputs left out and tool inputs cut; only the user's text, cut; omitted.
 */
const OUTPUTS_CLIPPED = 1
const OUTPUTS_REMOVED = 2
const USER_ONLY = 3
const OMITTED = 4
const TRANSCRIPT_LEVELS = [0, OUTPUTS_CLIPPED, OUTPUTS_REMOVED, USER_ONLY, OMITTED]
/** Characters kept, from the start and end, of a cut tool input, tool output, or user message. */
const TRANSCRIPT_CLIP = 2_000
const IMAGE_TOKEN_ESTIMATE = 1_500
const PDF_TOKEN_ESTIMATE = 2_000
/**
 * Tokens before the ceiling at which a background summary starts. Writing one takes 30–60 s, and in that time the
 * conversation grows by a few thousand tokens at the median but by 25k or more one time in twenty, when large file
 * reads arrive together. How far ahead to start depends on that growth, not on the window, so the lead is fixed.
 */
const PRECOMPUTE_LEAD = 60_000
/** Prompt caches expire this long after their last use unless the model sets `cache.ttl`. */
const CACHE_LIFETIME = 5 * 60_000
/** A background summary starts only while this much of the latest response's cache lifetime is left. */
const CACHE_MARGIN = 30_000
/**
 * The most text a swapped-in summary keeps verbatim beside it, and the tail at which a held summary is replaced, as a
 * share of the budget. Tails are usually far shorter; the limit is there for bursts of large tool inputs or pasted
 * text. At 40%, a swapped-in context stays under about two thirds of the budget even with Claude's tokenizer, so the
 * next cycle keeps room; a longer tail makes compaction summarize from scratch instead.
 */
const PRECOMPUTED_TAIL_SHARE = 0.4
/** Failed background summaries after which no new one starts until the next compaction. */
const PRECOMPUTE_MAX_FAILURES = 2

const SUMMARY_TEMPLATE = `你必须使用以下格式回复（不适用的章节可以省略）。不要在回复中包含 <template> 标签。
<template>
## 目标
- [用一两句话描述用户想达成什么]

## 需求
- [用户提出的约束、偏好、要求和范围边界；没有就写「无」]

## 决策
- [已经做出的决定及原因；没有就写「无」]

## 工作状态
把目标拆成更小的目标，说明哪些已完成、哪些进行中、哪些被阻塞。
### 已完成
- [已完成的目标；没有就写「无」]

### 进行中
- [正在处理的目标；没有就写「无」]

### 受阻
- [阻碍进展的事项及原因；没有就写「无」]

## 下一步
1. [按顺序排列的后续动作；没有就写「无」]

## 相关文件
列出另一个 agent 继续这项工作需要打开的文件和目录（当前工作目录除外）。最多 15 个，最重要的在前。不要列出每个读过或改过的文件。相关时包含当前工作目录之外的路径。没有就写「无」。
- \`[文件或目录路径]\`：[它为什么重要的简短理由]

## 重要上下文
- [下一个 agent 没有它就无法继续、且自己不容易找到的事实；没有就写「无」]
</template>`

const SUMMARY_RULES = `规则：
- 每个章节保持简洁。用简短的单行条目，不要写散文段落或嵌套列表。
- 优先用简短引用，不要详细复述。下一个 agent 能从代码或上面列出的文件里找回的信息可以省略。
- 保留精确的文件路径、符号、命令、错误信息、URL 和标识符。
- 只保留尚未回答或仍需后续处理的问题和请求。较新的历史已经回答或解决的不要重复。保留原话。
- 保留关键的工作流状态，包括改动是否未提交、已提交、已推送、在评审中或已合并。
- 不要提到总结过程，也不要提到上下文被压缩过。`

export const buildPrompt = (update: boolean, legacy = false) => {
  const shared = [
    "只总结用户和 assistant 说过和做过的事。不要写 assistant 收到的、而非用户提出的指令和设置：仓库约定、AGENTS.md 这类指令文件、会话 ID 这类环境细节。下一个 agent 会单独收到这些内容的当前版本。",
    SUMMARY_TEMPLATE,
    SUMMARY_RULES,
    "不要继续任务，也不要调用工具。",
    "只返回要求格式的结构化摘要。不要加前言、解释或其他评论。",
  ]
  if (!update) {
    return [
      "你必须把上面的对话总结成结构化摘要，交给另一个 agent 继续工作。",
      ...shared,
    ].join("\n\n")
  }
  return [
    "把上面对话里已有的 checkpoint 更新成一份合并后的摘要。",
    // Before #48058 (Sep 2026), summaries kept nearly everything: every file touched, per-edit changelogs,
    // restated AGENTS.md conventions, and an "Additional Context" section that grew on every update. The
    // preserve-first update prompt would carry that detail forward indefinitely, so a checkpoint from that
    // template is rewritten once at the current level of detail. The rewrite uses the new headings, so later
    // updates skip this. Remove once no session still in use has a latest checkpoint older than #48058.
    ...(legacy
      ? [
          "已有的 checkpoint 是用更早的格式写的，记录的细节比现在要求的更多。按下面描述的详细程度重写，不要把这些细节带过来。保留其中的需求、决策和未解决的问题；它们来自之前与用户的对话。",
        ]
      : []),
    "较新的历史总是优先于已有 checkpoint。保留之前的信息，除非较新的历史明确与它矛盾、取代它、解决它或使它过时。如果某项内容不再与继续工作相关，可以删除。",
    "纳入较新的需求、决策、进展和上下文。校准「工作状态」和「下一步」：把已完成的工作移出「进行中」，移除已解决的阻塞和已回答的问题，保留未解决或待处理的工作。",
    "只返回更新后的 Markdown 章节。不要重复上一个 checkpoint 里的 `<conversation-checkpoint>`、`<summary>` 或 `<recent-context>` 包装标签。",
    ...shared,
  ].join("\n\n")
}

const NUDGE =
  "上一条回复没有按要求填写摘要模板。不要调用工具。用模板里的确切章节标题，以文本形式返回摘要。"

/** Summaries written with the previous template carry this catch-all heading. */
const LEGACY_HEADING = "## Additional Context"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const catalog = yield* Model.Service
    const models = yield* SessionRunnerModel.Service
    const db = (yield* Database.Service).db
    const requests = yield* SessionModelRequest.Service

    const scope = yield* Scope.Scope
    const precomputed = new Map<SessionContext.Loaded["session"]["id"], Precomputed>()

    const state = State.create<Settings, Editor>({
      name: "session-compaction",
      initial: () => ({ auto: true, keep: 15_000, precompute: false }),
      editor: (settings) => ({
        configure: (update) => {
          Object.assign(settings, update)
        },
      }),
    })

    /** The model that writes the summary, and the request size it aims for. */
    const selectModel = Effect.fnUntraced(function* (
      context: SessionContext.Loaded,
      buffer: Settings["buffer"],
      native: boolean,
    ) {
      const agent = native ? undefined : yield* agents.get(Agent.ID.make("compaction"))
      const model =
        (agent?.model &&
          (yield* models
            .resolve({ ...context.session, model: agent.model }, catalog.available)
            .pipe(Effect.orElseSucceed(() => undefined)))) ??
        context.model
      const ceiling = calculateCeiling(model.limit, buffer)
      // An unknown window never triggers auto compaction, but the compaction request still needs a size to aim for.
      const cap = Number.isFinite(ceiling)
        ? ceiling
        : calculateCeiling({ ...model.limit, context: UNKNOWN_WINDOW }, buffer)
      return { context: model === context.model ? context : { ...context, model }, cap }
    })

    const compact = Effect.fn("SessionCompaction.compact")(function* (trigger: Trigger): Effect.fn.Return<Outcome> {
      const settings = state.get()
      const context = trigger.context

      // Only the user compacts when automatic compaction is off, overflow included.
      if (trigger.reason !== "manual" && !settings.auto) return { status: "skipped" }
      if (
        trigger.reason === "auto" &&
        !due(context, calculateCeiling(context.model.limit, settings.buffer), trigger.estimate)
      )
        return { status: "skipped" }
      const held = precomputed.get(context.session.id)
      precomputed.delete(context.session.id)
      const native = context.model.compaction?.type === "native"
      const model = yield* selectModel(context, settings.buffer, native)
      // The provider just rejected this context, so the estimate ran low; the first attempt already aims below it.
      const budget =
        trigger.reason === "overflow"
          ? Math.min(model.cap, Math.floor(total(trigger.estimate ?? estimatePrompt(context)) * SHRINK_STEPS[0]))
          : model.cap

      const selected = model.context === context ? trigger : { ...trigger, context: model.context }
      // The runner opened the manual compaction's message when it delivered the `/compact` item. An automatic one
      // opens here, before any wait, so a background summary still being written shows as a running compaction.
      if (trigger.reason !== "manual")
        yield* bus.publish(SessionEvent.Compaction.Started, { sessionID: context.session.id, reason: "auto" })
      const swapped = held ? yield* usePrecomputed(selected, held, budget, settings) : undefined
      const compaction = swapped
        ? Effect.succeed(swapped)
        : native
          ? compactNatively(selected, budget, settings.keep)
          : summarize(selected, budget, settings.keep)
      return yield* compaction.pipe(
        Effect.matchEffect({
          onSuccess: (result) => publish(selected, result),
          onFailure: (failure) => publish(selected, failure),
        }),
      )
    })

    /**
     * Once the context is within `PRECOMPUTE_LEAD` of the ceiling, summarizes everything before the latest response
     * in the background. That is the prefix the provider just processed, so the summary request reads it from the
     * prompt cache. The summary is held, not applied: swapping it in now would rewrite the prefix and throw away the
     * cache for every step until compaction is actually due. One summary is held per Session until compaction takes
     * it, or until it fails or falls too far behind, when a newer response replaces it.
     *
     * On a small window the lead is at most half the room the cycle started with, so the summary still covers more
     * than the previous one.
     */
    const precompute = Effect.fn("SessionCompaction.precompute")(function* <E>(
      load: Effect.Effect<SessionContext.Loaded, E>,
      given?: Estimate,
    ) {
      const settings = state.get()
      if (!settings.precompute || !settings.auto) return
      const context = yield* load
      if (context.model.compaction?.type === "native") return
      const ceiling = calculateCeiling(context.model.limit, settings.buffer)
      if (!Number.isFinite(ceiling)) return
      const estimate = given ?? estimatePrompt(context)
      if (due(context, ceiling, estimate)) return
      const first = context.messages.find((message) => hasMeasuredPrompt(message, context.model.ref))
      const cycleStart = first?.type === "assistant" && first.tokens ? promptTokens(first.tokens) : 0
      if (total(estimate) < ceiling - Math.min(PRECOMPUTE_LEAD, (ceiling - cycleStart) / 2)) return

      const anchorIndex = context.messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
      const anchor = context.messages[anchorIndex]
      if (anchorIndex <= 0 || anchor?.type !== "assistant" || !anchor.tokens) return

      const sessionID = context.session.id
      const existing = precomputed.get(sessionID)
      const exit = existing?.fiber.pollUnsafe()
      const failed = exit !== undefined && Exit.isFailure(exit)
      const failures = (existing?.failures ?? 0) + (failed ? 1 : 0)
      if (existing) {
        const index = heldIndex(existing, context)
        if (index >= 0 && !failed && tailTokens(context, index) <= existing.tailLimit) return
        // Summarizing up to the same response again would repeat the same request.
        if (index >= 0 && (existing.keepID === anchor.id || failures >= PRECOMPUTE_MAX_FAILURES)) return
        yield* Fiber.interrupt(existing.fiber)
        precomputed.delete(sessionID)
      }
      // After a model switch nothing is cached for the new model yet; wait until its first response has written it.
      if (anchor.model.id !== context.model.ref.id || anchor.model.variant !== context.model.ref.variant) return
      // The same once the latest response is older than the cache lifetime, as when the user comes back from a
      // break: the summary would write the whole prefix again, at the same time as the next request.
      const age = (yield* Clock.currentTimeMillis) - DateTime.toEpochMillis(anchor.time.created)
      if (age > cacheLifetime(context.model.cache?.ttl) - CACHE_MARGIN) return

      const model = yield* selectModel(context, settings.buffer, false)
      const usage: SessionUsage.Recorded[] = []
      const fiber = yield* summarize({ reason: "auto", context: model.context }, model.cap, settings.keep, {
        messages: context.messages.slice(0, anchorIndex),
        usage: (recorded) => usage.push(recorded),
      }).pipe(Effect.forkIn(scope))
      precomputed.set(sessionID, {
        firstID: context.messages[0]?.id,
        keepID: anchor.id,
        model: context.model.ref,
        initial: Instructions.join(context.initial),
        tailLimit: tailLimit(model.cap),
        failures,
        usage,
        fiber,
      })
    })

    /**
     * The held summary plus everything since it, kept verbatim, when it still describes this conversation and that
     * tail is short. Waits for a summary still being written. Undefined, after stopping the background work, when it
     * cannot be used; compaction then summarizes as usual.
     */
    const usePrecomputed = Effect.fnUntraced(function* (
      trigger: Trigger,
      held: Precomputed,
      budget: number,
      settings: Settings,
    ): Effect.fn.Return<Result | undefined> {
      const context = trigger.context
      const index = heldIndex(held, context)
      const usable =
        settings.precompute &&
        trigger.reason !== "overflow" &&
        context.model.compaction?.type !== "native" &&
        index >= 0 &&
        tailTokens(context, index) <= tailLimit(budget)
      if (!usable) {
        yield* Fiber.interrupt(held.fiber)
        return undefined
      }

      const exit = yield* Fiber.await(held.fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(held.fiber)))
      if (Exit.isFailure(exit)) return undefined
      // Background calls were billed as they finished; the compaction's message still shows what it cost.
      held.usage.forEach((usage) => addSpent(context.session.id, usage))
      return { ...exit.value, metadata: { keepID: held.keepID, ...exit.value.metadata } }
    })

    const due = (context: SessionContext.Loaded, ceiling: number, estimate?: Estimate) => {
      const messages = context.messages
      // A compaction just completed; let the runner rebuild the request from it first.
      const last = messages.at(-1)
      if (last?.type === "compaction" && last.status === "completed") return false
      // An encrypted native window estimates as nothing, so wait for a response to measure it.
      const measured = messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
      if (measured < messages.findLastIndex(SessionHistory.isNativeCompaction)) return false
      return total(estimate ?? estimatePrompt(context)) >= ceiling
    }

    /**
     *   first:  [E1 … E8][E9 E10]                  →  [S1 + "E9 E10"]
     *   again:  [S1 + "E9 E10"][E11 … E18][E19]    →  [S2 + "E19"]      S2 covers the whole current conversation
     *
     * The model is sent the whole conversation, including the tail kept beside the summary, then the summary prompt.
     * Keeping the normal request's prefix intact lets the summary reuse its prompt cache:
     *
     *   [system][S1 + "E9 E10"][E11 … E18][E19][prompt]    plus one nudge if the reply skips the template
     *
     * Later requests open with the checkpoint as one user message:
     *
     *   <conversation-checkpoint>
     *     <summary>S2</summary>
     *     <recent-context>E19</recent-context>
     *   </conversation-checkpoint>
     *   [new messages…]
     *
     * E = one exchange: a user message and the replies to it. S = a summary. [S + "…"] = one checkpoint: a summary
     * plus the newest `keep` tokens of messages, referenced by their first message and sent as text.
     */
    const summarize = Effect.fnUntraced(function* (
      trigger: Trigger,
      budget: number,
      keep: number,
      background?: Background,
    ): Effect.fn.Return<Result, Failure> {
      const context = trigger.context
      const messages = background?.messages ?? context.messages
      const split = splitConversation(messages, keep)
      if (split === undefined) return yield* Effect.fail(NOTHING_TO_COMPACT)
      // A background summary covers all of its messages; what follows them is kept when it is swapped in.
      const keepID = background ? undefined : split.keepID

      const previous = previousCompaction(messages)
      const prompt = buildPrompt(previous !== undefined, previous?.summary.includes(LEGACY_HEADING) ?? false)
      const headings = SUMMARY_TEMPLATE.split("\n").filter((line) => line.startsWith("##"))
      const filled = (text: string) => text.split("\n").some((line) => headings.includes(line.trim()))
      const prepared = yield* prepare(context, messages, budget)
      // Size the unchanged request with the number that decided to compact: the last response's count plus an
      // estimate of what came after it. Characters overstate a conversation whose old reasoning the provider drops.
      // A hook can still make this request larger than that count; the provider then rejects it and it is resent as
      // text. An overflow already proved the count low, so it keeps the character estimate.
      const measured = trigger.reason === "overflow" ? undefined : measuredPrompt({ ...context, messages })

      // Hooks saw the request without the summary prompt, so it is appended here. A reply that ignores the
      // template gets one reminder before it counts as a failure.
      const send = (request: LLMRequest, size?: Estimate) =>
        Effect.gen(function* () {
          const prompted = fitOutput(
            { ...request, messages: [...request.messages, Message.user(prompt)] },
            context.model.limit,
            size && { ...size, estimated: size.estimated + Token.estimate(prompt) },
          )
          const reply = yield* stream(context, prompted, prepared.options, background)
          if (filled(reply.text)) return reply

          const nudged = fitOutput(
            { ...prompted, messages: [...prompted.messages, Message.user(NUDGE)] },
            context.model.limit,
            size && { ...size, estimated: size.estimated + Token.estimate(prompt) + Token.estimate(NUDGE) },
          )
          const retry = yield* stream(context, nudged, prepared.options, background)
          if (filled(retry.text)) return retry
          return yield* Effect.fail<Failure>({
            error: {
              type: "compaction.failed",
              message: retry.text.trim()
                ? "Compaction summary did not match the required template"
                : "Compaction produced no summary",
            },
          })
        })

      const overhead = Token.estimate(prompt) + Token.estimate(NUDGE)
      // Automatic compaction starts past the ceiling, so the whole conversation is sent unchanged while the window can
      // still fit the summary. Below that, the history before the tail is sent instead, as before: unchanged when it fits,
      // which still reuses the cache for that shorter prefix, and as text otherwise. Dropping exchanges to make room
      // for the tail would leave them in neither the summary nor the tail. Where 15% of the window is under
      // `RESERVE_MIN`, the ceiling equals `summaryRoom`, so automatic compaction always takes this fallback.
      const fit =
        trigger.reason === "overflow"
          ? budget
          : Math.max(budget, summaryRoom(context.model.limit, prepared.request.maxTokens))
      const result = yield* deliver(
        trigger,
        prepared,
        budget - overhead,
        send,
        {
          fit: fit - overhead,
          history: withoutTail(prepared.request, keepID),
          measured,
          // The provider just rejected this conversation, so sending it unchanged again would be rejected too.
          text: trigger.reason === "overflow",
        },
        background,
      )
      if (!keepID) return result
      // A compaction hook may choose its own kept range.
      return { ...result, metadata: { keepID, ...result.metadata } }
    })

    /**
     *   endpoint:  [window]                      →  [U U][item]    the provider picks which messages to keep
     *   trigger:   [window][compaction_trigger]  →  [item]
     *                                            →  [U U][item]    we add the newest user messages within `keep`
     *
     * Later requests open with that replacement window in place of the history it covers:
     *
     *   [U U][item][new messages…]
     *
     * window = the previous compaction and everything since. item = one encrypted compaction item, which only
     * replays on the model that made it. U = a user message as typed.
     */
    const compactNatively = Effect.fnUntraced(function* (
      trigger: Trigger,
      budget: number,
      keep: number,
    ): Effect.fn.Return<Result, Failure> {
      const context = trigger.context
      if (!context.messages.some(SessionRecentText.messageToText)) return yield* Effect.fail(NOTHING_TO_COMPACT)
      const unsupported = (message: string) =>
        Effect.fail<Failure>({ error: { type: "provider.unsupported-operation", message } })
      const prepared = yield* prepare(context, context.messages, budget, "session")

      const toResult = (window: ReadonlyArray<Message>, usage: Usage | undefined) =>
        spend(context.session.id, usage && SessionUsage.record(usage, context.model.cost)).pipe(
          Effect.as<Result>({
            text: "",
            // Plain JSON, not the schema encoder: provider metadata can hold undefined entries, which it rejects.
            native: { messages: JSON.parse(JSON.stringify(window)) },
          }),
        )

      const send = (request: LLMRequest) => {
        if (ai.canCompact(request, { mechanism: "trigger" })) {
          return Effect.gen(function* () {
            const history = yield* SessionHistory.load(db, context.session.id, "local").pipe(Effect.orDie)
            const retained = recentUserMessages(history, context.model, keep)
            const response = yield* llm.compact(request, { ...prepared.options, mechanism: "trigger" })
            return yield* toResult([...retained, Message.assistant(response.checkpoint)], response.usage)
          })
        }
        if (ai.canCompact(request)) {
          return llm
            .compact(request, { mechanism: "endpoint", http: prepared.options.http })
            .pipe(Effect.flatMap((response) => toResult(response.replacement, response.usage)))
        }
        return unsupported(`Native compaction is not supported for ${request.model.provider}/${request.model.route.id}`)
      }

      return yield* deliver(trigger, prepared, budget, send)
    })

    /**
     * Sends the request as-is if it is estimated to fit `shrink.fit`, else `shrink.history` as-is if it fits `target`,
     * and otherwise `shrink.history` as text aimed at `target` (see `flattenAndDropOldest`). `shrink.measured`, when
     * given, sizes the unchanged request until the provider rejects it; after that it is only sent as text.
     * Limits and estimates can be wrong, so until the provider rejects something as too long, a request that cannot
     * be made to fit is sent whole: unchanged, or as text once its media has to go. A "too long" rejection means the
     * estimate ran low, so the next attempts aim at 85%, 70%, 50%, then 35% of the first rejected request's estimate,
     * each shortening the transcript again from scratch, and a rejection after those gives up. A "payload too large"
     * rejection is about bytes, which inline media almost always accounts for, so one on the unchanged request resends
     * it as text, which carries no media, without counting; one on text counts as "too long". Other provider errors
     * resend the same request under the session's retry policy. A `Failure` from `send` is a reply that cannot be
     * used, and is never retried.
     */
    const deliver = Effect.fnUntraced(function* (
      trigger: Trigger,
      prepared: Prepared,
      target: number,
      send: (request: LLMRequest, size?: Estimate) => Effect.Effect<Result, AIError | Failure>,
      shrink: {
        readonly fit: number
        readonly history: LLMRequest
        readonly measured?: Estimate
        readonly text?: boolean
      } = {
        fit: target,
        history: prepared.request,
      },
      background?: Background,
    ): Effect.fn.Return<Result, Failure> {
      const context = trigger.context
      if (prepared.event.result) return yield* fromHook(context, prepared.event.result, background)

      const policy = yield* SessionRunnerRetry.policy(context.session.id)
      let rejections = 0
      let rejected: number | undefined
      let asText = shrink.text ?? false
      let fit = shrink.fit

      while (true) {
        const measured = rejections === 0 ? shrink.measured : undefined
        const unchanged = asText
          ? undefined
          : (measured ? total(measured) : estimateRequest(prepared.request)) <= fit
            ? prepared.request
            : estimateRequest(shrink.history) <= target
              ? shrink.history
              : undefined
        const request =
          unchanged ??
          flattenAndDropOldest(shrink.history, context, target) ??
          (rejections > 0
            ? undefined
            : asText
              ? flattenAndDropOldest(shrink.history, context, Number.POSITIVE_INFINITY)
              : shrink.history)
        if (!request) {
          return yield* Effect.fail<Failure>({
            error: {
              type: "compaction.failed",
              message:
                "The compaction request cannot be reduced further without losing the latest exchange or checkpoint",
            },
          })
        }

        const size = request === prepared.request ? measured : undefined
        const attempt = yield* Effect.result(send(request, size))
        if (Result.isSuccess(attempt)) return attempt.success
        const cause = attempt.failure
        if (!(cause instanceof AIError)) return yield* Effect.fail(cause)
        const error = toSessionError(cause)
        const tooLarge = cause.reason._tag === "InvalidRequest" && cause.reason.classification === "payload-too-large"

        if (tooLarge && (request === prepared.request || request === shrink.history)) {
          asText = true
          continue
        }

        if (tooLarge || isContextOverflowFailure(cause)) {
          const step = SHRINK_STEPS[rejections]
          if (step === undefined) return yield* Effect.fail<Failure>({ error })
          rejected ??= size ? total(size) : estimateRequest(request)
          // The characters can still say the rejected request fits, so it only goes out again as text.
          if (size) asText = true
          target = Math.floor(rejected * step)
          fit = target
          rejections++
          continue
        }

        const decision = yield* policy({
          cause,
          error,
          agent: context.agent.id,
          model: context.model.ref,
          hook: prepared.retry,
          retry: SessionRunnerRetry.isRetryable(cause),
        })
        if (!decision.retry) return yield* Effect.fail<Failure>({ error })
        yield* Effect.sleep(decision.delay)
      }
    })

    /**
     * History that has to change is sent as text rather than as edited messages: `[previous compaction][transcript]`,
     * the conversation since that compaction as one text message. A previous summary always stays in front, while
     * its verbatim recent part becomes the oldest transcript entry; a previous native window stays exactly as the
     * provider made it. The transcript has no tool definitions, which the summary does not need and which no longer
     * share a cached prefix, and leaves out reasoning, media, and instruction updates.
     *
     * When the whole transcript does not fit, exchanges are shortened oldest first, one level at a time, until it
     * does (see `flattenMessage` for the levels): every exchange reaches a level before any reaches the next, so
     * detail is lost from the oldest history first and whole exchanges are omitted only as a last resort. The newest
     * exchange is never omitted; undefined when the transcript cannot fit even so.
     */
    const flattenAndDropOldest = (request: LLMRequest, context: SessionContext.Loaded, target: number) => {
      const previous = previousCompaction(context.messages)
      const end =
        request.messages.findLastIndex(
          (message) =>
            (previous !== undefined && message.id === previous.id) ||
            message.content.some((part) => part.type === "compaction"),
        ) + 1
      const summary = previous !== undefined && !SessionHistory.isNativeCompaction(previous) ? previous : undefined
      // TODO: Read the previous summary from the hooked request once it no longer merges summary and recent into one
      // message. Until then it is rebuilt from storage, which drops a compaction hook's edits to that message.
      const lead = summary
        ? toLLMMessages([{ ...summary, metadata: { ...summary.metadata, recent: "" } }], context.model.ref)
        : request.messages.slice(0, end)
      const recent = summary ? SessionRecentText.kept(summary) : ""

      // A user message and everything after it, up to the next one, is one exchange. Each is rendered at every level
      // once, so shortening is running arithmetic over these sizes. The previous summary's recent part is already
      // shortened text: whole until it is omitted.
      const exchanges = [
        ...(recent ? [TRANSCRIPT_LEVELS.map((level) => (level === OMITTED ? "" : recent))] : []),
        ...request.messages
          .slice(end)
          .reduce<Message[][]>((groups, message) => {
            if (message.role === "user" || groups.length === 0) groups.push([message])
            else groups[groups.length - 1].push(message)
            return groups
          }, [])
          .map((group) =>
            TRANSCRIPT_LEVELS.map((level) =>
              group
                .map((message) => flattenMessage(message, level))
                .filter(Boolean)
                .join("\n"),
            ),
          )
          .filter((renders) => renders[0]),
      ]
      if (exchanges.length === 0) return undefined
      const note = (omitted: number) =>
        omitted ? `[已省略更早的 ${omitted} 轮对话]\n\n` : ""
      const size = (text: string) => (text ? Token.estimate(text) + 1 : 0)
      // Room for the longest possible note is set aside before choosing what to keep.
      const room =
        target -
        estimateRequest({ system: request.system, tools: [], messages: lead }) -
        Token.estimate(note(exchanges.length))

      const levels = exchanges.map(() => 0)
      let total = exchanges.reduce((sum, renders) => sum + size(renders[0]), 0)
      const newest = exchanges.length - 1
      for (const level of TRANSCRIPT_LEVELS.slice(1)) {
        for (let index = 0; index < exchanges.length && total > room; index++) {
          // The newest exchange is what the summary most needs; it is shortened but never left out.
          if (index === newest && !exchanges[index][level]) continue
          total += size(exchanges[index][level]) - size(exchanges[index][levels[index]])
          levels[index] = level
        }
      }
      if (total > room) return undefined

      // Includes exchanges with no user text, which are already gone at `USER_ONLY`.
      const omitted = levels.filter((level, index) => !exchanges[index][level]).length
      const text = exchanges
        .map((renders, index) => renders[levels[index]])
        .filter(Boolean)
        .join("\n\n")
      return { ...request, tools: [], messages: [...lead, Message.user(note(omitted) + text)] }
    }

    const stream = (
      context: SessionContext.Loaded,
      request: LLMRequest,
      options: StreamOptions,
      background?: Background,
    ) => {
      const sessionID = context.session.id
      const unusable = (error: SessionError.Error) => Effect.fail<Failure>({ error })

      return llm.stream(request, options).pipe(
        Stream.runFoldEffect(
          (): Streamed => ({ text: "" }),
          (streamed, event): Effect.Effect<Streamed, AIError | Failure> => {
            if (LLMEvent.is.textDelta(event)) {
              const next = { ...streamed, text: streamed.text + event.text }
              if (background) return Effect.succeed(next)
              return bus.publish(SessionEvent.Compaction.Delta, { sessionID, text: event.text }).pipe(Effect.as(next))
            }

            if (LLMEvent.is.stepFinish(event)) {
              return spend(sessionID, SessionUsage.record(event.usage, context.model.cost), background?.usage).pipe(
                Effect.as(streamed),
              )
            }

            if (!LLMEvent.is.finish(event)) return Effect.succeed(streamed)
            switch (event.reason.normalized) {
              case "unknown":
                return Effect.fail(
                  new AIError({
                    reason: new InvalidProviderOutputError({
                      message: "The provider response ended with an unknown finish reason.",
                      classification: "incomplete-stream",
                    }),
                  }),
                )
              case "error":
                return Effect.fail(
                  new AIError({ reason: new UnknownProviderError({ message: "Compaction generation failed" }) }),
                )
              case "length":
                return unusable({
                  type: "compaction.failed",
                  message: "Compaction summary reached the output token limit",
                })
              case "content-filter":
                return unusable(contentFilterError("Compaction summary was blocked by the provider", event.reason))
              default:
                return Effect.succeed(streamed)
            }
          },
        ),
      )
    }

    /**
     * The conversation as the runner would send it, after request hooks.
     *
     * The output limit leaves room for `budget`, the most `deliver` sends. The request prepared here can be larger
     * when the conversation overshot the threshold, and is only shrunk to fit after hooks have seen it, so sizing the
     * output to it would leave next to no room. A prompt the estimate undersells is rejected and shrunk like any
     * other.
     */
    const prepare = (
      context: SessionContext.Loaded,
      messages: ReadonlyArray<SessionMessage.Info>,
      budget: number,
      webSocket?: "session",
    ) => {
      const base = transcript(context, messages)
      return requests.compaction({
        session: context.session,
        agent: context.agent.id,
        model: context.model,
        tools: context.tools,
        system: base.system,
        messages: base.messages,
        webSocket,
        inputTokens: { measured: budget, estimated: 0 },
      })
    }

    /** A request hook supplied the summary itself, so no model call happens. */
    const fromHook = (context: SessionContext.Loaded, supplied: SessionCompactionResult, background?: Background) => {
      const usage = supplied.tokens && {
        tokens: supplied.tokens,
        cost: SessionUsage.calculateCost(context.model.cost, supplied.tokens),
      }
      return spend(context.session.id, usage, background?.usage).pipe(
        Effect.as<Result>({
          text: supplied.summary,
          native: supplied.native,
          metadata: supplied.metadata,
        }),
      )
    }

    /**
     * Each model call is billed as soon as it finishes, so failed and interrupted compactions are billed too. The
     * compaction's message shows the total across all of its calls. A session never runs two compactions at once;
     * a background summary keeps its own total until a compaction takes it.
     */
    const spent = new Map<SessionContext.Loaded["session"]["id"], SessionUsage.Recorded>()
    const addSpent = (sessionID: SessionContext.Loaded["session"]["id"], usage: SessionUsage.Recorded) => {
      const total = spent.get(sessionID)
      spent.set(sessionID, total ? SessionUsage.add(total, usage) : usage)
    }
    const spend = (
      sessionID: SessionContext.Loaded["session"]["id"],
      usage: SessionUsage.Recorded | undefined,
      record = (recorded: SessionUsage.Recorded) => addSpent(sessionID, recorded),
    ) =>
      Effect.gen(function* () {
        if (!usage) return
        record(usage)
        yield* bus.publish(SessionEvent.UsageRecorded, { sessionID, source: "compaction", ...usage })
      })

    const publish = Effect.fnUntraced(function* (
      trigger: Trigger,
      outcome: Result | Failure,
    ): Effect.fn.Return<Outcome> {
      const context = trigger.context
      const sessionID = context.session.id
      const reason = trigger.reason === "manual" ? "manual" : "auto"
      const usage = spent.get(sessionID)

      if ("error" in outcome) {
        yield* bus.publish(SessionEvent.Compaction.Failed, {
          sessionID,
          reason,
          inputID: trigger.reason === "manual" ? trigger.inputID : undefined,
          error: outcome.error,
          ...usage,
        })
        return { status: "failed", error: outcome.error }
      }

      yield* bus.publish(
        SessionEvent.Compaction.Ended,
        {
          sessionID,
          reason,
          model: context.model.ref,
          native: outcome.native,
          text: outcome.text,
          ...usage,
        },
        { metadata: outcome.metadata },
      )
      return { status: "completed" }
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      // A manual compaction settles through its `/compact` inbox item, which the runner owns.
      compact: (trigger) =>
        compact(trigger).pipe(
          Effect.onInterrupt(() =>
            trigger.reason === "manual"
              ? Effect.void
              : publish(trigger, { error: { type: "compaction.interrupted", message: "Compaction was interrupted" } }),
          ),
          Effect.ensuring(Effect.sync(() => spent.delete(trigger.context.session.id))),
        ),
      precompute,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Agent.node, Bus.node, Database.node, llmClient, Model.node, SessionModelRequest.node, SessionRunnerModel.node],
})

/**
 * Where the messages kept beside a held summary start, or -1 when the summary no longer describes this
 * conversation: a compaction or revert since replaced its start, or the model or instructions changed.
 */
const heldIndex = (held: Precomputed, context: SessionContext.Loaded) => {
  if (held.firstID !== context.messages[0]?.id || held.initial !== Instructions.join(context.initial)) return -1
  if (held.model.providerID !== context.model.ref.providerID || held.model.id !== context.model.ref.id) return -1
  if (held.model.variant !== context.model.ref.variant) return -1
  return context.messages.findIndex((message) => message.id === held.keepID)
}

/** Estimated text a swapped-in summary keeps verbatim: every message from `index` on. */
const tailTokens = (context: SessionContext.Loaded, index: number) =>
  Token.estimate(context.messages.slice(index).map(SessionRecentText.messageToText).filter(Boolean).join("\n\n"))

const tailLimit = (budget: number) => Math.floor(budget * PRECOMPUTED_TAIL_SHARE)

const promptTokens = (tokens: { input: number; cache: { read: number; write: number } }) =>
  tokens.input + tokens.cache.read + tokens.cache.write

const DURATION_UNITS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Milliseconds a prompt cache entry lives, from a `cache.ttl` such as "5m" or "1h". */
const cacheLifetime = (ttl: string | undefined) => {
  const match = ttl?.match(/^(\d+)(ms|s|m|h|d)$/)
  return match ? Number(match[1]) * DURATION_UNITS[match[2] as keyof typeof DURATION_UNITS] : CACHE_LIFETIME
}

/** History loads from the latest completed compaction, so a previous one is always the first message. */
const previousCompaction = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const [first] = messages
  return first?.type === "compaction" && first.status === "completed" ? first : undefined
}

const transcript = (context: SessionContext.Loaded, messages: ReadonlyArray<SessionMessage.Info>) =>
  SessionModelRequest.baseTranscript({
    agent: context.agent.info,
    model: context.model,
    tools: context.tools,
    initial: context.initial,
    project: context.project,
    sessionPrompt: context.session.prompt,
    messages,
  })

/**
 * The newest messages within `keep` tokens, from `keepID` on, are kept verbatim beside the summary.
 * Undefined when there is nothing to compact.
 */
const splitConversation = (messages: ReadonlyArray<SessionMessage.Info>, keep: number) => {
  const entries = messages.flatMap((message) => {
    const text = SessionRecentText.messageToText(message)
    return text ? [{ message, text }] : []
  })
  if (entries.length === 0) return undefined

  const first = entries[recentStart(entries, keep, previousCompaction(messages))]
  return {
    keepID: first?.message.id,
  }
}

/** The request without the retained tail, which starts at the message with ID `from`. */
const withoutTail = (request: LLMRequest, from: SessionMessage.ID | undefined) => {
  const index = from === undefined ? -1 : request.messages.findIndex((message) => message.id === from)
  if (index < 0) return request
  return { ...request, messages: request.messages.slice(0, index) }
}

const recentStart = (
  entries: ReadonlyArray<{ readonly message: SessionMessage.Info; readonly text: string }>,
  keep: number,
  previous: SessionMessage.CompactionCompleted | undefined,
) => {
  // Drop the oldest entries until the rest fit the allowance, but always keep the newest one.
  const dropped = Math.min(
    oldestToDrop(entries, (entry) => Token.estimate(entry.text), keep),
    entries.length - 1,
  )

  // Start at a user message so an assistant's tool calls and results stay together.
  const userBoundary = entries.findLastIndex((entry, index) => index <= dropped && entry.message.type === "user")
  if (userBoundary > 0) return userBoundary

  // Everything fits. Keep only the latest exchange rather than duplicating the whole conversation beside the summary.
  const latestUser = entries.findLastIndex((entry) => entry.message.type === "user")
  if (latestUser > 0) return latestUser

  // One exchange, nothing older. Summarize it all and keep nothing, unless a previous summary already
  // kept recent text, in which case keep everything and summarize only the summary before it.
  return previous && SessionRecentText.kept(previous) ? 0 : entries.length
}

const oldestToDrop = <T>(items: ReadonlyArray<T>, size: (item: T) => number, budget: number) => {
  let total = 0
  let start = items.length
  while (start > 0) {
    const next = total + size(items[start - 1])
    if (next > budget) break
    total = next
    start--
  }
  return start
}

/** One request message as transcript lines at a shortening level. Empty for what that level leaves out. */
const flattenMessage = (message: Message, level: number) => {
  if (message.role === "system" || level === OMITTED) return ""
  if (level >= USER_ONLY && message.role !== "user") return ""
  return message.content
    .flatMap((part) => {
      if (part.type === "text") {
        if (!part.text) return []
        const text = level >= USER_ONLY ? clip(part.text) : part.text
        return [`[${message.role === "user" ? "用户" : "助手"}]：${text}`]
      }
      if (level >= USER_ONLY) return []
      if (part.type === "media") return [`[${part.media.mediaType} 已省略]`]
      if (part.type === "tool-call") {
        const input = JSON.stringify(part.input) ?? ""
        return [`[助手工具调用]：${part.name}(${level >= OUTPUTS_REMOVED ? clip(input) : input})`]
      }
      if (part.type !== "tool-result") return []
      const result = part.result
      const label = result.type === "error" ? "工具错误" : "工具结果"
      if (level >= OUTPUTS_REMOVED) return [`[${label}已省略]`]
      const output =
        result.type === "content"
          ? SessionRecentText.serializeToolContent(result.value)
          : typeof result.value === "string"
            ? result.value
            : (JSON.stringify(result.value) ?? "")
      return [`[${label}]：${level >= OUTPUTS_CLIPPED ? clip(output) : output}`]
    })
    .join("\n")
}

/** `value` cut to `TRANSCRIPT_CLIP` characters from its start and end, never splitting a surrogate pair. */
const clip = (value: string) => {
  if (value.length <= TRANSCRIPT_CLIP) return value
  const chars = Array.from(value)
  if (chars.length <= TRANSCRIPT_CLIP) return value
  const half = TRANSCRIPT_CLIP / 2
  const omitted = chars.length - TRANSCRIPT_CLIP
  return `${chars.slice(0, half).join("")}\n[… 省略 ${omitted} 个字符 …]\n${chars.slice(-half).join("")}`
}

/** The newest whole, real user messages within `keep` tokens: no synthetic guidance, no half of an attachment. */
export const recentUserMessages = (
  messages: ReadonlyArray<SessionMessage.Info>,
  model: Pick<SessionContext.Loaded["model"], "ref" | "capabilities">,
  keep: number,
) => {
  const users = messages
    .filter((message) => message.type === "user")
    .map((message) => ({ ...message, skills: undefined }))
  const sendable = SessionModelRequest.boundImages(
    SessionModelRequest.unsupportedParts(toLLMMessages(users, model.ref), model.capabilities),
  )
  return sendable.slice(oldestToDrop(sendable, estimateMessage, keep))
}

const total = (estimate: Estimate) => estimate.measured + estimate.estimated

export const estimateContext = (context: SessionContext.Loaded) => total(estimatePrompt(context))

/** The size of the prompt `context` sends. */
export const estimatePrompt = (context: SessionContext.Loaded): Estimate => {
  const anchorIndex = context.messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
  const anchor = context.messages[anchorIndex]
  const base = transcript(context, context.messages.slice(Math.max(0, anchorIndex)))
  // TODO: Pass compaction history the runner has already shaped. This and `recentUserMessages` repeat the
  // runner's unsupported-media and image-budget passes; here the image budget only sees images since the anchor,
  // so image-heavy sessions can estimate high.
  const sent = SessionModelRequest.boundImages(
    SessionModelRequest.unsupportedParts(base.messages, context.model.capabilities),
  )
  // The anchor's usage covers its own output, but not its local tool results, which the provider never saw.
  const unmeasured = sent.filter((message) => message.role !== "assistant" || message.id !== anchor?.id)

  if (anchor?.type !== "assistant" || !anchor.tokens)
    return {
      measured: 0,
      estimated: estimateRequest({ system: base.system, tools: context.tools.definitions, messages: unmeasured }),
    }

  const tokens = anchor.tokens
  return {
    measured: tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning,
    estimated: unmeasured.reduce((sum, message) => sum + estimateMessage(message), 0),
  }
}

/**
 * The largest request the model takes while leaving room for its reply: `RESERVE_SHARE` of the window, or
 * `RESERVE_MIN` when that is more. A summary request that must be shrunk is aimed at the same size. A window too small
 * to give up `RESERVE_MIN` keeps `RESERVE_SHARE`.
 */
const calculateCeiling = (limit: SessionContext.Loaded["model"]["limit"], buffer: Settings["buffer"]) => {
  // With no window at all, only a provider rejection can limit the request.
  const window = inputWindow(limit)
  if (window <= 0) return Number.POSITIVE_INFINITY
  const tokens = typeof buffer === "string" ? Math.round((window * Number.parseFloat(buffer)) / 100) : buffer
  // A buffer that leaves no room, such as one set for a larger model, is ignored.
  if (tokens !== undefined && tokens < window) return window - tokens
  return window - Math.max(Math.floor(window * RESERVE_SHARE), window >= 2 * RESERVE_MIN ? RESERVE_MIN : 0)
}

/**
 * The largest summary request that leaves `RESERVE_MIN` of the window for the summary, or less when the request
 * cannot generate that much. Zero for an unknown window.
 */
const summaryRoom = (limit: SessionContext.Loaded["model"]["limit"], output = RESERVE_MIN) =>
  Math.max(0, inputWindow(limit) - Math.min(RESERVE_MIN, output))

/**
 * The largest prompt the model takes, or 0 when unknown. Unknown limits are reported as 0, and an unknown input limit
 * falls back to the context window. The context window also holds the reply, so an input limit above it, as some
 * catalogs and config overrides report, cannot be used in full.
 */
const inputWindow = (limit: SessionContext.Loaded["model"]["limit"]) =>
  limit.input && limit.context ? Math.min(limit.input, limit.context) : limit.input || limit.context

/**
 * Another provider's count may describe a native window this model cannot replay. History then holds the original
 * messages that window stood for, which the count leaves out, so only the current provider's counts are trusted.
 */
const hasMeasuredPrompt = (message: SessionMessage.Info, model: SessionContext.Loaded["model"]["ref"]) =>
  message.type === "assistant" &&
  message.model.providerID === model.providerID &&
  !message.error &&
  message.tokens !== undefined &&
  promptTokens(message.tokens) > 0

/** The prompt size, only while the model, variant and agent that were measured still match; they shape the request. */
const measuredPrompt = (context: SessionContext.Loaded) => {
  const anchor = context.messages.findLast((message) => hasMeasuredPrompt(message, context.model.ref))
  if (
    anchor?.type !== "assistant" ||
    anchor.model.id !== context.model.ref.id ||
    anchor.model.variant !== context.model.ref.variant ||
    anchor.agent !== context.agent.id
  )
    return undefined
  return estimatePrompt(context)
}

/**
 * `prepare` sizes the output limit for a request of `budget` tokens, but `deliver` can send a larger one when it
 * cannot shrink the conversation further. Lower the limit to the room the request being sent leaves in the window,
 * so the input and the requested output never exceed the window by our own estimate.
 *
 * The limit leaves the same margin for a low estimate that primary requests do. `deliver` aims at about 90% of the
 * window, so that margin alone would cut a summary near its target to the minimum; there it still gets up to
 * `SUMMARY_OUTPUT_FLOOR` of the room left without the margin.
 */
const fitOutput = (request: LLMRequest, limit: SessionContext.Loaded["model"]["limit"], size?: Estimate) => {
  const current = request.maxTokens
  if (current === undefined) return request
  const input = size ?? { measured: 0, estimated: estimateRequest(request) }
  const maxTokens = Math.min(
    current,
    Math.max(
      SessionModelRequest.outputLimit(limit, input),
      Math.min(SUMMARY_OUTPUT_FLOOR, SessionModelRequest.outputLimit(limit, { measured: total(input), estimated: 0 })),
    ),
  )
  if (maxTokens === current) return request
  return { ...request, maxTokens }
}

const estimateRequest = (request: Pick<LLMRequest, "system" | "tools" | "messages">) =>
  request.system.reduce((sum, part) => sum + Token.estimate(part.text), 0) +
  request.tools.reduce((sum, tool) => sum + estimateTool(tool), 0) +
  request.messages.reduce((sum, message) => sum + estimateMessage(message), 0)

/** Only what providers receive; `metadata` and `native` stay local. */
const estimateTool = (tool: ToolEntry): number => {
  if (tool.type === "tool") return Token.estimate(tool.name + tool.description + JSON.stringify(tool.inputSchema))
  return (
    Token.estimate(tool.name + (tool.description ?? "")) +
    tool.tools.reduce((sum, entry) => sum + estimateTool(entry), 0)
  )
}

const estimateMessage = (message: Message) => message.content.reduce((sum, part) => sum + estimatePart(part), 0)

const estimatePart = (part: ContentPart): number => {
  // An encrypted native compaction has no locally measurable size.
  if (part.type === "compaction") return Token.estimate(part.text ?? "")
  if (part.type === "effort") return 0
  if (part.type === "text" || part.type === "reasoning") return Token.estimate(part.text)
  if (part.type === "media") return estimateMedia(part.media.mediaType)
  if (part.type === "tool-call") return Token.estimate(part.name + (JSON.stringify(part.input) ?? ""))

  if (part.result.type === "content")
    return part.result.value.reduce(
      (sum, content) => sum + (content.type === "text" ? Token.estimate(content.text) : estimateMedia(content.mime)),
      0,
    )
  const value = part.result.value
  return Token.estimate(typeof value === "string" ? value : (JSON.stringify(value) ?? ""))
}

const estimateMedia = (mime: string) => {
  const type = mime.toLowerCase()
  if (type.startsWith("image/")) return IMAGE_TOKEN_ESTIMATE
  if (type === "application/pdf") return PDF_TOKEN_ESTIMATE
  return 0
}
