import type { Effect } from "effect"

/** What a plugin controls about one message it published. */
export type InboxStatus = "pending" | "done" | "failed"

/** One message a plugin publishes into the app's inbox. */
export interface InboxMessage {
  /** The producer's own id for the message. Publishing the same id again updates the record instead of adding one. */
  readonly externalID: string
  readonly title: string
  readonly summary: string
  /** Defaults to `pending`. A later publish keeps the status the plugin already set. */
  readonly status?: InboxStatus
  /** When the message was produced; defaults to the publish time. */
  readonly createdAt?: number
  readonly expiresAt?: number
  readonly payload?: unknown
}

/** A published message as the platform stores it. */
export interface InboxRecord extends InboxMessage {
  readonly id: InboxID
  /** The user has opened the message. */
  readonly seen: boolean
  readonly updatedAt: number
}

/** Fields a plugin may change after publishing. `expiresAt: null` clears the deadline. */
export interface InboxPatch {
  readonly title?: string
  readonly summary?: string
  readonly status?: InboxStatus
  readonly expiresAt?: number | null
  readonly payload?: unknown
}

export type InboxID = string

/**
 * The plugin's own messages in the app's inbox. Every call is scoped to the plugin that owns this context: `list`
 * returns only its messages, and `update`, `remove` and `markSeen` do nothing for an id it did not publish.
 */
export interface InboxDomain {
  /** Publishes one message, or updates the record with the same `externalID`. `status` and `seen` are preserved. */
  readonly publish: (message: InboxMessage) => Effect.Effect<InboxID>
  readonly publishMany: (messages: InboxMessage[]) => Effect.Effect<InboxID[]>
  readonly list: () => Effect.Effect<InboxRecord[]>
  readonly update: (id: InboxID, patch: InboxPatch) => Effect.Effect<void>
  readonly remove: (id: InboxID) => Effect.Effect<void>
  readonly markSeen: (id: InboxID) => Effect.Effect<void>
  /**
   * Runs when the user marks this plugin's messages read, with the ids read in that action. A listener lives with the
   * plugin instance that registered it. There is no global "mark everything read" counterpart.
   */
  readonly onSeen: (callback: (ids: InboxID[]) => void) => void
}
