import { expect, story } from "../../stories/playwright/story"

const backButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Back", exact: true })

story.describe("titlebar history", () => {
  story.beforeEach(async ({ mount }) => {
    await mount("app-replica-titlebar--default")
  })

  story("keeps the back button disabled until a second real visit exists", async ({ page }) => {
    await expect(backButton(page)).toBeDisabled()
    await expect(page.getByTestId("story-location")).toHaveText("/")

    await page.getByTestId("story-goto-inbox").click()
    await expect(page.getByTestId("story-location")).toHaveText("/inbox")
    await expect(backButton(page)).toBeEnabled()

    await page.getByTestId("story-goto-scheduled").click()
    await expect(page.getByTestId("story-location")).toHaveText("/scheduled?filter=active#today")
    await expect(backButton(page)).toBeEnabled()
  })

  story("restores the full previous address when going back", async ({ page }) => {
    await page.getByTestId("story-goto-inbox").click()
    await page.getByTestId("story-goto-scheduled").click()

    await backButton(page).click()
    await expect(page.getByTestId("story-location")).toHaveText("/inbox")

    await backButton(page).click()
    await expect(page.getByTestId("story-location")).toHaveText("/")
    await expect(backButton(page)).toBeDisabled()
  })
})
