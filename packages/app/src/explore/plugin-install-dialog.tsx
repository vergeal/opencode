import { Button } from "@opencode/ui/button"
import { PluginIcon } from "@/explore/plugin-icon"
import type { CatalogPlugin } from "@/explore/catalog"
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
  /** A `.ocplugin` bundle: the host unpacks the file itself, so there is no package to write into the config. */
  bundle?: { file: string; format: "ocplugin" }
  /** Plugin id a bundle install targets. */
  id?: string
  /** The catalog entry a bundle install renders. */
  entry?: CatalogPlugin
  onInstalled?: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const server = useServerSDK()
  const [state, setState] = createStore({ package: "", busy: false, error: "" })

  if (props.bundle && props.entry)
    return <BundleInstallDialog entry={props.entry} onInstalled={props.onInstalled} />

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

/** One button: the server finds the bundle, verifies it and unpacks it. Nothing for the user to configure. */
function BundleInstallDialog(props: { entry: CatalogPlugin; onInstalled?: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const server = useServerSDK()
  const [state, setState] = createStore({ busy: false, error: "" })

  const submit = async () => {
    if (state.busy) return
    setState({ busy: true, error: "" })
    try {
      await server.api.experimental.plugin.bundle({ id: props.entry.id })
      dialog.close()
      props.onInstalled?.()
      showToast({
        variant: "success",
        title: language.t("explore.plugins.bundle.success", { name: props.entry.name }),
      })
    } catch (error) {
      // Keep the user-facing copy short; the detail belongs in the console for a bug report.
      console.error("plugin install failed", error)
      setState({ busy: false, error: language.t("explore.plugins.bundle.failed") })
    }
  }

  const skills = () => props.entry.skills?.map((skill) => skill.name).join("、") ?? ""

  return (
    <Dialog fit containerClass="explore-install-dialog">
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("explore.plugins.install.title")} />
      </DialogHeader>

      <DialogBody class="explore-install-body">
        <div class="explore-install-head">
          <span class="explore-install-head-icon">
            <PluginIcon />
          </span>
          <div class="explore-install-head-text">
            <span class="explore-install-target-name">{props.entry.name}</span>
            <span class="explore-install-target-package">
              {props.entry.version ? `v${props.entry.version}` : props.entry.id}
            </span>
          </div>
        </div>

        <p class="explore-install-text">{props.entry.description}</p>

        <dl class="explore-install-facts">
          <Show when={props.entry.version}>
            {(version) => (
              <div>
                <dt>{language.t("explore.plugins.facts.version")}</dt>
                <dd>{version()}</dd>
              </div>
            )}
          </Show>
          <Show when={props.entry.tools?.length}>
            <div>
              <dt>{language.t("explore.plugins.facts.tools")}</dt>
              <dd dir="ltr">{props.entry.tools?.join("、")}</dd>
            </div>
          </Show>
          <Show when={skills()}>
            {(names) => (
              <div>
                <dt>{language.t("explore.plugins.facts.skills")}</dt>
                <dd>{names()}</dd>
              </div>
            )}
          </Show>
        </dl>

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
          {language.t(state.busy ? "explore.plugins.bundle.installing" : "explore.plugins.bundle.install")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
