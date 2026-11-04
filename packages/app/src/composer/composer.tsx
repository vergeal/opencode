import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { createMediaQuery } from "@solid-primitives/media"
import { Button } from "@opencode/ui/button"
import { Popover } from "@opencode/ui/popover"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { Slash } from "@opencode/ui/slash"
import { Tooltip } from "@opencode/ui/tooltip"
import { ComposerEditor } from "./editor/editor"
import type { ComposerSelectControl } from "./editor/interaction"
import { ComposerVariantSlider } from "./editor/variant-slider"
import { DialogSelectModel, ModelSelectorDrawer } from "@/providers/models/select-dialog"
import { DialogSelectModelNext, ModelSelectorDrawerNext } from "@/providers/models/select-dialog-next"
import { useSettings } from "@/settings/model"
import { DialogSelectModelUnpaid } from "@/providers/models/unpaid"
import { formatKeybind, useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import type { ComposerModel } from "./model"

export function Composer(props: {
  class?: string
  model: ComposerModel
  borderUnderlay?: boolean
  readOnly?: boolean
  suggestionBoundary?: () => HTMLElement | undefined
}) {
  const dialog = useDialog()
  const command = useCommand()
  const language = useLanguage()

  const modelName = () => {
    const preview = props.model.model.preview

    if (preview) return preview.model
    const selection = props.model.model.selection
    const model = selection.current()

    if (model) return model.name
    const key = selection.key()

    if (key) return language.t("dialog.model.unavailable", { model: key.modelID })

    return language.t("dialog.model.select.title")
  }

  return (
    <div class="flex flex-col gap-3">
      <ComposerEditor
        controller={props.model}
        borderUnderlay={props.borderUnderlay}
        readOnly={props.readOnly}
        class={props.class}
        modelControlsVisible={!props.model.model.loading || !!props.model.model.preview}
        attachKeybind={command.keybindParts("file.attach")}
        attachShortcut={command.keybind("file.attach")}
        alternateKeybind={[formatKeybind("mod", language.t), "↵"]}
        exitShellKeybind={[formatKeybind("esc", language.t)]}
        suggestionBoundary={props.suggestionBoundary}
        modelControl={(variant) => (
          <ComposerModelControl
            loading={props.model.model.loading}
            preview={!!props.model.model.preview}
            paid={props.model.model.paid}
            title={language.t("command.model.choose")}
            variantTitle={language.t("ui.promptInput.chooseVariant")}
            keybind={command.keybindParts("model.choose")}
            model={props.model.model.selection}
            providerName={props.model.model.preview?.provider ?? props.model.model.providerName}
            modelName={modelName()}
            variant={variant}
            onClose={props.model.restoreFocus}
            onUnpaidClick={() => dialog.show(() => <DialogSelectModelUnpaid model={props.model.model.selection} />)}
          />
        )}
      />
    </div>
  )
}

function ComposerModelControl(props: {
  loading: boolean
  preview: boolean
  paid: boolean
  title: string
  variantTitle: string
  keybind: string[]
  model: ComposerModel["model"]["selection"]
  providerName?: string
  modelName: string
  variant?: ComposerSelectControl
  onClose: () => void
  onUnpaidClick: () => void
}) {
  // A preview paints the chip in its resting state, and the loaded names replace it in place.
  const shouldAnimate = createMemo<boolean>((previous) => previous ?? (props.loading && !props.preview))
  const mobile = createMediaQuery("(max-width: 767px)")
  const dialog = useDialog()
  const settings = useSettings()

  const open = (detail: number) => {
    if (!props.paid) return props.onUnpaidClick()
    const Picker = settings.general.newModelPicker() ? DialogSelectModelNext : DialogSelectModel
    // A pointer open keeps focus in the composer, so the dialog returns it to the caret. A keyboard open
    // (a click with no pointer presses) returns focus to this trigger instead of moving it to the editor.
    void dialog.show(() => <Picker model={props.model} />, detail === 0 ? undefined : props.onClose)
  }

  // A previewed chip is visible before the catalog loads, so a click on it opens the dialog once loading finishes.
  const [deferred, setDeferred] = createSignal<number>()
  const [store, setStore] = createStore({ open: false })
  const hasVariant = () => !!props.variant && props.variant.options().length > 1
  const variantLabel = () => {
    const control = props.variant

    if (!control || !hasVariant()) return
    const option = control.options().find((item) => item.id === control.current())

    return option?.label ?? control.current()
  }

  createEffect(() => {
    const detail = deferred()

    if (props.loading || detail === undefined) return
    setDeferred(undefined)
    open(detail)
  })

  const content = () => (
    <>
      <span class="flex min-w-0 whitespace-nowrap leading-4">
        <Show when={props.providerName}>
          {(name) => (
            <>
              <span class="shrink-0 text-v2-text-text-faint">{name()}</span>
              <Slash />
              <span class="sr-only">{" / "}</span>
            </>
          )}
        </Show>
        <span class="truncate">{props.modelName}</span>
      </span>
      <span class="-ml-0.5 -mr-1 flex shrink-0">
        <Icon name="chevron-down" />
      </span>
    </>
  )

  return (
    <Show when={!props.loading || props.preview}>
      <Tooltip
        inactive={mobile()}
        placement="top"
        value={
          <>
            {props.title}
            <Keybind keys={props.keybind} variant="neutral" />
          </>
        }
      >
        {/* While loading, the drawer would open on a catalog that isn't there yet, so the inert chip stands in. */}
        <Show
          when={mobile() && !props.loading}
          fallback={
            <Popover
              open={store.open}
              onOpenChange={(next) => {
                // A preview opens the dialog once the catalog loads, and a model without effort
                // options keeps the old one-click dialog instead of a card with a single row.
                if (next && (props.loading || !hasVariant())) return setDeferred(1)
                setStore("open", next)
              }}
              placement="top-start"
              gutter={6}
              triggerAs={Button}
              trigger={content()}
              triggerProps={{
                class: `me-1.5 min-w-0 max-w-[38cqw] justify-start ![font-weight: 400] ${
                  shouldAnimate() ? "animate-in fade-in" : ""
                }`,
                style: { height: "24px" },
                variant: "ghost-muted",
                size: "normal",
                "data-action": "composer-model",
                "data-control-type": "popover",
                "aria-label": props.title,
                onMouseDown: (event: MouseEvent) => event.preventDefault(),
              }}
            >
              <div class="flex w-[264px] flex-col gap-3 p-3">
                <Show when={hasVariant()}>
                  <span class="text-center text-[13px] font-[530] capitalize leading-5 text-v2-text-text-accent">
                    {variantLabel()}
                  </span>
                </Show>
                <button
                  type="button"
                  data-slot="composer-model-row"
                  class="flex h-7 w-full items-center justify-between gap-2 rounded-[6px] px-1.5 text-start text-[13px] leading-5 transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                  onClick={() => {
                    setStore("open", false)
                    open(1)
                  }}
                >
                  <span class="flex min-w-0 items-center">
                    <Show when={props.providerName}>
                      {(name) => (
                        <>
                          <span class="shrink-0 text-v2-text-text-faint">{name()}</span>
                          <Slash />
                        </>
                      )}
                    </Show>
                    <span class="truncate text-v2-text-text-base">{props.modelName}</span>
                  </span>
                  <Icon name="chevron-right" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                </button>
                <Show when={hasVariant() && props.variant}>
                  {(control) => <ComposerVariantSlider control={control()} label={props.variantTitle} />}
                </Show>
              </div>
            </Popover>
          }
        >
          <Dynamic
            component={settings.general.newModelPicker() ? ModelSelectorDrawerNext : ModelSelectorDrawer}
            model={props.model}
            trigger={(triggerProps) => (
              <Button
                {...triggerProps}
                variant="ghost-muted"
                size="normal"
                style={{ height: "24px" }}
                class="me-1.5 min-w-0 max-w-[38cqw] justify-start ![font-weight: 400]"
                classList={{ "animate-in fade-in": shouldAnimate() }}
                data-action="composer-model"
                data-control-type="drawer"
              >
                {content()}
              </Button>
            )}
            onClose={props.onClose}
          />
        </Show>
      </Tooltip>
    </Show>
  )
}
