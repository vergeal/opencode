// Runs in the page's own world before page scripts. It records console output and
// JavaScript dialogs so the agent can read them later without stopping the page.
(() => {
  if (window.__opencodeAgentHooks) return

  const MAX_ENTRIES = 400
  const entries = []
  const dialogs = []

  const record = (level, args) => {
    entries.push({
      level,
      time: Date.now(),
      text: args
        .map((value) => {
          if (typeof value === "string") return value
          if (value instanceof Error) return `${value.name}: ${value.message}`
          try {
            return JSON.stringify(value)
          } catch {
            return String(value)
          }
        })
        .join(" "),
    })
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  }

  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level]
    console[level] = function (...args) {
      record(level === "warn" ? "warning" : level, args)
      return original.apply(this, args)
    }
  }

  window.addEventListener("error", (event) => record("error", [event.message]))
  window.addEventListener("unhandledrejection", (event) => record("error", [event.reason]))

  const originalAlert = window.alert
  window.alert = (message) => {
    dialogs.push({ type: "alert", message: String(message), time: Date.now() })
    return originalAlert.call(window, message)
  }
  const originalConfirm = window.confirm
  window.confirm = (message) => {
    dialogs.push({ type: "confirm", message: String(message), time: Date.now() })
    return originalConfirm.call(window, message)
  }
  const originalPrompt = window.prompt
  window.prompt = (message, defaultValue) => {
    dialogs.push({ type: "prompt", message: String(message), defaultValue: String(defaultValue ?? ""), time: Date.now() })
    return originalPrompt.call(window, message, defaultValue)
  }

  Object.defineProperty(window, "__opencodeAgentHooks", {
    value: {
      console(level, limit) {
        const minimum = ["debug", "log", "info", "warning", "error"]
        const floor = minimum.indexOf(level === "warning" ? "warning" : level)
        return entries
          .filter((entry) => minimum.indexOf(entry.level) >= floor)
          .slice(-limit)
      },
      dialogs(limit) {
        return dialogs.slice(-limit)
      },
      clearDialogs() {
        dialogs.length = 0
      },
    },
    configurable: false,
    enumerable: false,
    writable: false,
  })
})()
