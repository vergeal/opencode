export * as CodeModeInstructions from "./instructions.js"

import { searchSignature } from "@aicraft/codemode"
import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { CodeModeCatalog } from "./catalog.js"

const PROMPT = [
  "# Code Mode",
  "",
  "The tools below — and `search` and `execute` themselves — are Code Mode tools: they run only as JavaScript " +
    "inside `execute`, never as a direct tool call. Every other tool you have, such as `shell`, `grep`, `glob` " +
    "or `read`, is native: call it directly in the response.",
  "",
  "The catalog lists what exists, not how to call it. Before calling a Code Mode tool, find its signature with " +
    "the global `search(...)` function. Do not guess tool names. The `path` in every result is the full call " +
    "expression: write it as code, for example `await tools.ns.tool_name({ ... })`. Do not treat it as a key, " +
    "for example `tools[path]`.",
  "",
  `- ${searchSignature}`,
  "",
  "## Code Mode tools (call only inside `execute`)",
].join("\n")

export function render(catalog: CodeModeCatalog.Summary) {
  if (catalog.total === 0)
    return "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool."

  return [PROMPT, ...catalog.namespaces.map((namespace) => CodeModeCatalog.namespaceLine(namespace))].join("\n")
}

/**
 * The notice for a changed catalog. Only namespaces are compared, because only namespaces are listed: a tool
 * arriving inside an existing namespace does not change the text, so it is not announced — the model finds it
 * with `search` when it goes looking. That is what keeps this notice short and, more importantly, keeps a new
 * namespace from rewriting the entries of every other one.
 */
export function update(previous: CodeModeCatalog.Summary, current: CodeModeCatalog.Summary) {
  const replacement = `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.

${render(current)}`
  if (current.total === 0) return replacement

  const changes = Instructions.diffByKey(
    previous.namespaces,
    current.namespaces,
    (namespace) => namespace.name,
    (before, after) => before.count !== after.count,
  )
  if (changes.added.length === 0 && changes.removed.length === 0 && changes.changed.length === 0)
    return replacement

  const parts = ["The Code Mode tool catalog has changed."]
  if (changes.added.length > 0) {
    parts.push(
      [
        "New tool namespaces are available; search them before calling anything inside them:",
        ...changes.added.map((namespace) => CodeModeCatalog.namespaceLine(namespace)),
      ].join("\n"),
    )
  }
  if (changes.changed.length > 0) {
    parts.push(
      `These namespaces changed size; search them again before relying on previous results: ${changes.changed
        .map((change) => `\`${change.current.name}\` now has ${change.current.count} tools`)
        .join(", ")}.`,
    )
  }
  if (changes.removed.length > 0) {
    parts.push(
      `These tool namespaces are no longer available and must not be used: ${changes.removed
        .map((namespace) => `\`${namespace.name}\``)
        .join(", ")}.`,
    )
  }

  const delta = parts.join("\n\n")
  return delta.length < replacement.length ? delta : replacement
}

const key = Instructions.Key.make("core/codemode")
const codec = Schema.toCodecJson(CodeModeCatalog.Summary)

export const make = (inventory?: CodeModeCatalog.Inventory): Instructions.List => {
  const catalog = inventory === undefined ? Instructions.removed : CodeModeCatalog.summarize(inventory)
  return Instructions.make({
    key,
    // L2: §1 names CodeMode under 能力声明 — this catalog text is the rendered twin of the L2
    // tool schemas (the schemas themselves ride the tools array). Prefix semantics: a full
    // rebuild settles on version advance (static-registration face), not as a turn supply;
    // interim change notices already ride the L4 tail through the ledger.
    layer: "L2",
    codec,
    read: Effect.succeed(catalog),
    render: {
      initial: render,
      changed: update,
      removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
    },
  })
}
