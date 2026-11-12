import type { Recording } from "./profiling"

/** State every page of the pane shares: the element ref allocator and the app-wide trace recording. */
export type Shared = { ref: () => string; recording?: Recording }
