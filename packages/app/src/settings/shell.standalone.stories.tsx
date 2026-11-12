import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router"
import { DialogStoryRuntime } from "@/components-lab/dialog-story-runtime"
import { SettingsScreen } from "@/settings/shell"
import { SettingsSurfaceProvider, type SettingsRootTab } from "@/settings/surface"
import { LayoutProvider } from "@/shell/state/layout"

function SettingsStory(props: { tab: SettingsRootTab; fonts?: readonly string[] }) {
  const history = createMemoryHistory()
  history.set({ value: `/settings?tab=${props.tab}`, replace: true, scroll: false })

  return (
    <DialogStoryRuntime fonts={props.fonts}>
      <div class="h-full min-h-[640px] w-full overflow-hidden bg-v2-background-bg-base">
        <MemoryRouter
          history={history}
          root={(rootProps) => (
            <LayoutProvider>
              <SettingsSurfaceProvider>{rootProps.children}</SettingsSurfaceProvider>
            </LayoutProvider>
          )}
        >
          <Route path="*all" component={SettingsScreen} />
        </MemoryRouter>
      </div>
    </DialogStoryRuntime>
  )
}

export default {
  title: "App/Dialogs/Settings",
  id: "app-dialog-settings",
  parameters: {
    layout: "fullscreen",
  },
}

export const Preferences = {
  render: () => <SettingsStory tab="general" />,
}

export const Providers = {
  render: () => <SettingsStory tab="providers" />,
}

export const Models = {
  render: () => <SettingsStory tab="models" />,
}

// A desktop install enumerates these; the story keeps them stable so the picker's filtering and ordering are
// inspectable without depending on the machine's fonts.
const storyFonts = ["Inter", "IBM Plex Mono", "JetBrainsMono Nerd Font Mono", "Menlo", "Arial", "Georgia"]

export const Appearance = {
  render: () => <SettingsStory tab="appearance" fonts={storyFonts} />,
}

export const AppearanceWithoutSystemFonts = {
  render: () => <SettingsStory tab="appearance" />,
}
