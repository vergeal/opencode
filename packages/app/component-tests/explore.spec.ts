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

story("groups the catalog, filters it, opens a plugin's page, and returns", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { mountExplorePlugins } = await import(fixture)
    const mounted = mountExplorePlugins()

    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

    await frame()

    // SAFETY: mountExplorePlugins builds its host with document.createElement("div").
    const host = mounted.host as HTMLDivElement

    const cards = () => Array.from(host.querySelectorAll<HTMLButtonElement>(".explore-catalog-card-main"))

    const names = () =>
      cards().map((card) => card.querySelector(".explore-catalog-card-name")?.textContent?.trim() ?? "")

    const groups = () =>
      Array.from(host.querySelectorAll(".explore-catalog-group-title")).map((title) => title.textContent?.trim() ?? "")

    const detailTitle = () => host.querySelector(".explore-catalog-hero-name")?.textContent?.trim()

    const crumbs = () => host.querySelector(".explore-catalog-crumb")?.textContent?.trim()

    const statusTitle = () => host.querySelector(".explore-status-title")?.textContent?.trim()

    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!

    const body = host.querySelector(".explore-catalog-body")!

    const heights = cards().map((card) => Math.round(card.getBoundingClientRect().height))

    const initial = {
      cards: cards().length,
      names: names(),
      groups: groups(),
      uniformCards: new Set(heights).size === 1,
      noHorizontalOverflow: body.scrollWidth <= body.clientWidth,
    }

    const type = async (input: HTMLInputElement, value: string) => {
      input.value = value
      input.dispatchEvent(new Event("input", { bubbles: true }))
      await frame()
    }

    await type(search, "beta")
    const filtered = { cards: cards().length, names: names() }

    cards()[0]?.click()
    await frame()
    const opened = {
      title: detailTitle(),
      crumbs: crumbs(),
      hasAbout: !!host.querySelector(".explore-catalog-about"),
      hasMcp: !!host.querySelector(".explore-catalog-section-title"),
    }

    host.querySelector<HTMLButtonElement>(".explore-catalog-crumb")?.click()
    await frame()
    const returned = cards().length

    // The page rebuilt its header with the list, so the search field is a new element.
    const reopenedSearch = host.querySelector<HTMLInputElement>('input[type="search"]')!

    await type(reopenedSearch, "nothing-matches")
    const empty = { title: statusTitle(), cards: cards().length }

    mounted.unmount()

    return { initial, filtered, opened, returned, empty }
  }, fixture)

  expect(result.initial.cards).toBe(3)
  expect(result.initial.names).toEqual(["alpha-plugin", "beta-plugin", "gamma-plugin"])
  expect(result.initial.groups).toEqual(["Developer Tools", "Productivity", "Automation"])
  expect(result.initial.uniformCards).toBe(true)
  expect(result.initial.noHorizontalOverflow).toBe(true)

  expect(result.filtered).toEqual({ cards: 1, names: ["beta-plugin"] })
  expect(result.opened).toEqual({
    title: "beta-plugin",
    crumbs: "Plugins",
    hasAbout: true,
    hasMcp: true,
  })
  expect(result.returned).toBe(1)
  expect(result.empty).toEqual({ title: "No matching plugins", cards: 0 })
})
