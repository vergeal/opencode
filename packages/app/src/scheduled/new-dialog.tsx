import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { type Schedule } from "@opencode/schema/schedule"
import { getFilename } from "@opencode/util/path"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { type ScheduleDraft, localTimeZone } from "./cron"
import {
  DEFAULT_RECURRENCE,
  type Recurrence,
  clockOf,
  isValidCron,
  nextRun,
  recurrenceOfCron,
  timeOf,
  whenOf,
} from "./recurrence"

export type PermissionScope = "default" | "read-only"

export type ProjectOption = {
  directory: string
  name: string
}

export type NewTaskInput = {
  name?: string
  prompt: string
  directory: string
  permissions?: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }>
  /** The schedule the visible controls already describe, so creating never reads the prompt again. */
  when: Schedule.WhenInput
}

type Inference =
  | { status: "idle" }
  | { status: "parsing"; prompt: string }
  | { status: "ready"; prompt: string; schedule: ScheduleDraft }
  | { status: "failed"; prompt: string }

/** Short prompts cannot describe a time yet, so the dialog waits before asking the model. */
const MIN_PROMPT = 4

const DEBOUNCE = 700

/** Read-only keeps every read open and closes the two actions that can change the project or run commands. */
const READ_ONLY_PERMISSIONS = [
  { action: "edit", resource: "*", effect: "deny" as const },
  { action: "shell", resource: "*", effect: "deny" as const },
]

const FREQUENCY_OPTIONS = [
  { kind: "hourly", label: "scheduled.create.frequency.hourly" },
  { kind: "daily", label: "scheduled.create.frequency.daily" },
  { kind: "weekly", label: "scheduled.create.frequency.weekly" },
  { kind: "monthly", label: "scheduled.create.frequency.monthly" },
  { kind: "cron", label: "scheduled.create.frequency.custom" },
] as const

/** ISO weekdays, Monday first; `Intl` renders the label in the interface language. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

export function NewScheduledTaskDialog(props: {
  projects: ReadonlyArray<ProjectOption>
  directory?: string
  onCreate: (input: NewTaskInput) => Promise<boolean>
  onInfer: (prompt: string) => Promise<ScheduleDraft | undefined>
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const [form, setForm] = createStore<{
    name: string
    nameTouched: boolean
    prompt: string
    directory: string
    permission: PermissionScope
    recurrence: Recurrence
    recurrenceTouched: boolean
    tz: string
    submitting: boolean
  }>({
    name: "",
    nameTouched: false,
    prompt: "",
    directory: props.directory ?? props.projects[0]?.directory ?? "",
    permission: "default",
    recurrence: { ...DEFAULT_RECURRENCE },
    recurrenceTouched: false,
    tz: localTimeZone(),
    submitting: false,
  })

  const [inference, setInference] = createSignal<Inference>({ status: "idle" })

  /** The parsing state only applies to the text currently in the field. */
  const detected = () => {
    const current = inference()

    return current.status === "ready" && current.prompt === form.prompt.trim() ? current.schedule : undefined
  }

  const infer = async (prompt: string) => {
    setInference({ status: "parsing", prompt })

    const result = await props.onInfer(prompt)

    // A result for a prompt the user already changed must not replace the newer state.
    if (form.prompt.trim() !== prompt) return result

    if (!result) {
      setInference({ status: "failed", prompt })

      return result
    }

    const recurrence = recurrenceOfCron(result.cron)

    // A generated cron stays out of the controls when the form could not run it either.
    if (recurrence.kind === "cron" && !isValidCron(recurrence.cron)) {
      setInference({ status: "failed", prompt })

      return result
    }

    // A recurrence the user already shaped by hand is theirs: the model only fills what is still untouched.
    if (!form.recurrenceTouched) setForm("recurrence", recurrence)
    if (!form.nameTouched) setForm("name", titleOf(form.prompt) ?? "")

    const zone = readTimeZone(result.timezone)

    if (zone) setForm("tz", zone)

    setInference({ status: "ready", prompt, schedule: result })

    return result
  }

  createEffect(
    on(
      () => form.prompt,
      (value) => {
        const prompt = value.trim()

        if (prompt.length < MIN_PROMPT) {
          setInference({ status: "idle" })

          return
        }

        const timer = setTimeout(() => void infer(prompt), DEBOUNCE)

        onCleanup(() => clearTimeout(timer))
      },
      { defer: true },
    ),
  )

  // The name follows the first line until the user edits it, so a task is never left unnamed.
  createEffect(() => {
    if (form.nameTouched) return

    setForm("name", titleOf(form.prompt) ?? "")
  })

  const weekly = () => (form.recurrence.kind === "weekly" ? form.recurrence : undefined)
  const custom = () => (form.recurrence.kind === "cron" ? form.recurrence : undefined)

  const clock = () => timeOf(form.recurrence) ?? "09:00"

  const setTime = (time: string) => {
    if (!/^\d{2}:\d{2}$/.test(time)) return

    const current = form.recurrence

    switch (current.kind) {
      case "daily":
        return setForm("recurrence", { kind: "daily", time })
      case "weekly":
        return setForm("recurrence", { kind: "weekly", days: current.days, time })
      case "monthly":
        return setForm("recurrence", { kind: "monthly", day: current.day, time })
    }
  }

  const chooseKind = (kind: Recurrence["kind"]) => {
    setForm("recurrenceTouched", true)

    const time = clock()

    switch (kind) {
      case "hourly":
        return setForm("recurrence", {
          kind: "hourly",
          hours: form.recurrence.kind === "hourly" ? form.recurrence.hours : 1,
        })
      case "daily":
        return setForm("recurrence", { kind: "daily", time })
      case "weekly":
        return setForm("recurrence", {
          kind: "weekly",
          days: weekly()?.days ?? [1],
          time,
        })
      case "monthly":
        return setForm("recurrence", {
          kind: "monthly",
          day: form.recurrence.kind === "monthly" ? form.recurrence.day : 1,
          time,
        })
      case "cron":
        return setForm("recurrence", {
          kind: "cron",
          cron: custom()?.cron ?? `${clockOf(time).minute} ${clockOf(time).hour} * * *`,
        })
    }
  }

  const setHours = (value: number) => {
    if (!Number.isFinite(value)) return

    setForm("recurrenceTouched", true)
    setForm("recurrence", { kind: "hourly", hours: Math.min(24, Math.max(1, Math.round(value))) })
  }

  const setMonthDay = (value: number) => {
    if (!Number.isFinite(value)) return

    setForm("recurrenceTouched", true)
    setForm("recurrence", { kind: "monthly", day: Math.min(31, Math.max(1, Math.round(value))), time: clock() })
  }

  const toggleDay = (day: number) => {
    const current = weekly()

    if (!current) return

    const days = current.days.includes(day)
      ? current.days.filter((value) => value !== day)
      : [...current.days, day].sort((left, right) => left - right)

    // A weekly task always repeats on at least one day; removing the last one leaves it in place.
    if (days.length === 0) return

    setForm("recurrenceTouched", true)
    setForm("recurrence", { kind: "weekly", days, time: current.time })
  }

  const setCron = (cron: string) => {
    setForm("recurrenceTouched", true)
    setForm("recurrence", { kind: "cron", cron })
  }

  const validCron = () => form.recurrence.kind !== "cron" || isValidCron(form.recurrence.cron)

  const valid = () => form.prompt.trim().length >= MIN_PROMPT && form.directory.trim() !== "" && validCron()

  const submit = async () => {
    if (!valid() || form.submitting) return

    setForm("submitting", true)

    try {
      const created = await props.onCreate({
        name: form.name.trim() || titleOf(form.prompt),
        prompt: form.prompt.trim(),
        directory: form.directory.trim(),
        permissions: form.permission === "read-only" ? READ_ONLY_PERMISSIONS : undefined,
        when: whenOf(form.recurrence, form.tz),
      })

      // Keep the form and its values when the request failed, so the user can fix and retry.
      if (created) dialog.close()
    } finally {
      setForm("submitting", false)
    }
  }

  const projectName = () => {
    const directory = form.directory.trim()

    if (!directory) return undefined

    return props.projects.find((project) => project.directory === directory)?.name ?? getFilename(directory)
  }

  const describeRecurrence = (recurrence: Recurrence) => {
    switch (recurrence.kind) {
      case "hourly":
        return language.plural("scheduled.create.frequency.everyHours", recurrence.hours)
      case "daily":
        return language.t("scheduled.create.frequency.everyDay", { time: recurrence.time })
      case "weekly":
        return language.t("scheduled.create.frequency.everyWeek", {
          days: listFormat().format(recurrence.days.map(weekdayLabel)),
          time: recurrence.time,
        })
      case "monthly":
        return language.t("scheduled.create.frequency.everyMonth", {
          day: recurrence.day,
          time: recurrence.time,
        })
      case "cron":
        return language.t("scheduled.create.frequency.cron", { cron: recurrence.cron })
    }
  }

  const weekdayFormat = createMemo(() => new Intl.DateTimeFormat(language.intl(), { weekday: "short" }))
  const weekdayLabel = (day: number) => weekdayFormat().format(new Date(2024, 0, day))

  const listFormat = createMemo(() => new Intl.ListFormat(language.intl(), { style: "long", type: "conjunction" }))

  const nextFormat = createMemo(
    () =>
      new Intl.DateTimeFormat(language.intl(), {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
  )

  const nextLabel = createMemo(() => {
    const date = nextRun(form.recurrence, new Date())

    return date ? nextFormat().format(date) : undefined
  })

  return (
    <Dialog size="x-large" class="scheduled-create" containerClass="scheduled-create-container">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("scheduled.create.title")}
          description={language.t("scheduled.create.description")}
        />
      </DialogHeader>

      <DialogBody>
        <div class="scheduled-create-layout">
          <div class="scheduled-create-form" data-scrollable>
            <label class="scheduled-field">
              <span class="scheduled-field-label">{language.t("scheduled.create.name.label")}</span>
              <TextInput
                appearance="base"
                value={form.name}
                placeholder={language.t("scheduled.create.name.placeholder")}
                onInput={(event) => {
                  setForm("nameTouched", true)
                  setForm("name", event.currentTarget.value)
                }}
              />
              <small class="scheduled-field-hint">{language.t("scheduled.create.name.hint")}</small>
            </label>

            <label class="scheduled-field">
              <span class="scheduled-field-label">{language.t("scheduled.create.prompt.label")}</span>
              <Textarea
                rows={5}
                autofocus
                value={form.prompt}
                placeholder={language.t("scheduled.create.prompt.placeholder")}
                onInput={(event) => setForm("prompt", event.currentTarget.value)}
              />
            </label>

            <Switch>
              <Match when={inference().status === "parsing"}>
                <p class="scheduled-create-status" role="status">
                  <Loader class="size-3.5" />
                  {language.t("scheduled.create.parsing")}
                </p>
              </Match>
              <Match when={detected() && !form.recurrenceTouched}>
                <p class="scheduled-create-status" data-tone="success" role="status">
                  <Icon name="check" size="small" />
                  {language.t("scheduled.create.infer.ready")}
                </p>
              </Match>
              <Match when={inference().status === "failed"}>
                <p class="scheduled-create-status" role="status">
                  {language.t("scheduled.create.infer.failed")}
                </p>
              </Match>
            </Switch>

            <div class="scheduled-field">
              <span class="scheduled-field-label">{language.t("scheduled.create.schedule.label")}</span>
              <div
                class="scheduled-frequency"
                role="radiogroup"
                aria-label={language.t("scheduled.create.schedule.label")}
              >
                <For each={FREQUENCY_OPTIONS}>
                  {(option) => (
                    <button
                      type="button"
                      class="scheduled-frequency-option"
                      role="radio"
                      aria-checked={form.recurrence.kind === option.kind}
                      data-selected={form.recurrence.kind === option.kind ? "" : undefined}
                      onClick={() => chooseKind(option.kind)}
                    >
                      {language.t(option.label)}
                    </button>
                  )}
                </For>
              </div>

              <div class="scheduled-schedule-detail">
                <Show when={form.recurrence.kind === "hourly" && form.recurrence}>
                  {(recurrence) => (
                    <>
                      <label class="scheduled-inline-field">
                        <span>{language.t("scheduled.create.hours.label")}</span>
                        <TextInput
                          type="number"
                          numeric
                          min={1}
                          max={24}
                          value={recurrence().hours}
                          class="scheduled-number"
                          onInput={(event) => setHours(event.currentTarget.valueAsNumber)}
                        />
                        <span>{language.t("scheduled.create.hours.suffix")}</span>
                      </label>
                      <small class="scheduled-field-hint">{language.t("scheduled.create.hours.hint")}</small>
                    </>
                  )}
                </Show>

                <Show when={form.recurrence.kind === "daily"}>
                  <label class="scheduled-inline-field">
                    <span>{language.t("scheduled.create.time.label")}</span>
                    <TextInput
                      type="time"
                      value={clock()}
                      class="scheduled-time"
                      onInput={(event) => setTime(event.currentTarget.value)}
                    />
                  </label>
                </Show>

                <Show when={weekly()}>
                  {(recurrence) => (
                    <>
                      <div
                        class="scheduled-weekdays"
                        role="group"
                        aria-label={language.t("scheduled.create.days.label")}
                      >
                        <For each={WEEKDAYS}>
                          {(day) => (
                            <button
                              type="button"
                              class="scheduled-weekday"
                              aria-pressed={recurrence().days.includes(day)}
                              data-selected={recurrence().days.includes(day) ? "" : undefined}
                              onClick={() => toggleDay(day)}
                            >
                              {weekdayLabel(day)}
                            </button>
                          )}
                        </For>
                      </div>
                      <label class="scheduled-inline-field">
                        <span>{language.t("scheduled.create.time.label")}</span>
                        <TextInput
                          type="time"
                          value={recurrence().time}
                          class="scheduled-time"
                          onInput={(event) => setTime(event.currentTarget.value)}
                        />
                      </label>
                    </>
                  )}
                </Show>

                <Show when={form.recurrence.kind === "monthly" && form.recurrence}>
                  {(recurrence) => (
                    <>
                      <label class="scheduled-inline-field">
                        <span>{language.t("scheduled.create.dayOfMonth.label")}</span>
                        <TextInput
                          type="number"
                          numeric
                          min={1}
                          max={31}
                          value={recurrence().day}
                          class="scheduled-number"
                          onInput={(event) => setMonthDay(event.currentTarget.valueAsNumber)}
                        />
                      </label>
                      <label class="scheduled-inline-field">
                        <span>{language.t("scheduled.create.time.label")}</span>
                        <TextInput
                          type="time"
                          value={recurrence().time}
                          class="scheduled-time"
                          onInput={(event) => setTime(event.currentTarget.value)}
                        />
                      </label>
                    </>
                  )}
                </Show>

                <Show when={custom()}>
                  {(recurrence) => (
                    <>
                      <label class="scheduled-field">
                        <span class="scheduled-field-label">{language.t("scheduled.create.cron.label")}</span>
                        <TextInput
                          appearance="base"
                          class="scheduled-mono"
                          value={recurrence().cron}
                          invalid={!isValidCron(recurrence().cron)}
                          onInput={(event) => setCron(event.currentTarget.value)}
                        />
                      </label>
                      <small
                        class="scheduled-field-hint"
                        data-tone={isValidCron(recurrence().cron) ? undefined : "danger"}
                      >
                        {isValidCron(recurrence().cron)
                          ? language.t("scheduled.create.cron.hint")
                          : language.t("scheduled.create.cron.invalid")}
                      </small>
                    </>
                  )}
                </Show>
              </div>

              <small class="scheduled-field-hint">{language.t("scheduled.create.schedule.hint")}</small>
            </div>

            <div class="scheduled-field">
              <span class="scheduled-field-label">{language.t("scheduled.create.project.label")}</span>
              <Show
                when={props.projects.length > 0}
                fallback={
                  <TextInput
                    appearance="base"
                    class="scheduled-mono"
                    value={form.directory}
                    placeholder={language.t("scheduled.create.project.placeholder")}
                    onInput={(event) => setForm("directory", event.currentTarget.value)}
                  />
                }
              >
                <div
                  class="scheduled-project-list"
                  role="radiogroup"
                  aria-label={language.t("scheduled.create.project.label")}
                >
                  <For each={props.projects}>
                    {(project) => (
                      <button
                        type="button"
                        class="scheduled-project"
                        role="radio"
                        aria-checked={form.directory === project.directory}
                        data-selected={form.directory === project.directory ? "" : undefined}
                        onClick={() => setForm("directory", project.directory)}
                      >
                        <span class="scheduled-project-icon">
                          <Icon name="folder" size="small" />
                        </span>
                        <span class="scheduled-project-body">
                          <span class="scheduled-project-name">{project.name}</span>
                          <span class="scheduled-project-path">{project.directory}</span>
                        </span>
                        <Show when={form.directory === project.directory}>
                          <Icon name="check" size="small" class="scheduled-project-check" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <small class="scheduled-field-hint">{language.t("scheduled.create.project.hint")}</small>
            </div>

            <div class="scheduled-field">
              <span class="scheduled-field-label">{language.t("scheduled.create.permission.label")}</span>
              <div
                class="scheduled-permission-list"
                role="radiogroup"
                aria-label={language.t("scheduled.create.permission.label")}
              >
                <For
                  each={
                    [
                      {
                        scope: "default",
                        title: "scheduled.create.permission.default",
                        note: "scheduled.create.permission.default.description",
                      },
                      {
                        scope: "read-only",
                        title: "scheduled.create.permission.readonly",
                        note: "scheduled.create.permission.readonly.description",
                      },
                    ] as const
                  }
                >
                  {(option) => (
                    <button
                      type="button"
                      class="scheduled-permission"
                      role="radio"
                      aria-checked={form.permission === option.scope}
                      data-selected={form.permission === option.scope ? "" : undefined}
                      onClick={() => setForm("permission", option.scope)}
                    >
                      <span class="scheduled-permission-radio" aria-hidden="true" />
                      <span class="scheduled-permission-body">
                        <span class="scheduled-permission-title">{language.t(option.title)}</span>
                        <span class="scheduled-permission-note">{language.t(option.note)}</span>
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>

          <aside class="scheduled-preview" aria-label={language.t("scheduled.create.preview.label")}>
            <div class="scheduled-preview-head">
              <span class="scheduled-preview-title">{language.t("scheduled.create.preview.label")}</span>
              <span class="scheduled-preview-badge">{language.t("scheduled.create.preview.paused")}</span>
            </div>

            <dl class="scheduled-preview-list">
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.name")}</dt>
                <dd>{form.name.trim() || titleOf(form.prompt) || language.t("scheduled.create.preview.untitled")}</dd>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.runs")}</dt>
                <dd data-empty={validCron() ? undefined : ""}>
                  {validCron() ? describeRecurrence(form.recurrence) : language.t("scheduled.create.preview.empty")}
                </dd>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.next")}</dt>
                <dd data-empty={nextLabel() ? undefined : ""}>
                  {nextLabel() ?? language.t("scheduled.create.preview.empty")}
                </dd>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.zone")}</dt>
                <dd>{form.tz}</dd>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.project")}</dt>
                <dd data-empty={projectName() ? undefined : ""}>
                  {projectName() ?? language.t("scheduled.create.preview.empty")}
                </dd>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.permission")}</dt>
                <dd>
                  {language.t(
                    form.permission === "read-only"
                      ? "scheduled.create.permission.readonly"
                      : "scheduled.create.permission.default",
                  )}
                </dd>
              </div>
            </dl>

            <div class="scheduled-preview-prompt">
              <span class="scheduled-preview-title">{language.t("scheduled.create.preview.prompt")}</span>
              <p data-empty={form.prompt.trim() ? undefined : ""}>
                {form.prompt.trim() || language.t("scheduled.create.preview.empty")}
              </p>
            </div>

            <p class="scheduled-preview-note">{language.t("scheduled.create.footer.hint")}</p>
          </aside>
        </div>
      </DialogBody>

      <DialogFooter>
        <div class="scheduled-create-actions">
          <Button variant="neutral" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="contrast" disabled={!valid() || form.submitting} onClick={() => void submit()}>
            {language.t("scheduled.create.submit")}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}

function titleOf(prompt: string) {
  const line = prompt
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean)

  return line ? line.slice(0, 60) : undefined
}

/** The model replies with an IANA zone; anything else falls back to the zone already shown. */
function readTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value })

    return value
  } catch {
    return undefined
  }
}
