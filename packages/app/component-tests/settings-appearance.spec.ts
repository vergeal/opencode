import type { Page } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

const options = (page: Page) => page.locator('[data-slot="font-picker-option"]')
const active = (page: Page) => page.locator('[data-slot="font-picker-option"][data-active]')

story("filters the font list, selects with the keyboard, and fits the panel to the trigger", async ({ mount, page }) => {
  const root = await mount("app-dialog-settings--appearance")
  const trigger = root.locator('[data-action="settings-ui-font"]')

  await expect(trigger).toHaveText("Inter")
  await trigger.click()

  const panel = page.locator('[data-slot="font-picker-panel"]')
  await expect(panel).toBeVisible()
  await expect(options(page)).toHaveCount(6)

  const search = page.getByRole("combobox", { name: "UI Font", exact: true })
  await expect(search).toBeFocused()

  const triggerBox = (await trigger.boundingBox())!
  const panelBox = (await panel.boundingBox())!

  expect(Math.abs(panelBox.width - triggerBox.width)).toBeLessThanOrEqual(1)
  expect(panelBox.x).toBeGreaterThanOrEqual(0)
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth))

  await search.fill("mono")
  await expect(options(page)).toHaveCount(2)
  await expect(options(page).locator('[data-slot="font-picker-option-name"]')).toHaveText([/mono/i, /mono/i])

  await search.press("ArrowDown")
  const family = (await active(page).locator('[data-slot="font-picker-option-name"]').textContent())!
  await search.press("Enter")

  await expect(panel).toBeHidden()
  await expect(trigger).toHaveText(family)
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans")))
    .toContain(family)
})

story("code font lists monospace families first while still offering every family", async ({ mount, page }) => {
  const root = await mount("app-dialog-settings--appearance")
  await root.locator('[data-action="settings-code-font"]').click()

  const items = options(page)
  await expect(items).toHaveCount(6)

  const list = await items.evaluateAll((elements) =>
    elements.map((element) => ({
      family: element.querySelector('[data-slot="font-picker-option-name"]')?.textContent ?? "",
      monospace: element.hasAttribute("data-monospace"),
    })),
  )

  expect(list.some((item) => item.monospace)).toBe(true)
  expect(list.some((item) => !item.monospace)).toBe(true)

  const firstProportional = list.findIndex((item) => !item.monospace)
  expect(list.slice(firstProportional).every((item) => !item.monospace)).toBe(true)
})

story("falls back to the default families when the platform has no font list", async ({ mount, page }) => {
  const root = await mount("app-dialog-settings--appearance-without-system-fonts")
  await root.locator('[data-action="settings-ui-font"]').click()

  const items = options(page)
  expect(await items.count()).toBeGreaterThan(0)
  await expect(items.filter({ hasText: "IBM Plex Mono" })).toHaveCount(1)
})
