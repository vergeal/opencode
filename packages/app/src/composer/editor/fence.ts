/** An opening fence: its marker character and the run length that can close it. */
export type Fence = { readonly marker: "`" | "~"; readonly length: number }

const linePattern = /^[ \t]*(`{3,}|~{3,})(.*)$/

/**
 * Applies one line to the open fence. A fence line opens a block when the draft is outside one,
 * and closes it only with the same marker, at least as long, and nothing after the run.
 */
export function nextFence(open: Fence | undefined, line: string) {
  const match = linePattern.exec(line)
  if (!match) return { open, marker: false }

  const run = match[1]!
  const fence = { marker: run[0] as Fence["marker"], length: run.length }

  if (!open) return { open: fence, marker: true }
  if (fence.marker === open.marker && fence.length >= open.length && match[2]!.trim() === "")
    return { open: undefined, marker: true }

  return { open, marker: true }
}

/** The fenced block the given text sits in, or undefined outside one. */
export function openFence(text: string) {
  let open: Fence | undefined

  for (const line of text.split("\n")) open = nextFence(open, line).open

  return open
}
