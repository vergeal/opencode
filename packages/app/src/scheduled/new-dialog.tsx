import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { getFilename } from "@opencode/util/path"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { ScheduleDraft } from "./cron"

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
  /** The schedule the dialog already read from the prompt, so creating does not generate twice. */
  schedule?: ScheduleDraft
}

type Inference =
  | { status: "idle" }
  | { status: "parsing"; prompt: string }
  | { status: "ready"; prompt: string; schedule: ScheduleDraft }
  | { status: "failed"; prompt: string }

type Step = 1 | 2 | 3

/** Short prompts cannot describe a time yet, so the dialog waits before asking the model. */
const MIN_PROMPT = 4

const DEBOUNCE = 700

/** Read-only keeps every read open and closes the two actions that can change the project or run commands. */
const READ_ONLY_PERMISSIONS = [
  { action: "edit", resource: "*", effect: "deny" as const },
  { action: "shell", resource: "*", effect: "deny" as const },
]

export function NewScheduledTaskDialog(props: {
  projects: ReadonlyArray<ProjectOption>
  directory?: string
  onCreate: (input: NewTaskInput) => Promise<boolean>
  onInfer: (prompt: string) => Promise<ScheduleDraft | undefined>
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const [form, setForm] = createStore<{
    step: Step
    prompt: string
    directory: string
    permission: PermissionScope
    submitting: boolean
  }>({
    step: 1,
    prompt: "",
    directory: props.directory ?? props.projects[0]?.directory ?? "",
    permission: "default",
    submitting: false,
  })

  const [inference, setInference] = createSignal<Inference>({ status: "idle" })

  const valid = createMemo(() => form.prompt.trim().length >= MIN_PROMPT && form.directory.trim() !== "")

  /** The parsing state only applies to the text currently in the field. */
  const schedule = () => {
    const current = inference()

    return current.status === "ready" && current.prompt === form.prompt.trim() ? current.schedule : undefined
  }

  const infer = async (prompt: string) => {
    setInference({ status: "parsing", prompt })

    const result = await props.onInfer(prompt)

    // A result for a prompt the user already changed must not replace the newer state.
    if (form.prompt.trim() !== prompt) return result

    setInference(result ? { status: "ready", prompt, schedule: result } : { status: "failed", prompt })

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

  const submit = async () => {
    if (!valid() || form.submitting) return

    setForm("submitting", true)

    try {
      const draft = schedule() ?? (await infer(form.prompt.trim()))

      if (!draft) {
        setForm({ step: 1, submitting: false })

        return
      }

      const created = await props.onCreate({
        name: titleOf(form.prompt),
        prompt: form.prompt.trim(),
        directory: form.directory.trim(),
        permissions: form.permission === "read-only" ? READ_ONLY_PERMISSIONS : undefined,
        schedule: draft,
      })

      // Keep the form and its values when the request failed, so the user can fix and retry.
      if (created) dialog.close()
    } finally {
      setForm("submitting", false)
    }
  }

  const busy = () => form.submitting || inference().status === "parsing"

  const canNext = () => (form.step === 1 ? form.prompt.trim().length >= MIN_PROMPT : form.directory.trim() !== "")

  const next = () => {
    if (!canNext()) return

    setForm("step", Math.min(3, form.step + 1) as Step)
  }

  const back = () => setForm("step", Math.max(1, form.step - 1) as Step)

  const stepLabel = () => {
    switch (form.step) {
      case 1:
        return language.t("scheduled.create.step.what")
      case 2:
        return language.t("scheduled.create.step.project")
      case 3:
        return language.t("scheduled.create.step.permission")
    }
  }

  const projectName = () => {
    const directory = form.directory.trim()

    if (!directory) return "—"

    return props.projects.find((project) => project.directory === directory)?.name ?? getFilename(directory)
  }

  return (
    <Dialog size="x-large" class="scheduled-create" containerClass="scheduled-create-container">
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("scheduled.create.title")} />
        <ol class="scheduled-steps" aria-label={stepLabel()}>
          <For each={[1, 2, 3] as const}>
            {(step) => (
              <li
                class="scheduled-step"
                data-state={step === form.step ? "current" : step < form.step ? "done" : "upcoming"}
                aria-current={step === form.step ? "step" : undefined}
              >
                <span class="scheduled-step-index">
                  <Show when={step < form.step} fallback={step}>
                    <Icon name="check" size="small" />
                  </Show>
                </span>
                {language.t(stepKey(step))}
              </li>
            )}
          </For>
        </ol>
      </DialogHeader>

      <DialogBody>
        <div class="scheduled-create-body" data-scrollable>
          <Switch>
            <Match when={form.step === 1}>
              <label class="scheduled-create-field">
                <span class="scheduled-create-label">{language.t("scheduled.create.prompt.label")}</span>
                <Textarea
                  rows={3}
                  autofocus
                  value={form.prompt}
                  placeholder={language.t("scheduled.create.prompt.placeholder")}
                  onInput={(event) => setForm("prompt", event.currentTarget.value)}
                />
              </label>

              <Show when={schedule()}>
                {(draft) => (
                  <div class="scheduled-parsed">
                    <Show when={draft().frequency}>
                      {(frequency) => (
                        <span class="scheduled-pchip">
                          {language.t("scheduled.create.parsed.frequency")} <b>{frequency()}</b>
                        </span>
                      )}
                    </Show>
                    <Show when={draft().time}>
                      {(time) => (
                        <span class="scheduled-pchip">
                          {language.t("scheduled.create.parsed.time")} <b>{time()}</b>
                        </span>
                      )}
                    </Show>
                    <span class="scheduled-pchip">
                      {language.t("scheduled.create.parsed.timezone")} <b>{draft().timezone}</b>
                    </span>
                  </div>
                )}
              </Show>

              <Show when={inference().status === "parsing"}>
                <p class="scheduled-create-status" role="status">
                  <Loader class="size-3.5" />
                  {language.t("scheduled.create.parsing")}
                </p>
              </Show>

              <Show when={inference().status === "failed"}>
                <p class="scheduled-create-status" data-tone="danger" role="alert">
                  {language.t("scheduled.create.parseFailed.description")}
                </p>
              </Show>
            </Match>

            <Match when={form.step === 2}>
              <div class="scheduled-create-field">
                <span class="scheduled-create-label">{language.t("scheduled.create.project.label")}</span>
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
                <small class="scheduled-create-hint">{language.t("scheduled.create.project.hint")}</small>
              </div>
            </Match>

            <Match when={form.step === 3}>
              <div class="scheduled-create-field">
                <span class="scheduled-create-label">{language.t("scheduled.create.permission.label")}</span>
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

              <div class="scheduled-summary">
                <div class="scheduled-summary-row">
                  <span>{language.t("scheduled.create.parsed.project")}</span>
                  <b>{projectName()}</b>
                </div>
                <Show when={schedule()}>
                  {(draft) => (
                    <div class="scheduled-summary-row">
                      <span>{language.t("scheduled.create.parsed.frequency")}</span>
                      <b>{draft().frequency || draft().time || draft().cron}</b>
                    </div>
                  )}
                </Show>
              </div>
            </Match>
          </Switch>
        </div>
      </DialogBody>

      <DialogFooter>
        <p class="scheduled-create-foot-hint">
          {form.step === 3
            ? language.t("scheduled.create.footer.hint")
            : language.t("scheduled.create.footer.step", { current: form.step, total: 3 })}
        </p>
        <div class="scheduled-create-actions">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Show when={form.step > 1}>
            <Button variant="neutral" disabled={form.submitting} onClick={back}>
              {language.t("scheduled.create.back")}
            </Button>
          </Show>
          <Show when={form.step < 3}>
            <button type="button" class="scheduled-primary" disabled={!canNext() || busy()} onClick={() => void next()}>
              {language.t("scheduled.create.next")}
            </button>
          </Show>
          <Show when={form.step === 3}>
            <button type="button" class="scheduled-primary" disabled={!valid() || busy()} onClick={() => void submit()}>
              {language.t("scheduled.create.submit")}
            </button>
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

function stepKey(step: Step) {
  return step === 1
    ? "scheduled.create.step.what"
    : step === 2
      ? "scheduled.create.step.project"
      : "scheduled.create.step.permission"
}
