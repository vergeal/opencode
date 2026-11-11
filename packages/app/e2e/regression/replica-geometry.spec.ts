import { expect, test } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { mockWorkspace } from "../utils/workspace"

test.use({ serviceWorkers: "block" })

const selectors = [
  '[data-ui="window-titlebar"]',
  '[data-ui="titlebar-left"]',
  '[data-ui="titlebar-main"]',
  '[data-ui="primary-rail"]',
  '[data-ui="navigation-sidebar"]',
  '[data-ui="sidebar-header"]',
  '[data-ui="sidebar-row"]',
  '[data-ui="main-workspace"]',
]

test("replica v6 geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 })
  await mockWorkspace(page, {
    name: "ReplicaV6",
    sessions: [
      { id: "ses_replica_v6", title: "选择本地 Ollama 模型" },
      { id: "ses_replica_v6_b", title: "梳理 Electron 对话展示流程" },
      { id: "ses_replica_v6_c", title: "评估 Electron 应用逆向可行性" },
    ],
    seed: { locale: "zh" },
  })
  await page.goto(sessionHref("ses_replica_v6"))
  await page.waitForSelector('[data-ui="window-titlebar"]', { timeout: 15_000 })
  await page.waitForSelector('[data-component="composer-editor"]', { timeout: 15_000 })
  await page.waitForTimeout(1_000)

  const metrics = await page.evaluate((list) => {
    const round = (value: number) => Math.round(value * 10) / 10

    return list.map((selector) => {
      const element = document.querySelector(selector)

      if (!element) return { selector, found: false }
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)

      return {
        selector,
        found: true,
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        borderRadius: style.borderRadius,
        background: style.backgroundColor,
      }
    })
  }, selectors)

  const extra = await page.evaluate(() => {
    const round = (value: number) => Math.round(value * 10) / 10

    const box = (element: Element | null | undefined) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()

      return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) }
    }

    const title = document.querySelector('[data-ui="titlebar-title"]')
    const dock = document.querySelector('[data-component="session-composer-dock"]')
    const editor = document.querySelector('[data-component="composer-editor"]')

    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      titleText: title?.textContent,
      url: location.href,
      composerDock: box(dock),
      composerEditor: box(editor),
    }
  })

  const sidebar = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-ui="sidebar-row"]')].slice(0, 3)

    return {
      text: document.querySelector('[data-ui="navigation-sidebar"]')?.textContent ?? "",
      rows: rows.map((row) => {
        const rect = row.getBoundingClientRect()

        return {
          y: Math.round(rect.y * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          icon: !!row.firstElementChild && row.firstElementChild.textContent === "",
        }
      }),
    }
  })

  const rail = await page.evaluate(() => {
    const button = document.querySelector('[data-ui="primary-rail"] button')
    const style = button ? getComputedStyle(button) : undefined

    return {
      state: button?.getAttribute("data-state"),
      background: style?.backgroundColor,
      icon: !!button?.querySelector("svg"),
    }
  })

  console.log("REPLICA_V6", JSON.stringify({ metrics, extra, sidebar, rail }, null, 2))
  await page.screenshot({ path: "e2e/test-results/replica-v6-2048x1281.png" })

  const at = (selector: string) => metrics.find((entry) => entry.selector === selector)

  const near = (value: number | undefined, expected: number, tolerance: number) =>
    expect(Math.abs((value ?? 0) - expected)).toBeLessThanOrEqual(tolerance)

  expect(extra.viewport.width).toBe(1536)
  near(at('[data-ui="window-titlebar"]')?.height, 39, 1)
  near(at('[data-ui="titlebar-left"]')?.width, 346, 2)
  near(at('[data-ui="primary-rail"]')?.width, 46, 1)
  near(at('[data-ui="navigation-sidebar"]')?.width, 300, 2)
  near(at('[data-ui="main-workspace"]')?.x, 346, 2)
  near(at('[data-ui="sidebar-header"]')?.height, 49, 1)
  near(at('[data-ui="sidebar-row"]')?.height, 29, 1)
  near(extra.composerEditor?.width, 650, 8)
  expect(extra.titleText).toBe("选择本地 Ollama 模型")
  expect(sidebar.text).not.toContain("项目")
  expect(sidebar.rows.length).toBeGreaterThan(1)
  expect(sidebar.rows.every((row) => row.icon)).toBe(true)
  expect(sidebar.rows[1]!.y - sidebar.rows[0]!.y).toBeCloseTo(31, 0)
  expect(rail.state).toBe("pressed")
  expect(rail.background).toBe("rgb(238, 238, 238)")
  expect(rail.icon).toBe(true)
})
