import { expect, test } from "bun:test"
import { rankSessionTitle } from "./session-match"

test.each([
  { title: "OPENCODE CONSOLE", query: "open con", rank: 1 },
  { title: "OPENCODE CONSOLE", query: "OPENCODE CONSOLE", rank: 0 },
  { title: "OPENCODE CONSOLE", query: "opencode console", rank: 0 },
  { title: "OPENCODE CONSOLE", query: "console", rank: 2 },
  { title: "OPENCODE CONSOLE", query: "OPENCODE CONSOLE ", rank: undefined },
  { title: "OPENCODE CONSOLE", query: "OPENCODE CONSOLE on", rank: undefined },
  { title: "HOME", query: "HOME ", rank: undefined },
  { title: "HOME", query: "home", rank: 0 },
  { title: "Home office", query: "home", rank: 1 },
  { title: "Back home", query: "home", rank: 2 },
  { title: "foobar", query: "foo bar", rank: undefined },
  { title: "foo bar", query: "foo bar", rank: 0 },
  { title: "console", query: "sole", rank: undefined },
  { title: "opencode console", query: "code", rank: undefined },
  { title: "ocdev/ocplugin-open-dev", query: "ocplugin-open-dev", rank: 3 },
  { title: "ocdev/ocplugin-open-dev", query: "ocdev/ocplugin-open-dev", rank: 0 },
  { title: "ocdev/ocplugin-open-dev", query: "ocdev", rank: 1 },
  { title: "ocdev/ocplugin-open-dev", query: "open-dev", rank: 3 },
  { title: "ocdev/ocplugin-open-dev", query: "plugin", rank: undefined },
  { title: "fix(auth): refresh tokens", query: "refresh", rank: 2 },
  { title: "my_notes.md", query: "notes", rank: 3 },
])("$query against $title: $rank", (row) => {
  expect(rankSessionTitle(row.title, row.query)).toBe(row.rank)
})
