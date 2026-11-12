import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { TextInput } from "@opencode/ui/text-input"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"

/**
 * One-step plugin installation. A catalog entry arrives with its package; a manual install asks for one field.
 * Submitting writes the package into the shared config, and the server installs and loads it from there.
 *
 * An `integrated` entry ships inside the app, so its config entry enables code that is already present: the dialog
 * says so instead of naming a package, and the success message reports the plugin as enabled.
 */
export function PluginInstallDialog(props: {
  package?: string
  name?: string
  integrated?: boolean
  onInstalled?: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const server = useServerSDK()
  const [state, setState] = createStore({ package: "", busy: false, error: "" })

  const target = () => (props.package ?? state.package).trim()

  const submit = async () => {
    if (state.busy) return
    if (!target()) return setState("error", language.t("explore.plugins.install.required"))

    setState({ busy: true, error: "" })

    try {
      await server.api.experimental.config.update({ plugins: [target()] })
      dialog.close()
      props.onInstalled?.()
      showToast({
        variant: "success",
        title: language.t(props.integrated ? "explore.plugins.enabled" : "explore.plugins.install.success", {
          name: props.name ?? target(),
        }),
      })
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <Dialog fit containerClass="explore-install-dialog">
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t(props.integrated ? "explore.plugins.enable.title" : "explore.plugins.install.title")}
          description={language.t(
            props.integrated ? "explore.plugins.enable.description" : "explore.plugins.install.description",
          )}
        />
      </DialogHeader>

      <DialogBody class="explore-install-body">
        <Show
          when={props.package}
          fallback={
            <label class="explore-field">
              <span class="explore-field-label">{language.t("explore.plugins.install.package")}</span>
              <TextInput
                autofocus
                appearance="large"
                value={state.package}
                placeholder={language.t("explore.plugins.install.package.placeholder")}
                aria-label={language.t("explore.plugins.install.package")}
                autocomplete="off"
                spellcheck={false}
                onInput={(event) => setState("package", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit()
                }}
              />
            </label>
          }
        >
          {(value) => (
            <div class="explore-install-target">
              <span class="explore-install-target-name">{props.name ?? value()}</span>
              <Show
                when={!props.integrated}
                fallback={
                  <span class="explore-install-target-package">
                    {language.t("explore.plugins.install.integrated")}
                  </span>
                }
              >
                <span class="explore-install-target-package" dir="ltr">
                  {value()}
                </span>
              </Show>
            </div>
          )}
        </Show>

        <p class="explore-install-text">
          {language.t(props.integrated ? "explore.plugins.enable.watching" : "explore.plugins.install.watching")}
        </p>

        <Show when={state.error}>
          {(message) => (
            <p class="explore-form-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </DialogBody>

      <DialogFooter>
        <Button variant="neutral" disabled={state.busy} onClick={() => dialog.close()}>
          {language.t("explore.plugins.install.cancel")}
        </Button>
        <Button variant="submit" disabled={state.busy} aria-busy={state.busy} onClick={() => void submit()}>
          {language.t(props.integrated ? "explore.plugins.enable.submit" : "explore.plugins.install.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
