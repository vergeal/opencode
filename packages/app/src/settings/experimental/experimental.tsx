import { Component } from "solid-js"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { useSettings } from "@/settings/model"
import { SettingsRow } from "@/settings/row"
import { SettingsPageHeader } from "@/settings/page-header"
import "@/settings/settings.css"

export const experimentalSettingsAvailable = true

export const SettingsExperimental: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <>
      <SettingsPageHeader
        title={language.t("settings.tab.experimental")}
        description={language.t("settings.experimental.description")}
      />

      <div class="settings-tab-body">
        <div class="settings-section">
          <SettingsList>
            <SettingsRow
              title={language.t("settings.experimental.row.newIcons.title")}
              description={language.t("settings.experimental.row.newIcons.description")}
            >
              <div data-action="settings-new-icons">
                <Switch
                  checked={settings.general.newIcons()}
                  onChange={(checked) => settings.general.setNewIcons(checked)}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.experimental.row.newModelPicker.title")}
              description={language.t("settings.experimental.row.newModelPicker.description")}
            >
              <div data-action="settings-new-model-picker">
                <Switch
                  checked={settings.general.newModelPicker()}
                  onChange={(checked) => settings.general.setNewModelPicker(checked)}
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </>
  )
}
