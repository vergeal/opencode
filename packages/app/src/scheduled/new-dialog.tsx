import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"

export type WhenMode = "cron" | "every" | "in" | "at"

export type NewTaskInput = {
  name?: string
  prompt: string
  directory: string
  when: { cron: string } | { every: string } | { in: string } | { at: string }
  /** Create always enables; `false` pauses the task right after it is saved. */
  enabled?: boolean
}

function whenInput(mode: WhenMode, value: string): NewTaskInput["when"] {
  switch (mode) {
    case "cron":
      return { cron: value }
    case "every":
      return { every: value }
    case "in":
      return { in: value }
    case "at":
      return { at: value }
  }
}

const MODES: ReadonlyArray<WhenMode> = ["cron", "every", "in", "at"]

const PLACEHOLDERS: Record<WhenMode, string> = {
  cron: "scheduled.create.value.cron",
  every: "scheduled.create.value.every",
  in: "scheduled.create.value.in",
  at: "scheduled.create.value.at",
}

const LABELS: Record<WhenMode, string> = {
  cron: "scheduled.create.when.cron",
  every: "scheduled.create.when.every",
  in: "scheduled.create.when.in",
  at: "scheduled.create.when.at",
}

export function NewScheduledTaskDialog(props: {
  directory: string
  onCreate: (input: NewTaskInput) => Promise<boolean>
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const [form, setForm] = createStore<{
    name: string
    prompt: string
    mode: WhenMode
    value: string
    directory: string
    submitting: boolean
    error: string | undefined
  }>({
    name: "",
    prompt: "",
    mode: "cron",
    value: "",
    directory: props.directory,
    submitting: false,
    error: undefined,
  })

  const valid = createMemo(() => form.prompt.trim() !== "" && form.value.trim() !== "" && form.directory.trim() !== "")

  const submit = async (enabled: boolean) => {
    if (!valid() || form.submitting) return

    setForm({ submitting: true, error: undefined })

    try {
      const created = await props.onCreate({
        name: form.name.trim() || undefined,
        prompt: form.prompt.trim(),
        directory: form.directory.trim(),
        when: whenInput(form.mode, form.value.trim()),
        enabled,
      })

      // Keep the form and its values when the request failed, so the user can fix and retry.
      if (created) {
        dialog.close()

        return
      }

      setForm("error", language.t("scheduled.create.failed"))
    } finally {
      setForm("submitting", false)
    }
  }

  return (
    <Dialog size="x-large" class="scheduled-create" containerClass="scheduled-create-container">
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("scheduled.create.title")} />
      </DialogHeader>

      <DialogBody>
        <div class="scheduled-create-body" data-scrollable>
          <label class="scheduled-create-field">
            <span class="scheduled-create-label">{language.t("scheduled.create.prompt")}</span>
            <Textarea
              rows={4}
              autofocus
              value={form.prompt}
              placeholder={language.t("scheduled.create.prompt.placeholder")}
              onInput={(event) => setForm("prompt", event.currentTarget.value)}
            />
          </label>

          <div class="scheduled-create-row">
            <label class="scheduled-create-field">
              <span class="scheduled-create-label">{language.t("scheduled.create.name")}</span>
              <TextInput
                appearance="base"
                value={form.name}
                placeholder={language.t("scheduled.create.name.placeholder")}
                onInput={(event) => setForm("name", event.currentTarget.value)}
              />
            </label>

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
          </div>

          <div class="scheduled-create-field">
            <span class="scheduled-create-label">{language.t("scheduled.create.when")}</span>
            <div class="scheduled-modes" role="group" aria-label={language.t("scheduled.create.when")}>
              <For each={MODES}>
                {(mode) => (
                  <button
                    type="button"
                    class="scheduled-chip"
                    data-selected={form.mode === mode ? "" : undefined}
                    aria-pressed={form.mode === mode}
                    onClick={() => {
                      setForm("mode", mode)
                      setForm("value", "")
                    }}
                  >
                    {language.t(LABELS[mode])}
                  </button>
                )}
              </For>
            </div>
            <TextInput
              appearance="base"
              value={form.value}
              placeholder={language.t(PLACEHOLDERS[form.mode])}
              onInput={(event) => setForm("value", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                void submit(true)
              }}
            />
          </div>

          <Show when={form.error}>
            {(message) => (
              <p class="scheduled-form-error" role="alert">
                {message()}
              </p>
            )}
          </Show>
        </div>
      </DialogBody>

      <DialogFooter>
        <p class="scheduled-create-foot-hint">{language.t("scheduled.create.footer.hint")}</p>
        <div class="scheduled-create-actions">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="neutral" disabled={!valid() || form.submitting} onClick={() => void submit(false)}>
            {language.t("scheduled.create.saveOnly")}
          </Button>
          <button
            type="button"
            class="scheduled-primary"
            disabled={!valid() || form.submitting}
            onClick={() => void submit(true)}
          >
            {language.t("scheduled.create.submit.enabled")}
          </button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
