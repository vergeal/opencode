import { expect, sourceURL, story } from "../../stories/playwright/story"

const fixture = sourceURL(new URL("./explore.fixture.tsx", import.meta.url))

// Any story loads the app runtime; the fixture mounts the real plugins view beside it.
story.beforeEach(async ({ mount, page }) => {
  await mount("ui-line-comment--editor")

  // Load the fixture before the test mounts it: Vite must not reload the page to optimize its dependencies mid-fixture.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.evaluate((url) => import(url), fixture)

      return
    } catch (error) {
      if (attempt >= 2) throw error

      await page.waitForLoadState("networkidle")
    }
  }
})

story("lists plugins, filters them, shows the no-results state, and reveals details on click", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExplorePlugins } = await import(fixture)
    const mounted = mountExplorePlugins()

    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

    await frame()

    // SAFETY: mountExplorePlugins builds its host with document.createElement("div").
    const host = mounted.host as HTMLDivElement

    const rows = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".explore-plugin-row"))

    const names = () => rows().map((row) => row.querySelector(".settings-extension-name")?.textContent?.trim() ?? "")

    const detailTitle = () => host.querySelector(".explore-plugins-detail .explore-skills-title")?.textContent?.trim()

    const placeholder = () =>
      host.querySelector(".explore-plugins-detail .explore-skills-placeholder-title")?.textContent?.trim()

    const statusTitle = () => host.querySelector(".explore-status-title")?.textContent?.trim()

    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!

    const list = host.querySelector(".explore-plugins-list")!

    const scroll = host.querySelector(".explore-plugins-scroll")!

    const heights = rows().map((row) => Math.round(row.getBoundingClientRect().height))

    const initial = {
      rows: rows().length,
      names: names(),
      placeholder: placeholder(),
      uniformRows: new Set(heights).size === 1,
      noHorizontalOverflow: list.scrollWidth <= list.clientWidth && scroll.scrollWidth <= scroll.clientWidth,
    }

    const type = async (value: string) => {
      search.value = value
      search.dispatchEvent(new Event("input", { bubbles: true }))
      await frame()
    }

    await type("beta")
    const filteredRows = rows().length

    rows()[0]?.click()
    await frame()
    const clickedDetail = detailTitle()

    await type("nothing-matches")
    const empty = { title: statusTitle(), rows: rows().length }

    mounted.unmount()

    return { initial, filteredRows, clickedDetail, empty }
  }, fixture)

  expect(result.initial.rows).toBe(3)
  expect(result.initial.names).toEqual(["alpha-plugin", "beta-plugin", "gamma-plugin"])
  expect(result.initial.placeholder).toBe("Select a plugin")
  expect(result.initial.uniformRows).toBe(true)
  expect(result.initial.noHorizontalOverflow).toBe(true)

  expect(result.filteredRows).toBe(1)
  expect(result.clickedDetail).toBe("beta-plugin")
  expect(result.empty).toEqual({ title: "No matching plugins", rows: 0 })
})
