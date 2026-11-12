import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { usePlatform } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"

const DEFAULT_PACKAGE = "opencode-plugin-example"

/**
 * Installing a plugin means changing the server's config or dropping a module in its plugin directory, which no
 * client API offers. This explains the supported ways instead of pretending the button installed something.
 */
export function PluginInstallDialog(props: { directory: string; package?: string }) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()

  // A catalog entry arrives as a package name, so the snippet it copies is the one the user needs.
  const snippet = () => `{\n  "plugin": ["${props.package ?? DEFAULT_PACKAGE}"]\n}`

  const copyConfig = async () => {
    try {
      await (platform.writeClipboardText?.(snippet()) ?? navigator.clipboard.writeText(snippet()))
      showToast({ variant: "success", title: language.t("explore.plugins.install.copiedConfig") })
    } catch {
      showToast({ variant: "error", title: language.t("explore.plugins.install.copyFailed") })
    }
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("explore.plugins.install.title")}
          description={language.t("explore.plugins.install.description")}
        />
      </DialogHeader>

      <DialogBody class="explore-install-body">
        <section class="explore-install-section">
          <div class="explore-install-heading">
            <Icon name="cube" class="explore-install-icon" />
            <h3>{language.t("explore.plugins.install.runtime.title")}</h3>
          </div>
          <p class="explore-install-text">{language.t("explore.plugins.install.runtime.description")}</p>
        </section>

        <section class="explore-install-section">
          <h3>{language.t("explore.plugins.install.npm.title")}</h3>
          <p class="explore-install-text">{language.t("explore.plugins.install.npm.description")}</p>
          <pre class="explore-install-code">
            <code>{snippet()}</code>
          </pre>
          <Button size="small" variant="ghost-muted" icon="copy" onClick={() => void copyConfig()}>
            {language.t("explore.plugins.install.copyConfig")}
          </Button>
        </section>

        <section class="explore-install-section">
          <h3>{language.t("explore.plugins.install.local.title")}</h3>
          <p class="explore-install-text">{language.t("explore.plugins.install.local.description")}</p>
          <ul class="explore-install-paths">
            <li>
              <code dir="ltr">{`${props.directory}/.opencode/plugin/`}</code>
            </li>
            <li>
              <code dir="ltr">{"~/.config/opencode/plugin/"}</code>
            </li>
          </ul>
        </section>

        <section class="explore-install-section" data-tone="warning">
          <div class="explore-install-heading">
            <Icon name="outline-hexagonal-warning" class="explore-install-icon" />
            <h3>{language.t("explore.plugins.install.python.title")}</h3>
          </div>
          <p class="explore-install-text">{language.t("explore.plugins.install.python.description")}</p>
        </section>

        <p class="explore-install-text explore-install-note">{language.t("explore.plugins.install.watch")}</p>
      </DialogBody>

      <DialogFooter>
        <ExternalLink class="explore-install-docs" href="https://opencode.ai/v2/docs/plugins">
          {language.t("explore.plugins.install.docs")}
        </ExternalLink>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {language.t("explore.plugins.install.close")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
