import type { InboxStatus } from "./model"
import { INBOX_FILTERS, type InboxFilter } from "@/shell/state/layout"

export { INBOX_FILTERS }

export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = {
  all: "inbox.filter.all",
  pending: "inbox.filter.pending",
  failed: "inbox.filter.failed",
  done: "inbox.filter.done",
}

export const INBOX_FILTER_STATUS: Record<InboxFilter, InboxStatus | undefined> = {
  all: undefined,
  pending: "pending",
  failed: "failed",
  done: "done",
}

export const INBOX_KIND_ICONS = {
  approval: "check",
  question: "bubble-5",
  failure: "outline-hexagonal-warning",
  output: "terminal",
  result: "file-document",
} as const
