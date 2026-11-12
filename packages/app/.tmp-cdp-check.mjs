import { chromium } from "@playwright/test"

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { noDefaults: true })

for (const context of browser.contexts()) {
  for (const page of context.pages()) {
    if (!page.url().includes("localhost:5173")) continue
    const source = await page.evaluate(async () => {
      const response = await fetch("/assets/main.js")
      const text = await response.text()
      return {
        commandsGroup: text.includes("commands-group"),
        commandsRow: text.includes("commands-row:"),
        ranLabel: text.includes("运行了命令"),
      }
    })
    console.log("bundle:", JSON.stringify(source))

    const show = page.getByRole("button", { name: "Show work", exact: true })
    if ((await show.count()) > 0) await show.first().click()
    await page.waitForTimeout(1500)

    const snapshot = await page.evaluate(() => ({
      rows: [...document.querySelectorAll("[data-timeline-row]")].map((row) => row.getAttribute("data-timeline-row")),
      commands: document.querySelectorAll('[data-component="commands-group"]').length,
      contextGroups: document.querySelectorAll('[data-component="collapsed-tool-group"]').length,
      tools: document.querySelectorAll('[data-component="tool-part-wrapper"]').length,
    }))
    console.log(JSON.stringify(snapshot, null, 2))
  }
}

await browser.close()
