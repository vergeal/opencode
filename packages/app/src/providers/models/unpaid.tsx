import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@aicraft/ui/dialog"
import { Button } from "@aicraft/ui/button"
import { Icon } from "@aicraft/ui/icon"
import { Loader } from "@aicraft/ui/loader"
import { SelectionIndicator } from "@aicraft/ui/selection-indicator"
import { ProviderModelIcon } from "@/providers/models/provider-group"
import { useDialog } from "@aicraft/ui/context/dialog"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from "solid-js"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { providerRank } from "@/providers/catalog/order"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useSettingsDialog } from "@/settings/command"
import { decode64 } from "@/runtime/persistence/base64"
import { useLanguage } from "@/runtime/i18n/language"
import "@/providers/models/unpaid.css"

type ModelState = ModelSelection

/**
 * The picker for a workspace that has no model yet, so its only job is the next step: connect an account.
 *
 * Two claims the previous layout made are false for this client, and both are gone. It headed a block "free models
 * provided by AI Craft" over a list that can never fill it: a free model here requires `provider.id === "opencode"`
 * with a zero input cost (`models.tsx` `isFreeModel`), and this build ships no such tier, so the section was its own
 * heading above nothing. It then listed providers from a grid hardcoded beside it — `opencode`, `opencode-go`,
 * Anthropic, Google, Copilot, but not DeepSeek — under a line promising "70+ more providers".
 *
 * The rows now come from the server's own integration list, with the pinned order in `catalog/order.ts` deciding which
 * ones lead; every reported provider is listed, and a custom provider keeps its own add row.
 *
 * Copy follows design 16 §4: name the next step, never a number or a tier the product cannot back.
 */
export const DialogSelectModelUnpaid: Component<{ model?: ModelState }> = (props) => {
  const local = useLocal()
  const model = props.model ?? local.model
  const dialog = useDialog()
  const directory = () => decode64(local.slug())
  const integrations = useIntegrations(directory)
  const language = useLanguage()
  // Creating a custom provider belongs to Settings, which owns the form, the credential store and the ids already
  // taken; the sheet links there instead of carrying a second copy of that plumbing.
  const openSettings = useSettingsDialog("providers")

  // Pinned providers in their own order, then every remaining provider by name. Nothing is filtered: a provider the
  // server reports is always reachable from here.
  const providers = createMemo(() =>
    integrations.list().toSorted((a, b) => {
      const byRank = providerRank(a.id) - providerRank(b.id)

      // Two unpinned providers share `MAX_SAFE_INTEGER`, so the names decide; two pinned ones use their rank.
      return byRank === 0 ? a.name.localeCompare(b.name) : byRank
    }),
  )

  // Design 11 §7 shows nothing at all under 150ms, so a catalog that resolves in one frame never flashes an
  // indicator. `pending` is that first band; `loading` is the reserved box the indicator sits in.
  const [late, setLate] = createSignal(false)

  createEffect(() => {
    if (integrations.ready()) return
    const timer = setTimeout(() => setLate(true), 150)

    onCleanup(() => clearTimeout(timer))
  })

  const view = createMemo<"pending" | "loading" | "providers" | "none">(() => {
    if (!integrations.ready()) return late() ? "loading" : "pending"

    return providers().length > 0 ? "providers" : "none"
  })

  const openProviders = (provider?: string) => {
    void import("@/providers/connect/dialog").then((x) => {
      const controller = x.useProviderConnectController()
      controller.select(provider)
      void dialog.show(() => (
        <x.DialogConnectProvider controller={controller} directory={directory()} selection={model} />
      ))
    })
  }

  const addProvider = () => {
    dialog.close()
    openSettings()
  }

  // Design 13 §10 and checklist H: one sliding block marks the row the keys are on, and the rows themselves stay
  // transparent. These rows carry no stored selection, so the block follows focus, which is what the arrow keys move.
  const [active, setActive] = createSignal<string>()

  // Design 17 §2 gives ↑ ↓ to lists. The rows are ordinary buttons, so Tab and Enter already work; focus starts on
  // the sheet itself, which is why the listener sits on the document while this dialog is mounted. The container is a
  // signal so the sliding block starts measuring the moment the list exists, not one frame earlier.
  const [listEl, setListEl] = createSignal<HTMLDivElement>()

  onMount(() => {
    const move = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return

      if (view() !== "providers") return

      const rows = Array.from(
        listEl()?.querySelectorAll<HTMLButtonElement>("[data-slot='provider-row'], [data-slot='provider-add']") ?? [],
      )

      if (rows.length === 0) return
      const index = rows.findIndex((row) => row === document.activeElement)

      const step = event.key === "ArrowDown" ? 1 : -1
      const next = index < 0 ? (step > 0 ? 0 : rows.length - 1) : index + step

      rows[(next + rows.length) % rows.length]?.focus()
      event.preventDefault()
    }

    document.addEventListener("keydown", move)
    onCleanup(() => document.removeEventListener("keydown", move))
  })

  const groupLabelID = "model-picker-accounts-label"

  return (
    <Dialog size="normal" fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("dialog.model.select.title")}
          description={language.t("dialog.model.unpaid.description")}
        />
      </DialogHeader>
      <DialogBody class="model-picker-empty">
        <Show when={view() !== "none"}>
          <section data-slot="provider-group" aria-labelledby={groupLabelID}>
            <div data-slot="provider-group-label" id={groupLabelID}>
              {language.t("dialog.provider.accounts.add")}
            </div>
            <div
              data-slot="provider-list"
              ref={setListEl}
              onFocusOut={(event) => {
                // The block marks the row the keys are on, so it leaves when the keys do. A window blur reports no
                // Node, which also means focus left the list.
                const next = event.relatedTarget

                if (!(next instanceof Node) || !event.currentTarget.contains(next)) setActive(undefined)
              }}
            >
              <SelectionIndicator container={() => listEl()} selector="[data-active]" attribute="data-active" />
              <For each={providers()}>
                {(provider) => (
                  <button
                    type="button"
                    data-slot="provider-row"
                    data-active={active() === `provider:${provider.id}` ? "" : undefined}
                    onFocus={() => setActive(`provider:${provider.id}`)}
                    onClick={() => openProviders(provider.id)}
                  >
                    <ProviderModelIcon provider={{ id: provider.id, name: provider.name }} class="shrink-0" />
                    <span data-slot="provider-row-name">{provider.name}</span>
                    <Icon name="chevron-right" data-slot="provider-row-arrow" aria-hidden="true" />
                  </button>
                )}
              </For>
              {/*
                The indicator stands in for the rows that have not arrived, so it sits where they will, above the
                action row: a spinner after the last row reads as one more item in the list rather than as its
                placeholder.
              */}
              <Show when={view() === "loading"}>
                <div data-slot="provider-row-placeholder">
                  <Loader width={16} height={16} />
                </div>
              </Show>
              {/*
                Design 01 §3.2: this client reaches any other model through a custom provider, so the sheet offers
                that route rather than the false promise the removed "70+ providers" line made.
              */}
              <button
                type="button"
                data-slot="provider-add"
                data-active={active() === "add" ? "" : undefined}
                onFocus={() => setActive("add")}
                onClick={addProvider}
              >
                <Icon name="plus" data-slot="provider-add-icon" aria-hidden="true" />
                <span data-slot="provider-add-name">{language.t("settings.providers.custom.add")}</span>
              </button>
            </div>
          </section>
        </Show>

        {/* Design 11 §6 and 09 §16: a mark, one line of what happened, why, and the single action that leaves it. */}
        <Show when={view() === "none"}>
          <div data-slot="model-picker-none">
            <Icon name="plus" data-slot="model-picker-none-icon" aria-hidden="true" />
            <div data-slot="model-picker-none-title">{language.t("dialog.model.unpaid.empty.title")}</div>
            <div data-slot="model-picker-none-description">{language.t("dialog.model.unpaid.empty.description")}</div>
            <Button variant="contrast" onClick={addProvider}>
              {language.t("settings.providers.custom.add")}
            </Button>
          </div>
        </Show>
      </DialogBody>
    </Dialog>
  )
}
