import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { For, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"

export type WhenMode = "cron" | "every" | "in" | "at"

export type NewTaskInput = {
  name?: string
  prompt: string
  directory: string
  when: { cron: string } | { every: string } | { in: string } | { at: string }
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
  }>({
    name: "",
    prompt: "",
    mode: "cron",
    value: "",
    directory: props.directory,
    submitting: false,
  })

  const valid = createMemo(() => form.prompt.trim() !== "" && form.value.trim() !== "" && form.directory.trim() !== "")

  const submit = async () => {
    if (!valid() || form.submitting) return

    const value = form.value.trim()

    setForm("submitting", true)

    try {
      const created = await props.onCreate({
        name: form.name.trim() || undefined,
        prompt: form.prompt.trim(),
        directory: form.directory.trim(),
        when: whenInput(form.mode, value),
      })

      // Keep the form and its values when the request failed, so the user can fix and retry.
      if (created) dialog.close()
    } finally {
      setForm("submitting", false)
    }
  }

  return (
    <Dialog>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("scheduled.create.title")}
          description={language.t("scheduled.create.description")}
        />
      </DialogHeader>

      <DialogBody class="flex w-full min-w-0 flex-col gap-4">
        <label class="scheduled-field">
          <span>{language.t("scheduled.create.name")}</span>
          <TextInput
            autofocus
            value={form.name}
            placeholder={language.t("scheduled.create.name.placeholder")}
            onInput={(event) => setForm("name", event.currentTarget.value)}
          />
        </label>

        <label class="scheduled-field">
          <span>{language.t("scheduled.create.prompt")}</span>
          <Textarea
            rows={4}
            value={form.prompt}
            placeholder={language.t("scheduled.create.prompt.placeholder")}
            onInput={(event) => setForm("prompt", event.currentTarget.value)}
          />
        </label>

        <div class="scheduled-field">
          <span>{language.t("scheduled.create.when")}</span>
          <div class="scheduled-modes" role="group" aria-label={language.t("scheduled.create.when")}>
            <For each={MODES}>
              {(mode) => (
                <Button
                  size="small"
                  variant={form.mode === mode ? "contrast" : "neutral"}
                  aria-pressed={form.mode === mode}
                  onClick={() => {
                    setForm("mode", mode)
                    setForm("value", "")
                  }}
                >
                  {language.t(LABELS[mode])}
                </Button>
              )}
            </For>
          </div>
          <TextInput
            value={form.value}
            placeholder={language.t(PLACEHOLDERS[form.mode])}
            onInput={(event) => setForm("value", event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              void submit()
            }}
          />
        </div>

        <label class="scheduled-field">
          <span>{language.t("scheduled.create.directory")}</span>
          <TextInput
            value={form.directory}
            class="scheduled-mono"
            onInput={(event) => setForm("directory", event.currentTarget.value)}
          />
          <small>{language.t("scheduled.create.directory.hint")}</small>
        </label>
      </DialogBody>

      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="submit" disabled={!valid() || form.submitting} onClick={() => void submit()}>
          {language.t("scheduled.create.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
