import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"

export type NewTaskInput = {
  name?: string
  prompt: string
  directory: string
  /** Create always enables; `false` pauses the task right after it is saved. */
  enabled?: boolean
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
    directory: string
    submitting: boolean
  }>({
    name: "",
    prompt: "",
    directory: props.directory,
    submitting: false,
  })

  const valid = createMemo(() => form.prompt.trim() !== "" && form.directory.trim() !== "")

  const submit = async (enabled: boolean) => {
    if (!valid() || form.submitting) return

    setForm("submitting", true)

    try {
      const created = await props.onCreate({
        name: form.name.trim() || undefined,
        prompt: form.prompt.trim(),
        directory: form.directory.trim(),
        enabled,
      })

      // Keep the form and its values when the request failed, so the user can fix and retry.
      if (created) dialog.close()
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
            <small class="scheduled-create-hint">{language.t("scheduled.create.prompt.hint")}</small>
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

          <Show when={form.submitting}>
            <p class="scheduled-create-status" role="status">
              <Loader class="size-3.5" />
              {language.t("scheduled.create.parsing")}
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
