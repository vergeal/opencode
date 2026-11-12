import { createMemoryHistory, MemoryRouter, Route, useLocation, useNavigate } from "@solidjs/router"
import { DialogStoryRuntime } from "@/components-lab/dialog-story-runtime"
import { SettingsSurfaceProvider } from "@/settings/surface"
import { LayoutProvider } from "@/shell/state/layout"
import { ReplicaTitleBar } from "./titlebar"

function TitlebarStory() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div class="flex h-full min-h-[120px] w-full flex-col overflow-hidden bg-[var(--color-background-base)]">
      <div data-testid="story-location">{`${location.pathname}${location.search}${location.hash}`}</div>
      <div class="flex gap-1">
        <button type="button" data-testid="story-goto-inbox" onClick={() => navigate("/inbox")}>
          inbox
        </button>
        <button
          type="button"
          data-testid="story-goto-scheduled"
          onClick={() => navigate("/scheduled?filter=active#today")}
        >
          scheduled
        </button>
      </div>
      <ReplicaTitleBar
        sidebarOpen
        onToggleSidebar={() => undefined}
        onMore={() => undefined}
        onView={() => undefined}
        onAdd={() => undefined}
      />
    </div>
  )
}

function Story(props: { start?: string }) {
  const history = createMemoryHistory()
  history.set({ value: props.start ?? "/", replace: true, scroll: false })

  return (
    <DialogStoryRuntime>
      <MemoryRouter
        history={history}
        root={(rootProps) => (
          <LayoutProvider>
            <SettingsSurfaceProvider>{rootProps.children}</SettingsSurfaceProvider>
          </LayoutProvider>
        )}
      >
        <Route path="*all" component={TitlebarStory} />
      </MemoryRouter>
    </DialogStoryRuntime>
  )
}

export default {
  title: "App/Replica Titlebar",
  id: "app-replica-titlebar",
  parameters: {
    layout: "fullscreen",
  },
}

export const Default = {
  render: () => <Story />,
}

export const DeepLink = {
  render: () => <Story start="/server/srv_1/session/ses_1" />,
}
