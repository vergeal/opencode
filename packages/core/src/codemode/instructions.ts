export * as CodeModeInstructions from "./instructions.js"

import { searchSignature, toolExpression } from "@opencode/codemode"
import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { CodeModeCatalog } from "./catalog.js"

// prettier-ignore
const prompt = (hasMoreTools: boolean) => `# Code Mode

下面列出的工具${hasMoreTools ? "，以及 \`search\`，" : ""}不能直接调用：它们只能作为 JavaScript 在 \`execute\` 工具内部调用。其他工具都是普通工具调用，直接在回复中调用，绝不要放进 \`execute\` 里。

${hasMoreTools ? `目录并不完整。调用下面没有列出的工具前，先用全局 \`search(...)\` 查找。不要猜工具名。每条结果里的 \`path\` 就是完整的调用表达式：把它写成代码，例如 \`await tools.ns.tool_name({ ... })\`。不要把它当成键名，例如 \`tools[path]\`。

- ${searchSignature}` : "目录是完整的。不要猜工具名。"}

其他可调用的工具，例如 \`shell\`、\`grep\`、\`glob\` 或 \`read\`，都是原生工具。直接在回复中调用；它们不能通过 \`execute\` 里的 \`tools.<name>\` 访问。

## Code Mode 工具（只能在 \`execute\` 内调用）

## 可用工具`

export function render(catalog: CodeModeCatalog.Summary) {
  if (catalog.total === 0)
    return "当前没有可用的 Code Mode 工具。之后的目录更新可能会加入或移除工具。至少有一个可用工具时才可以调用 `execute`。"

  const tools = catalog.namespaces.flatMap((namespace) => {
    return [CodeModeCatalog.namespaceLine(namespace), ...namespace.entries.map((entry) => entry.line)]
  })

  return `${prompt(catalog.shown < catalog.total)}

${tools.join("\n")}`
}

export function update(previous: CodeModeCatalog.Summary, current: CodeModeCatalog.Summary) {
  const replacement = `Code Mode 工具目录已变化。本目录取代之前的 Code Mode 工具目录。

${render(current)}`
  if (current.total === 0) return replacement
  const previousComplete = previous.shown === previous.total
  const currentComplete = current.shown === current.total
  if (previousComplete !== currentComplete) return replacement

  const descriptions = Instructions.diffByKey(
    previous.namespaces.filter((namespace) => namespace.description !== undefined),
    current.namespaces.filter((namespace) => namespace.description !== undefined),
    (namespace) => namespace.name,
    (before, after) => before.description !== after.description,
  )
  if (descriptions.added.length > 0 || descriptions.removed.length > 0 || descriptions.changed.length > 0)
    return replacement

  const diff = Instructions.diffByKey(
    previous.namespaces.flatMap((namespace) => namespace.entries),
    current.namespaces.flatMap((namespace) => namespace.entries),
    (entry) => entry.path,
    (before, after) => before.line !== after.line,
  )
  const entriesChanged = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0

  if (!currentComplete) {
    if (entriesChanged) return replacement
    const namespaces = Instructions.diffByKey(
      previous.namespaces,
      current.namespaces,
      (namespace) => namespace.name,
      (before, after) => before.count !== after.count,
    )
    const changed = namespaces.added.length > 0 || namespaces.removed.length > 0 || namespaces.changed.length > 0
    if (!changed) return replacement

    const parts = ["Code Mode 工具目录已变化。"]
    if (namespaces.added.length > 0) {
      parts.push(
        `新增了这些工具命名空间：${namespaces.added
          .map((namespace) => `\`${namespace.name}\`（${namespace.count} 个工具）`)
          .join("、")}。`,
      )
    }
    if (namespaces.changed.length > 0) {
      parts.push(
        `以下命名空间的工具清单有变化；依赖之前的结果前请重新搜索：${namespaces.changed
          .map((change) => `\`${change.current.name}\` 现在有 ${change.current.count} 个工具`)
          .join("、")}。`,
      )
    }
    if (namespaces.removed.length > 0) {
      parts.push(
        `以下工具命名空间已不可用，不得再使用：${namespaces.removed
          .map((namespace) => `\`${namespace.name}\``)
          .join("、")}。`,
      )
    }
    const delta = parts.join("\n\n")
    if (delta.length < replacement.length) return delta
    return replacement
  }

  if (!entriesChanged) return replacement
  const parts = ["Code Mode 工具目录已变化。"]
  if (diff.added.length > 0) {
    parts.push(
      [
        "除了之前列出的工具，新增了以下工具：",
        ...diff.added.map((entry) => entry.line),
      ].join("\n"),
    )
  }
  if (diff.changed.length > 0) {
    parts.push(
      [
        "有变化的工具条目取代之前列出的条目：",
        ...diff.changed.map((change) => change.current.line),
      ].join("\n"),
    )
  }
  if (diff.removed.length > 0) {
    parts.push(
      `以下工具已不可用，不得再调用：${diff.removed
        .map((entry) => toolExpression(entry.path))
        .join("、")}。`,
    )
  }
  const delta = parts.join("\n\n")
  if (delta.length < replacement.length) return delta
  return replacement
}

const key = Instructions.Key.make("core/codemode")
const codec = Schema.toCodecJson(CodeModeCatalog.Summary)

export const make = (inventory?: CodeModeCatalog.Inventory): Instructions.List => {
  const catalog = inventory === undefined ? Instructions.removed : CodeModeCatalog.summarize(inventory)
  return Instructions.make({
    key,
    codec,
    read: Effect.succeed(catalog),
    render: {
      initial: render,
      changed: update,
      removed: () => "Code Mode 工具已不可用。不要再使用任何之前列出的 Code Mode 工具。",
    },
  })
}
