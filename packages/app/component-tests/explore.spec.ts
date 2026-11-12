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

story("shows the built-in Chrome integration and stops offering it once installed", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { chromeCatalog, chromeInstalled, mountExplorePlugins } = await import(fixture)

    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

    const read = async (input: { catalog: unknown; installed?: unknown }) => {
      const mounted = mountExplorePlugins(input as never)
      // SAFETY: mountExplorePlugins builds its host with document.createElement("div").
      const host = mounted.host as HTMLDivElement
      await frame()

      // The page opens on Installed, so reach the catalog before reading its card.
      host.querySelector<HTMLButtonElement>('[role="tab"]:not([data-selected])')?.click()
      await frame()

      const card = host.querySelector<HTMLElement>(".explore-catalog-card")!
      const state = {
        name: card.querySelector(".explore-catalog-card-name")?.textContent?.trim() ?? "",
        installed: card.querySelector(".explore-catalog-card-installed")?.textContent?.trim() ?? "",
        hasInstall: !!card.querySelector(".explore-catalog-card-add"),
        brandColor: card.querySelector(".explore-catalog-card-icon svg path")?.getAttribute("fill") ?? "",
      }

      card.querySelector<HTMLButtonElement>(".explore-catalog-card-main")?.click()
      await frame()

      const detail = {
        installed: host.querySelector(".explore-catalog-hero-installed")?.textContent?.trim() ?? "",
        hasInstall: !!host.querySelector(".explore-catalog-hero .explore-button"),
        brandColor: host.querySelector(".explore-catalog-hero-icon svg path")?.getAttribute("fill") ?? "",
        type: host.querySelector(".explore-catalog-facts dt")?.textContent?.trim() ?? "",
      }

      mounted.unmount()

      return { state, detail }
    }

    return {
      catalogOnly: await read({ catalog: chromeCatalog }),
      installed: await read({ catalog: chromeCatalog, installed: chromeInstalled }),
    }
  }, fixture)

  const expectChrome = (value: { brandColor: string; type?: string }, hasInstall: boolean, installed: string) => {
    expect(value.brandColor).toBe("#EA4335")
    expect(hasInstall).toBe(false)
    expect(installed).toBe("Installed")
  }

  expect(result.catalogOnly.state.name).toBe("Chrome 浏览器")
  expect(result.catalogOnly.state.brandColor).toBe("#EA4335")
  expect(result.catalogOnly.state.hasInstall).toBe(true)
  expect(result.catalogOnly.state.installed).toBe("")
  expect(result.catalogOnly.detail.hasInstall).toBe(true)
  expect(result.catalogOnly.detail.type).toBe("Type")

  expect(result.installed.state.name).toBe("Chrome 浏览器")
  expectChrome(result.installed.state, result.installed.state.hasInstall, result.installed.state.installed)
  expect(result.installed.detail.type).toBe("Type")
  expectChrome(result.installed.detail, result.installed.detail.hasInstall, result.installed.detail.installed)
})
