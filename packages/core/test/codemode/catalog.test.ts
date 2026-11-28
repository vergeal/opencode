import { describe, expect, test } from "bun:test"
import { CodeModeCatalog } from "@aicraft/core/codemode/catalog"
import { CodeModeInstructions } from "@aicraft/core/codemode/instructions"

const entry = (path: string, description: string, signature?: string, pinned = false): CodeModeCatalog.Tool => ({
  type: "tool",
  name: path,
  description,
  signature: signature ?? `tools.${path}({\n  q: string,\n}): Promise<string>`,
  pinned,
})

const lookup = entry(
  "orders.lookup",
  "Look up an order by ID",
  "tools.orders.lookup({\n  id: string,\n}): Promise<{\n  id: string,\n  status: string,\n}>",
)

const render = (tools: CodeModeCatalog.Inventory["tools"]) =>
  CodeModeInstructions.render(CodeModeCatalog.summarize({ tools }))

const update = (previous: CodeModeCatalog.Inventory["tools"], current: CodeModeCatalog.Inventory["tools"]) =>
  CodeModeInstructions.update(CodeModeCatalog.summarize({ tools: previous }), CodeModeCatalog.summarize({ tools: current }))

describe("CodeModeCatalog.summarize", () => {
  test("names every namespace with its tool count and no signatures", () => {
    // The catalog answers "what exists", not "how do I call it": signatures are what `search` is for, and
    // listing them cost ~8 KB of prompt on every step.
    const catalog = CodeModeCatalog.summarize({
      tools: [entry("alpha.one", "One"), entry("alpha.two", "Two"), entry("beta.three", "Three")],
    })

    expect(catalog).toEqual({
      total: 3,
      namespaces: [
        { name: "alpha", count: 2 },
        { name: "beta", count: 1 },
      ],
    })
  })

  test("keeps every namespace however many tools they hold", () => {
    // No budget to compete for: a 10 000-tool namespace must not squeeze out its neighbours, which is the
    // reshuffle that used to rewrite the block whenever a large server connected mid-session.
    const catalog = CodeModeCatalog.summarize({
      tools: [
        ...Array.from({ length: 10_000 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`)),
        entry("tiny.one", "One"),
      ],
    })

    expect(catalog.total).toBe(10_001)
    expect(catalog.namespaces.map((namespace) => namespace.name)).toEqual(["bulk", "tiny"])
  })

  test("carries the namespace description through", () => {
    const catalog = CodeModeCatalog.summarize({
      tools: [{ type: "namespace", name: "notes", description: "Note taking", tools: [entry("notes.echo", "Echo")] }],
    })

    expect(catalog.namespaces[0]?.description).toBe("Note taking")
  })
})

describe("CodeModeInstructions.render", () => {
  test("lists namespaces and points at search instead of inlining signatures", () => {
    const instructions = render([lookup])

    expect(instructions).toContain("## Code Mode tools (call only inside `execute`)")
    expect(instructions).toContain("- orders (1 tool)")
    // The signature is reachable through `search`, so the catalog must not carry it.
    expect(instructions).not.toContain(lookup.signature)
    expect(instructions).not.toContain("Look up an order by ID")
    expect(instructions).toContain("- search({")
    expect(instructions).toContain("The catalog lists what exists, not how to call it.")
  })

  test("says the same thing for one namespace and for many", () => {
    // The old text switched between "complete" and "partial" as the budget moved, so the same catalog read
    // differently from one step to the next. One shape removes that whole class of churn.
    const one = render([lookup])
    const many = render([lookup, entry("beta.other", "Other")])

    expect(one).toContain("The catalog lists what exists")
    expect(many).toContain("The catalog lists what exists")
    expect(one).not.toContain("The catalog is partial")
    expect(one).not.toContain("The catalog is complete")
  })

  test("renders only the no-tools notice for an empty catalog", () => {
    expect(render([])).toBe(
      "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
    )
  })
})

describe("CodeModeInstructions.update", () => {
  const echo = entry("notes.echo", "Echo text")

  test("announces a namespace that appeared, and nothing else", () => {
    const text = update([echo], [echo, entry("browser.open", "Open a tab"), entry("browser.close", "Close")])

    expect(text).toContain("The Code Mode tool catalog has changed.")
    expect(text).toContain("New tool namespaces are available")
    expect(text).toContain("- browser (2 tools)")
    // The namespace that did not change is not restated.
    expect(text).not.toContain("- notes")
  })

  test("announces a namespace that changed size", () => {
    const text = update([echo], [echo, entry("notes.list", "List")])

    expect(text).toContain("`notes` now has 2 tools")
    expect(text).toContain("search them again")
  })

  test("announces a namespace that disappeared", () => {
    const text = update([echo, entry("gone.one", "Gone")], [echo])

    expect(text).toContain("`gone`")
    expect(text).toContain("no longer available")
  })

  test("stays silent when a tool is added inside an existing namespace without changing its line", () => {
    // Only namespaces are listed, so a namespace gaining a tool inside it does change its count — but a
    // catalog where nothing visible moved must not restate the block.
    const text = update([echo], [echo])

    expect(text).toContain("This catalog supersedes the previous Code Mode tool catalog.")
  })

  test("keeps a large removal to the namespace line instead of restating the catalog", () => {
    // 200 tools leaving in one namespace is one line of notice now, not a 200-entry diff: the signatures were
    // never in the block to remove.
    const previous = [
      ...Array.from({ length: 200 }, (_, index) => entry(`bulk.tool${index}`, `Tool ${index}`)),
      echo,
    ]
    const text = update(previous, [echo])

    expect(text).toContain("These tool namespaces are no longer available")
    expect(text).toContain("`bulk`")
    expect(text.length).toBeLessThan(400)
    expect(text).not.toContain("tools.bulk.tool0(")
  })
})
