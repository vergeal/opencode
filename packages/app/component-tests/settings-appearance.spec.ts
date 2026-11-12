import type { Page } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

const options = (page: Page) => page.locator('[data-slot="font-picker-option"]')
const active = (page: Page) => page.locator('[data-slot="font-picker-option"][data-active]')

story(
  "filters the font list, selects with the keyboard, and fits the panel to the trigger",
  async ({ mount, page }) => {
    const root = await mount("app-dialog-settings--appearance")
    const trigger = root.locator('[data-action="settings-ui-font"]')

    await expect(trigger).toHaveText("Inter")
    await trigger.click()

    const panel = page.locator('[data-slot="font-picker-panel"]')
    await expect(panel).toBeVisible()
    await expect(options(page)).toHaveCount(5)

    const search = page.getByRole("combobox", { name: "UI Font", exact: true })
    await expect(search).toBeFocused()

    const triggerBox = (await trigger.boundingBox())!
    const panelBox = (await panel.boundingBox())!

    expect(Math.abs(panelBox.width - triggerBox.width)).toBeLessThanOrEqual(1)
    expect(panelBox.x).toBeGreaterThanOrEqual(0)
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    )

    await search.fill("mono")
    await expect(options(page)).toHaveCount(3)
    await expect(options(page).locator('[data-slot="font-picker-option-name"]')).toHaveText([/mono/i, /mono/i, /mono/i])

    await search.press("ArrowDown")
    const family = (await active(page).locator('[data-slot="font-picker-option-name"]').textContent())!
    await search.press("Enter")

    await expect(panel).toBeHidden()
    await expect(trigger).toHaveText(family)
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans")),
      )
      .toContain(family)
  },
)

story("code font lists monospace families first", async ({ mount, page }) => {
  const root = await mount("app-dialog-settings--appearance")
  await root.locator('[data-action="settings-code-font"]').click()

  const items = options(page)
  await expect(items).toHaveCount(5)

  const list = await items.evaluateAll((elements) =>
    elements.map((element) => ({
      family: element.querySelector('[data-slot="font-picker-option-name"]')?.textContent ?? "",
      monospace: element.hasAttribute("data-monospace"),
    })),
  )

  expect(list[0].family).toBe("System")

  // System stays first; the bundled monospace faces follow it, then the proportional face.
  const families = list.slice(1)
  const firstProportional = families.findIndex((item) => !item.monospace)

  expect(families.slice(0, firstProportional).every((item) => item.monospace)).toBe(true)
  expect(families.slice(firstProportional).every((item) => !item.monospace)).toBe(true)
})

story("offers only the bundled faces and the system stack", async ({ mount, page }) => {
  const root = await mount("app-dialog-settings--appearance")
  await root.locator('[data-action="settings-ui-font"]').click()

  await expect(options(page).locator('[data-slot="font-picker-option-name"]')).toHaveText([
    "System",
    "Inter",
    "IBM Plex Mono",
    "JetBrains Mono",
    "JetBrainsMono Nerd Font Mono",
  ])
})
