const $ = (id) => document.getElementById(id)

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "opencode.status" }).catch(() => null)
  const status = response?.value
  const dot = $("dot")
  const connected = Boolean(status?.connected)
  dot.className = `dot ${connected ? "on" : "off"}`
  $("label").textContent = connected ? "Connected to OpenCode" : "Waiting for OpenCode"
  $("port").textContent = status?.port ? `127.0.0.1:${status.port}` : "—"
  $("chrome").textContent = status?.chrome || "—"
  $("version").textContent = status?.version || "—"
  $("tabs").textContent = status?.tabs ?? "—"
}

$("connect").addEventListener("click", async () => {
  $("label").textContent = "Reconnecting…"
  await chrome.runtime.sendMessage({ type: "opencode.connect" }).catch(() => {})
  setTimeout(refresh, 900)
})

refresh()
setInterval(refresh, 1000)
