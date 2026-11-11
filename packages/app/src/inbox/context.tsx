import { createSimpleContext } from "@opencode/ui/context"
import { createInbox } from "./model"

/**
 * One inbox for the shell: the navigation column and the inbox page read the same items, so marking an item
 * read or answering it in one place is visible in the other.
 */
export const { use: useInbox, provider: InboxProvider } = createSimpleContext({
  name: "Inbox",
  gate: false,
  init: () => createInbox(),
})
