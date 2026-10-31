import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { createSignal } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"

/** Names a new knowledge base and records what it is for before the workspace creates it. */
export function NewLibraryDialog(props: { onCreate: (name: string, description: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const [name, setName] = createSignal("")
  const [description, setDescription] = createSignal("")

  const create = () => {
    const value = name().trim()
    if (!value) return
    // Close first, so the caller can reveal the new library without stacking dialogs.
    dialog.close()
    props.onCreate(value, description().trim())
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("knowledge.new")} description={language.t("knowledge.new.description")} />
      </DialogHeader>
      <DialogBody class="flex w-full min-w-0 flex-col gap-3 px-4">
        <TextInput
          autofocus
          class="knowledge-name-field"
          value={name()}
          placeholder={language.t("knowledge.name.placeholder")}
          aria-label={language.t("knowledge.name.placeholder")}
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            create()
          }}
        />
        <Textarea
          class="knowledge-description-field"
          rows={3}
          value={description()}
          placeholder={language.t("knowledge.new.about.placeholder")}
          aria-label={language.t("knowledge.new.about.placeholder")}
          onInput={(event) => setDescription(event.currentTarget.value)}
        />
        <p class="text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-faint">
          {language.t("knowledge.new.about.hint")}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" disabled={!name().trim()} onClick={create}>
          {language.t("knowledge.create")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
