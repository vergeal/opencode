import { Button } from "@opencode/ui/button"
import { Loader } from "@opencode/ui/loader"
import { For, Match, Show, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { PagePanel } from "@/shell/page"
import { useScheduled } from "./context"
import { describeOutcome, describeStatus, describeWhen, formatTime, taskName } from "./describe"
import { outputPreview, promptOf, toneOf } from "./model"
import "./scheduled.css"

/**
 * The scheduled-task workspace: the navigation column lists the tasks, so this surface is the open task, its
 * stats and its execution log.
 */
export function ScheduledScreen() {
  const language = useLanguage()
  const scheduled = useScheduled()

  return (
    <PagePanel class="scheduled-page">
      <div data-ui="workspace-content" class="flex min-h-0 flex-1 flex-col">
        <section class="scheduled-detail" data-scrollable>
          <Show when={scheduled.error()}>
            {(message) => (
              <div class="scheduled-error" role="alert">
                <span class="scheduled-error-message">
                  {language.t("scheduled.error.title")} · {message()}
                </span>
                <Button size="small" variant="neutral" onClick={() => void scheduled.load()}>
                  {language.t("scheduled.retry")}
                </Button>
              </div>
            )}
          </Show>

          <Show
            when={scheduled.current()}
            fallback={
              <Show
                when={scheduled.state().status === "loading"}
                fallback={
                  <div class="scheduled-placeholder">
                    <p class="scheduled-placeholder-title">{language.t("scheduled.detail.select.title")}</p>
                    <p class="scheduled-placeholder-description">
                      {language.t("scheduled.detail.select.description")}
                    </p>
                  </div>
                }
              >
                <div class="scheduled-placeholder">
                  <Loader />
                </div>
              </Show>
            }
          >
            {(task) => (
              <>
                <div class="scheduled-detail-head">
                  <div class="scheduled-detail-heading">
                    <div class="scheduled-detail-title-row">
                      <h2>{taskName(task(), language)}</h2>
                      <span class="scheduled-badge" data-tone={task().status === "active" ? "success" : "neutral"}>
                        {describeStatus(task().status, language)}
                      </span>
                      <Show when={task().lastOutcome === "failed"}>
                        <span class="scheduled-badge" data-tone="danger">
                          {describeOutcome("failed", language)}
                        </span>
                      </Show>
                    </div>
                    <p class="scheduled-detail-sub">
                      {describeWhen(task(), language)}
                      <span class="scheduled-sep" />
                      {task().tz}
                      <Show when={scheduled.projectOf(task())}>
                        {(project) => (
                          <>
                            <span class="scheduled-sep" />
                            {project()}
                          </>
                        )}
                      </Show>
                    </p>
                  </div>
                  <div class="scheduled-detail-actions">
                    <Show when={task().status !== "done"}>
                      <Button
                        size="small"
                        variant="neutral"
                        disabled={scheduled.busy() === task().id}
                        onClick={() => void scheduled.setStatus(task(), task().status === "paused" ? "resume" : "pause")}
                      >
                        {language.t(task().status === "paused" ? "scheduled.detail.resume" : "scheduled.detail.pause")}
                      </Button>
                    </Show>
                    <Button
                      size="small"
                      variant="ghost-danger"
                      icon="outline-trash"
                      disabled={scheduled.busy() === task().id}
                      onClick={() => void scheduled.confirmRemove(task())}
                    >
                      {language.t("scheduled.detail.delete")}
                    </Button>
                  </div>
                </div>

                <div class="scheduled-stats">
                  <div class="scheduled-stat">
                    <div class="scheduled-stat-key">{language.t("scheduled.detail.next")}</div>
                    <div class="scheduled-stat-value">{formatTime(task().nextDueAt)}</div>
                  </div>
                  <div class="scheduled-stat">
                    <div class="scheduled-stat-key">{language.t("scheduled.detail.directory")}</div>
                    <div class="scheduled-stat-value scheduled-stat-path">{scheduled.projectOf(task()) ?? "—"}</div>
                  </div>
                  <div class="scheduled-stat">
                    <div class="scheduled-stat-key">{language.t("scheduled.detail.runs")}</div>
                    <div class="scheduled-stat-value">{task().runCount}</div>
                  </div>
                  <div class="scheduled-stat">
                    <div class="scheduled-stat-key">{language.t("scheduled.detail.last")}</div>
                    <div class="scheduled-stat-value scheduled-stat-path">
                      {task().lastOutcome ? describeOutcome(task().lastOutcome, language) : "—"}
                    </div>
                  </div>
                </div>

                <div class="scheduled-section">
                  <span class="scheduled-section-label">{language.t("scheduled.detail.recent")}</span>
                  <Show
                    when={task().lastFiredAt}
                    fallback={
                      <div class="scheduled-run">
                        <span class="scheduled-run-out">{language.t("scheduled.detail.recent.empty")}</span>
                      </div>
                    }
                  >
                    {(firedAt) => (
                      <div class="scheduled-run">
                        <span class="scheduled-dot" data-status={task().status} data-outcome={task().lastOutcome} />
                        <span class="scheduled-run-when">{formatTime(firedAt())}</span>
                        <span class="scheduled-run-out">
                          {outputPreview(task()) ??
                            (task().lastOutcome ? describeOutcome(task().lastOutcome, language) : "—")}
                        </span>
                        <span class="scheduled-run-right">
                          <Show when={task().lastOutcome}>
                            {(outcome) => (
                              <span class="scheduled-badge" data-tone={toneOf(task())}>
                                {describeOutcome(outcome(), language)}
                              </span>
                            )}
                          </Show>
                        </span>
                      </div>
                    )}
                  </Show>
                </div>

                <div class="scheduled-section">
                  <span class="scheduled-section-label">{language.t("scheduled.detail.prompt")}</span>
                  <pre class="scheduled-prompt">{promptOf(task())}</pre>
                </div>

                <div class="scheduled-section">
                  <span class="scheduled-section-label">{language.t("scheduled.detail.logs")}</span>
                  <Switch>
                    <Match when={scheduled.logs().status === "loading"}>
                      <p class="scheduled-log-status" role="status">
                        <Loader class="size-3.5" />
                        {language.t("scheduled.detail.logs.loading")}
                      </p>
                    </Match>
                    <Match when={scheduled.logs().status === "failed"}>
                      <div class="scheduled-log-status">
                        <span>{language.t("scheduled.detail.logs.failed")}</span>
                        <Button
                          size="small"
                          variant="neutral"
                          onClick={() => {
                            const value = scheduled.current()

                            if (value) void scheduled.loadLogs(value)
                          }}
                        >
                          {language.t("scheduled.retry")}
                        </Button>
                      </div>
                    </Match>
                    <Match when={scheduled.logs().status === "ready"}>
                      <Show
                        when={scheduled.logEntries()?.length}
                        fallback={<p class="scheduled-log-status">{language.t("scheduled.detail.logs.empty")}</p>}
                      >
                        <div class="scheduled-logs">
                          <For each={scheduled.logEntries()}>
                            {(entry) => (
                              <article class="scheduled-log">
                                <time class="scheduled-log-time">{formatTime(entry.at)}</time>
                                <pre class="scheduled-log-text">{entry.text}</pre>
                              </article>
                            )}
                          </For>
                        </div>
                      </Show>
                    </Match>
                  </Switch>
                </div>

                <Show when={task().lastOutput?.trim()}>
                  {(output) => (
                    <div class="scheduled-section">
                      <span class="scheduled-section-label">{language.t("scheduled.detail.output")}</span>
                      <pre class="scheduled-output">{output()}</pre>
                    </div>
                  )}
                </Show>
              </>
            )}
          </Show>
        </section>
      </div>
    </PagePanel>
  )
}
