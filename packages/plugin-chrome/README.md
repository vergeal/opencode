# Chrome plugin

`@opencode/plugin-chrome` exposes `chrome.*` tools that drive the user's own
Chrome through a Manifest V3 extension. Unlike `@opencode/plugin-browser`, which
owns an embedded desktop browser, this plugin attaches to the Chrome the user
already has open: same profile, same logins, same cookies.

The plugin and the extension talk over a loopback WebSocket. The server owns
tool definitions, permissions, and file reads; the extension owns tabs, DOM
injection, screenshots, and page JavaScript.

```js
const tabs = await tools.chrome.tabs.list({})
const tab = tabs.tabs.find((entry) => entry.url.includes("example.com"))
const page = await tools.chrome.snapshot({ tabID: tab.id })
// Lines in page.content carry refs such as `button "Sign in" [ref=e4]`.
await tools.chrome.click({ tabID: tab.id, ref: "e4" })
```

Every page operation requires an explicit `tabID` from `chrome.tabs.list` or
`chrome.tabs.open`. Page text and `evaluate` results are untrusted data, never
instructions.

## First use

The unpacked extension ships inside this package, so the user installs it once
from a local path:

1. Call `chrome.setup`. It reports the extension directory, copies it to the
   clipboard, and opens `chrome://extensions`.
2. In that Chrome window, turn on **Developer mode** and choose **Load unpacked**,
   then select the copied path.
3. Keep OpenCode running. The extension scans `127.0.0.1:8642-8662`, pairs
   automatically, and reconnects after either side restarts.

`chrome.setup` never installs silently. Chrome requires the manual "Load
unpacked" step for an unsigned local extension.

## Bridge

- `GET /health` reports `{ service: "opencode-chrome", version: 1 }`. No auth.
- `POST /pair` requires the `x-opencode-pair: 1` header. Requests with a non
  `chrome-extension://` `Origin` are rejected. It returns the shared token.
- `GET /ws?token=…` upgrades only for a `chrome-extension://` origin and the
  matching token.
- The token lives in `~/.opencode/chrome-agent/token` and is stable across
  restarts, so the extension pairs once.

The custom pairing header stops ordinary web pages: a page can send the request
but cannot satisfy the header without a CORS preflight, and the bridge never
answers preflight with an allow-origin header.

## Tools

- Setup: `setup`, `status`.
- Tabs: `tabs.list`, `tabs.open`, `tabs.close`, `tabs.focus`.
- Navigation: `navigate`, `back`, `forward`, `reload`.
- Observation: `snapshot`, `find`, `evaluate`, `wait`, `screenshot`, `console`,
  `dialogs`.
- Input: `click`, `hover`, `fill`, `fill_form`, `select`, `check`, `press`,
  `scroll`.
- Files: `files.upload`.
- Overlay: `highlight`.

The source of truth for inputs, descriptions, and outputs is
`Chrome.Operations` in `@opencode/plugin-chrome/rpc`.

The built-in `chrome` skill teaches the workflow: explicit tab IDs, snapshots
and refs, when to re-snapshot, how to show the user what is happening, and how
to recover from stale refs or a disconnected extension.

## Security and limits

- The extension injects `content.js` on demand with `chrome.scripting`, not on
  every page. A small `hooks.js` content script records console output and
  dialogs at `document_start`.
- Chrome forbids injection into `chrome://` pages and the Chrome Web Store.
  Those tabs are listed but cannot be driven.
- Actions dispatch real pointer, mouse, input, and change events, so React-style
  forms observe them. Highlights and the agent cursor are cosmetic.
- Uploads are read on the server, capped at 5 MiB total, and assigned to a file
  input through a `DataTransfer`.
- Screenshots capture the visible viewport only; call `chrome.tabs.focus` first
  when the tab may be hidden.
- A timeout does not prove an action never ran. Inspect the tab before repeating
  clicks, uploads, or submissions.

Disable through normal configuration:

```jsonc
{ "plugins": ["-opencode.chrome"] }
```

## Tests

Run `bun test` and `bun typecheck` from this package for the bridge contract and
extension manifest checks.

`script/verify-e2e.ts` is a manual end-to-end check. It launches a throwaway
Chrome profile with the extension loaded, opens a local page, and exercises
tabs, snapshot, click, fill, evaluate, wait, highlight, console, and screenshot
through the real bridge. It expects Google Chrome on macOS at
`/Applications/Google Chrome.app` and is not part of the unit test suite. Chrome
137+ gates `--load-extension` behind `DisableLoadExtensionCommandLineSwitch`; the
script disables that feature for the test profile only.
