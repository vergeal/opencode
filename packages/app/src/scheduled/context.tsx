import { createSimpleContext } from "@opencode/ui/context"
import { createScheduled } from "./model"

/**
 * One scheduled-task model for the shell: the navigation column lists the tasks and the page shows the open one,
 * so a pause, delete or create started in either place is visible in both.
 */
export const { use: useScheduled, provider: ScheduledProvider } = createSimpleContext({
  name: "Scheduled",
  gate: false,
  init: () => createScheduled(),
})
