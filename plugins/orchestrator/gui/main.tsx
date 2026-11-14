import { mkdirSync, readFileSync, watch } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { Option, Schema } from "effect"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { ComposerPill, Panel, type PanelTab } from "@opencode/plugin/gui"
import { Plugin } from "@opencode/plugin/gui/main"
import { project } from "../src/board.js"
import { Contract } from "../src/contract.js"
import { Ledger } from "../src/ledger.js"
import { Board } from "./ipc.js"

/** The server's ledger (`ctx.paths.data`), read here because the board is a window over the same file. */
const LedgerPath = join(homedir(), ".opencode", "plugin-data", "changhong.orchestrator", "ledger.json")

/** What a missing or unreadable ledger reads as. Nothing is written back, so the file stays the server's. */
const Empty: Ledger.File = { version: 1, plans: {}, tasks: {}, anomalies: [] }

/** One color per status, by meaning rather than by the status name. */
const Tone: Readonly<Record<Ledger.Status, string>> = {
  待派: "var(--v2-text-text-faint)",
  进行中: "var(--v2-state-fg-info)",
  已回传: "var(--v2-state-fg-warning)",
  已核: "var(--v2-state-fg-success)",
  已合入: "var(--v2-text-text-accent)",
  失败: "var(--v2-state-fg-danger)",
  阻塞: "var(--v2-state-fg-danger)",
}

const Muted = "var(--v2-text-text-muted)"
const Faint = "var(--v2-text-text-faint)"
const Dangerous = "var(--v2-state-fg-danger)"
const Border = "var(--v2-border-border-muted)"
const Code = "var(--v2-font-family-code)"

/**
 * The ledger as the board reads it. A missing file, a file caught mid-replacement, and one that does not decode all
 * read as an empty ledger: the panel shows its empty state instead of failing the window, and nothing is rebuilt.
 */
function readLedger(): Ledger.File {
  const text = readText()
  if (text === undefined) return Empty
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Ledger.File))(text)
  return Option.isSome(decoded) ? decoded.value : Empty
}

function readText() {
  try {
    return readFileSync(LedgerPath, "utf8")
  } catch {
    return undefined
  }
}

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/**
 * The main process half: it reads the ledger for the session each window reports and pushes a new snapshot whenever
 * the file changes. The server owns the ledger, so this side only ever reads it.
 */
const main: Plugin.MainSetup = (ctx) => {
  const sessions = new Map<number, string>()

  const provider = ctx.provide(Board, {
    state: (window: number) => project(readLedger(), sessions.get(window) ?? ""),
    setSession: (id, caller) => {
      sessions.set(caller.window, id)
      provider.changed(caller.window)
    },
    refetch: () => {},
  })

  // Every write replaces the ledger by rename, so watching the file itself would lose it after one write; watch the
  // directory instead, and fold a burst of writes into one push. The directory is the plugin's own data directory.
  const directory = dirname(LedgerPath)
  mkdirSync(directory, { recursive: true })

  let pending: ReturnType<typeof setTimeout> | undefined
  const watcher = watch(directory, { persistent: false }, (_event, file) => {
    if (file && file !== "ledger.json") return
    if (pending) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      provider.changed()
    }, 200)
  })
  watcher.on("error", (cause) => ctx.log.write("warn", "编排看板：台账监听失败", { error: String(cause) }))

  ctx.onCleanup(() => {
    watcher.close()
    if (pending) clearTimeout(pending)
  })
}

interface BoardViewProps {
  /** The board Ipc client. Passed as an object, not a bare accessor: solid-js/h wraps zero-arg function props into getters. */
  readonly board: { state: () => Contract.BoardState | undefined }
  readonly openSession: (sessionID: string) => void
}

/**
 * The panel body. It is read-only on purpose: the ledger's writer is the server, and every decision goes through
 * `orchestrator.resolve` from a session, never from a board row.
 */
function BoardView(props: BoardViewProps) {
  const [selected, setSelected] = createSignal<string | null>(null)
  const [expanded, setExpanded] = createSignal<readonly string[]>([])

  const plans = createMemo(() => props.board.state()?.plans ?? [])
  const current = createMemo(() => props.board.state()?.current ?? null)
  // The newest batch is the one the projection carries tasks for; an older selection keeps its header only.
  const active = createMemo(() => {
    const chosen = selected()
    const list = plans()
    return list.find((plan) => plan.planID === chosen) ?? list[0]
  })
  const rows = createMemo(() => {
    const view = current()
    if (!view || view.planID !== active()?.planID) return []
    // Anomalies first so a problem is never below the fold; the sort is stable, so the rest keeps the ledger order.
    return [...view.tasks].sort((a, b) => Number(b.anomaly !== null) - Number(a.anomaly !== null))
  })
  const toggle = (id: string) =>
    setExpanded(expanded().includes(id) ? expanded().filter((item) => item !== id) : [...expanded(), id])

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "10px",
        padding: "12px",
        height: "100%",
        "box-sizing": "border-box",
        overflow: "auto",
        "font-size": "12px",
        "line-height": "var(--line-height-compact, 16px)",
        color: "var(--v2-text-text-base)",
      }}
    >
      <Show
        when={plans().length > 0}
        fallback={<p style={{ color: Muted, margin: "0" }}>本会话还没有编排批次</p>}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "min-width": "0" }}>
          <Show
            when={plans().length > 1}
            fallback={
              <span style={{ "font-family": Code, overflow: "hidden", "text-overflow": "ellipsis" }}>
                {active()?.planID}
              </span>
            }
          >
            <select
              value={active()?.planID ?? ""}
              onChange={(event) => setSelected(event.currentTarget.value)}
              style={{
                "font-family": Code,
                "font-size": "12px",
                color: "var(--v2-text-text-base)",
                background: "var(--v2-background-bg-layer-01)",
                border: `1px solid ${Border}`,
                "border-radius": "4px",
                padding: "2px 4px",
                "max-width": "100%",
              }}
            >
              <For each={plans()}>{(plan) => <option value={plan.planID}>{plan.planID}</option>}</For>
            </select>
          </Show>
          <span style={{ color: Faint, "white-space": "nowrap" }}>{active()?.createdAt}</span>
        </div>

        <Show when={current()}>
          {(view) => (
            <Show
              when={view().planID === active()?.planID}
              fallback={<p style={{ color: Muted, margin: "0" }}>只有最新批次的任务明细随看板下发</p>}
            >
              <div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
                <For each={Ledger.STATUSES}>
                  {(status) => (
                    <span
                      style={{
                        display: "inline-flex",
                        "align-items": "center",
                        gap: "4px",
                        color: view().counts[status] ? Muted : Faint,
                        "white-space": "nowrap",
                      }}
                    >
                      <i
                        style={{
                          width: "6px",
                          height: "6px",
                          "border-radius": "50%",
                          background: Tone[status],
                        }}
                      />
                      {status} {view().counts[status] ?? 0}
                    </span>
                  )}
                </For>
              </div>

              <div style={{ display: "flex", "flex-direction": "column" }}>
                <For each={rows()}>
                  {(task) => (
                    <div style={{ "border-top": `1px solid ${Border}`, padding: "6px 0" }}>
                      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                        <button
                          type="button"
                          onClick={() => toggle(task.id)}
                          style={{
                            display: "flex",
                            flex: "1",
                            "min-width": "0",
                            "align-items": "center",
                            gap: "8px",
                            padding: "0",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            color: task.anomaly ? Dangerous : "inherit",
                            "text-align": "left",
                            "font-size": "12px",
                          }}
                        >
                          <i
                            style={{
                              width: "8px",
                              height: "8px",
                              flex: "none",
                              "border-radius": "50%",
                              background: Tone[task.status],
                            }}
                          />
                          <span
                            style={{
                              flex: "1",
                              "min-width": "0",
                              overflow: "hidden",
                              "text-overflow": "ellipsis",
                              "white-space": "nowrap",
                            }}
                          >
                            {task.title}
                          </span>
                          <span style={{ color: Faint, "font-variant-numeric": "tabular-nums" }}>
                            {formatElapsed(task.elapsedMs)}
                          </span>
                        </button>
                        <Show when={task.sessionID}>
                          {(id) => (
                            <button
                              type="button"
                              onClick={() => props.openSession(id())}
                              style={{
                                flex: "none",
                                padding: "0",
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                color: "var(--v2-text-text-accent)",
                                "font-size": "12px",
                              }}
                            >
                              跳到该任务会话
                            </button>
                          )}
                        </Show>
                      </div>

                      <Show when={expanded().includes(task.id)}>
                        <div style={{ display: "grid", gap: "2px", "padding-left": "16px", color: Muted }}>
                          <Show when={task.anomaly}>
                            {(detail) => <p style={{ color: Dangerous, margin: "0" }}>{detail()}</p>}
                          </Show>
                          <span>分支：{task.branch ?? "—"}</span>
                          <span>提交：{task.commit ?? "—"}</span>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          )}
        </Show>
      </Show>
    </div>
  )
}

/**
 * The window half: a composer pill that opens the board, and the board's read-only side panel. Every window reports
 * its routed session, because the board main reads the ledger per window.
 */
const setup: Plugin.Setup = (ctx) => {
  const board = ctx.main(Board)
  const state = () => board.state()

  // The routed session is what the window's board shows; a switch, or a plugin reload, must report it again.
  createEffect(() => {
    const id = ctx.sessions.current()?.id
    if (!id) return
    void board.setSession(id).catch(() => undefined)
  })

  const tab: PanelTab = {
    id: "board",
    get title() {
      return "编排看板"
    },
  }
  // One object and one array for the panel's life: the host renders the tab from this identity.
  const tabs: readonly PanelTab[] = [tab]

  const panel: Panel = {
    id: "board",
    region: "side",
    width: 420,
    list: () => tabs,
    render: (input) => (
      <BoardView
        board={board}
        openSession={(sessionID) => ctx.tabs.open({ server: input.session.server.id, id: sessionID }, { focus: true })}
      />
    ),
  }

  // No batch means no board: the pill and the tab both leave rather than showing an empty destination.
  ctx.add(Panel, () => (state()?.plans.length ? panel : undefined))

  ctx.add(ComposerPill, {
    id: "board",
    show: (input) => {
      const data = state()
      if (!data || data.plans.length === 0) return undefined
      const count = data.current?.tasks.length ?? 0
      return {
        label: count === 0 ? "编排" : `编排 · ${count}`,
        run: () => ctx.layout.open(`${ctx.id}:${tab.id}`, input.session),
      }
    },
  })
}

export default Plugin.define({ main, setup })
