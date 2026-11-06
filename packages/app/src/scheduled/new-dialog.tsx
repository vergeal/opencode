import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { getFilename } from "@opencode/util/path"
import { Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { ScheduleDraft } from "./cron"

export type NewTaskInput = {
  prompt: string
  directory: string
  /** Create always enables; `false` pauses the task right after it is saved. */
  enabled?: boolean
  /** The schedule the dialog already read from the prompt, so creating does not generate twice. */
  schedule?: ScheduleDraft
}

type Inference =
  | { status: "idle" }
  | { status: "parsing"; prompt: string }
  | { status: "ready"; prompt: string; schedule: ScheduleDraft }
  | { status: "failed"; prompt: string }

/** Short prompts cannot describe a time yet, so the dialog waits before asking the model. */
const MIN_PROMPT = 4

const DEBOUNCE = 700

export function NewScheduledTaskDialog(props: {
  directory: string
  onCreate: (input: NewTaskInput) => Promise<boolean>
  onInfer: (prompt: string) => Promise<ScheduleDraft | undefined>
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const [form, setForm] = createStore<{
    prompt: string
    directory: string
    submitting: boolean
  }>({
    prompt: "",
    directory: props.directory,
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

  const submit = async (enabled: boolean) => {
    if (!valid() || form.submitting) return

    setForm("submitting", true)

    try {
      const draft = schedule() ?? (await infer(form.prompt.trim()))

      if (!draft) return

      const created = await props.onCreate({
        prompt: form.prompt.trim(),
        directory: form.directory.trim(),
        enabled,
        schedule: draft,
      })

      // Keep the form and its values when the request failed, so the user can fix and retry.
      if (created) dialog.close()
    } finally {
      setForm("submitting", false)
    }
  }

  const project = () => (form.directory.trim() ? getFilename(form.directory) : undefined)

  const busy = () => form.submitting || inference().status === "parsing"

  return (
    <Dialog size="x-large" class="scheduled-create" containerClass="scheduled-create-container">
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("scheduled.create.title")} />
      </DialogHeader>

      <DialogBody>
        <div class="scheduled-create-body" data-scrollable>
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
                <Show when={project()}>
                  {(name) => (
                    <span class="scheduled-pchip">
                      {language.t("scheduled.create.parsed.project")} <b>{name()}</b>
                    </span>
                  )}
                </Show>
              </div>
            )}
          </Show>

          <Show when={!props.directory}>
            <label class="scheduled-create-field">
              <span class="scheduled-create-label">{language.t("scheduled.create.directory")}</span>
              <TextInput
                appearance="base"
                class="scheduled-mono"
                value={form.directory}
                onInput={(event) => setForm("directory", event.currentTarget.value)}
              />
              <small class="scheduled-create-hint">{language.t("scheduled.create.directory.hint")}</small>
            </label>
          </Show>

          <Show when={inference().status === "parsing" || form.submitting}>
            <p class="scheduled-create-status" role="status">
              <Loader class="size-3.5" />
              {language.t("scheduled.create.parsing")}
            </p>
          </Show>

          <Show when={inference().status === "failed" && !form.submitting}>
            <p class="scheduled-create-status" data-tone="danger" role="alert">
              {language.t("scheduled.create.parseFailed.description")}
            </p>
          </Show>
        </div>
      </DialogBody>

      <DialogFooter>
        <p class="scheduled-create-foot-hint">{language.t("scheduled.create.footer.hint")}</p>
        <div class="scheduled-create-actions">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="neutral" disabled={!valid() || busy()} onClick={() => void submit(false)}>
            {language.t("scheduled.create.saveOnly")}
          </Button>
          <button
            type="button"
            class="scheduled-primary"
            disabled={!valid() || busy()}
            onClick={() => void submit(true)}
          >
            {language.t("scheduled.create.submit.enabled")}
          </button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
