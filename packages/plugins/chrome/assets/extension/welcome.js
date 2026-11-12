const dot = document.getElementById("dot")
const label = document.getElementById("label")

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "opencode.status" }).catch(() => null)
  const connected = Boolean(response?.value?.connected)
  dot.className = `dot ${connected ? "on" : "off"}`
  label.textContent = connected ? "已连接 OpenCode" : "正在等待 OpenCode…"
}

refresh()
setInterval(refresh, 1000)
