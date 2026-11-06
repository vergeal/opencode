import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { getFilename } from "@opencode/util/path"
import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { localTimeZone } from "./cron"
import { DEFAULT_RECURRENCE, type Recurrence, isValidCron, nextRun } from "./recurrence"

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
  /** The cadence the user picked; the exact time is read from the prompt when the task is saved. */
  recurrence: Recurrence
  tz: string
}

/** Short prompts cannot describe a time yet. */
const MIN_PROMPT = 4

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

export function NewScheduledTaskDialog(props: {
  projects: ReadonlyArray<ProjectOption>
  directory?: string
  onCreate: (input: NewTaskInput) => Promise<boolean>
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const [form, setForm] = createStore<{
    /** The dialog asks for the task first, then for where it runs. */
    step: 1 | 2
    name: string
    nameTouched: boolean
    prompt: string
    directory: string
    permission: PermissionScope
    recurrence: Recurrence
    tz: string
    submitting: boolean
  }>({
    step: 1,
    name: "",
    nameTouched: false,
    prompt: "",
    directory: props.directory ?? props.projects[0]?.directory ?? "",
    permission: "default",
    recurrence: { ...DEFAULT_RECURRENCE },
    tz: localTimeZone(),
    submitting: false,
  })

  let formEl: HTMLDivElement | undefined

  // Each step starts at the top; otherwise the second step opens where the first one was scrolled to.
  const goToStep = (step: 1 | 2) => {
    setForm("step", step)
    formEl?.scrollTo({ top: 0 })
  }

  // The name follows the first line until the user edits it, so a task is never left unnamed.
  createEffect(() => {
    if (form.nameTouched) return

    setForm("name", titleOf(form.prompt) ?? "")
  })

  const custom = () => (form.recurrence.kind === "cron" ? form.recurrence : undefined)

  const chooseKind = (kind: Recurrence["kind"]) => {
    switch (kind) {
      case "hourly":
        return setForm("recurrence", { kind: "hourly", hours: 1 })
      case "daily":
        return setForm("recurrence", { kind: "daily", time: "09:00" })
      case "weekly":
        return setForm("recurrence", { kind: "weekly", days: [1], time: "09:00" })
      case "monthly":
        return setForm("recurrence", { kind: "monthly", day: 1, time: "09:00" })
      case "cron":
        return setForm("recurrence", { kind: "cron", cron: "0 9 * * *" })
    }
  }

  const setCron = (cron: string) => setForm("recurrence", { kind: "cron", cron })

  const validCron = () => form.recurrence.kind !== "cron" || isValidCron(form.recurrence.cron)

  const validTask = () => form.prompt.trim().length >= MIN_PROMPT && validCron()

  const valid = () => validTask() && form.directory.trim() !== ""

  const submit = async () => {
    if (!valid() || form.submitting) return

    setForm("submitting", true)

    try {
      const created = await props.onCreate({
        name: form.name.trim() || titleOf(form.prompt),
        prompt: form.prompt.trim(),
        directory: form.directory.trim(),
        permissions: form.permission === "read-only" ? READ_ONLY_PERMISSIONS : undefined,
        recurrence: form.recurrence,
        tz: form.tz,
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

  const describeCadence = (recurrence: Recurrence) => {
    switch (recurrence.kind) {
      case "hourly":
        return language.t("scheduled.create.frequency.hourly")
      case "daily":
        return language.t("scheduled.create.frequency.daily")
      case "weekly":
        return language.t("scheduled.create.frequency.weekly")
      case "monthly":
        return language.t("scheduled.create.frequency.monthly")
      case "cron":
        return language.t("scheduled.create.frequency.cron", { cron: recurrence.cron })
    }
  }

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
    const recurrence = form.recurrence

    if (recurrence.kind !== "cron") return undefined

    const date = nextRun(recurrence, new Date())

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
          <div class="scheduled-create-form" data-scrollable ref={(el) => (formEl = el)}>
            <ol class="scheduled-steps">
              <li class="scheduled-step" data-state={form.step === 1 ? "current" : "done"}>
                <span class="scheduled-step-index">1</span>
                {language.t("scheduled.create.step.task")}
              </li>
              <li class="scheduled-step" data-state={form.step === 2 ? "current" : undefined}>
                <span class="scheduled-step-index">2</span>
                {language.t("scheduled.create.step.project")}
              </li>
            </ol>

            <Show when={form.step === 1}>
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

                <Show when={custom()}>
                  {(recurrence) => (
                    <div class="scheduled-schedule-detail">
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
                    </div>
                  )}
                </Show>

                <small class="scheduled-field-hint">{language.t("scheduled.create.schedule.hint")}</small>
              </div>
            </Show>

            <Show when={form.step === 2}>
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
            </Show>
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
                  {validCron() ? describeCadence(form.recurrence) : language.t("scheduled.create.preview.empty")}
                </dd>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.next")}</dt>
                <Show
                  when={form.recurrence.kind === "cron"}
                  fallback={<dd>{language.t("scheduled.create.preview.pending")}</dd>}
                >
                  <dd data-empty={nextLabel() ? undefined : ""}>
                    {nextLabel() ?? language.t("scheduled.create.preview.empty")}
                  </dd>
                </Show>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.zone")}</dt>
                <dd>{form.tz}</dd>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.project")}</dt>
                <Show
                  when={form.step === 2}
                  fallback={<dd data-empty="">{language.t("scheduled.create.preview.next-step")}</dd>}
                >
                  <dd data-empty={projectName() ? undefined : ""}>
                    {projectName() ?? language.t("scheduled.create.preview.empty")}
                  </dd>
                </Show>
              </div>
              <div class="scheduled-preview-row">
                <dt>{language.t("scheduled.create.preview.permission")}</dt>
                <Show
                  when={form.step === 2}
                  fallback={<dd data-empty="">{language.t("scheduled.create.preview.next-step")}</dd>}
                >
                  <dd>
                    {language.t(
                      form.permission === "read-only"
                        ? "scheduled.create.permission.readonly"
                        : "scheduled.create.permission.default",
                    )}
                  </dd>
                </Show>
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
        <Show when={form.submitting}>
          <p class="scheduled-create-status" role="status">
            <Loader class="size-3.5" />
            {language.t("scheduled.create.saving")}
          </p>
        </Show>
        <div class="scheduled-create-actions">
          <Show
            when={form.step === 2}
            fallback={
              <>
                <Button variant="neutral" onClick={() => dialog.close()}>
                  {language.t("common.cancel")}
                </Button>
                <Button variant="contrast" disabled={!validTask()} onClick={() => goToStep(2)}>
                  {language.t("scheduled.create.next")}
                </Button>
              </>
            }
          >
            <Button variant="neutral" disabled={form.submitting} onClick={() => goToStep(1)}>
              {language.t("scheduled.create.back")}
            </Button>
            <Button variant="contrast" disabled={!valid() || form.submitting} onClick={() => void submit()}>
              {language.t("scheduled.create.submit")}
            </Button>
          </Show>
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
