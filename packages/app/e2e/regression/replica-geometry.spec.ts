import { expect, test } from "@playwright/test"
import { sessionHref, T0 } from "../utils/app"
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
      {
        id: "ses_replica_v6_failed",
        title: "失败的会话",
        outcome: "failed",
        time: { created: T0, updated: T0 + 2_000, idle: T0 + 2_000 },
      },
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
    const newChat = document.querySelector('[data-slot="replica-new-chat"]')
    const titlebar = document.querySelector('[data-ui="window-titlebar"]')
    const sidebar = document.querySelector('[data-ui="navigation-sidebar"]')

    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      titleText: title?.textContent,
      url: location.href,
      composerDock: box(dock),
      composerEditor: box(editor),
      newChat: box(newChat),
      titlebarFont: titlebar ? getComputedStyle(titlebar).fontFamily : null,
      sidebarFont: sidebar ? getComputedStyle(sidebar).fontFamily : null,
      titlebarChatIcon: !!titlebar?.querySelector('use[href="#opencode-v2-icon-titlebar-chat"]'),
    }
  })

  const sidebar = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-ui="sidebar-row"]')].slice(0, 3)
    const failed = [...document.querySelectorAll('[data-ui="sidebar-row"]')].find((row) =>
      row.textContent?.includes("失败的会话"),
    )
    const dot = failed?.querySelector("span.rounded-full")

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
      failed: failed
        ? {
            title: failed.querySelector("span.truncate")?.textContent,
            dot: dot ? Math.round(dot.getBoundingClientRect().width * 10) / 10 : null,
          }
        : null,
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

  const backgrounds = await page.evaluate(() => {
    const color = (element: Element | null) => (element ? getComputedStyle(element).backgroundColor : null)

    return {
      app: color(document.querySelector("[data-replica]")),
      shell: color(document.querySelector('[data-slot="replica-shell"]')),
      workbench: color(document.querySelector('[data-slot="replica-workbench"]')),
      root: color(document.getElementById("root")),
      body: color(document.body),
    }
  })

  console.log("REPLICA_V6", JSON.stringify({ metrics, extra, sidebar, rail, backgrounds }, null, 2))
  await page.screenshot({ path: "e2e/test-results/replica-v6-2048x1281.png" })

  const at = (selector: string) => metrics.find((entry) => entry.selector === selector)

  const near = (value: number | undefined, expected: number, tolerance: number) =>
    expect(Math.abs((value ?? 0) - expected)).toBeLessThanOrEqual(tolerance)

  expect(extra.viewport.width).toBe(1536)
  near(at('[data-ui="window-titlebar"]')?.height, 39, 1)
  near(at('[data-ui="titlebar-left"]')?.width, 346, 2)
  near(at('[data-ui="primary-rail"]')?.width, 46, 1)
  near(at('[data-ui="navigation-sidebar"]')?.width, 300, 2)
  near(at('[data-ui="main-workspace"]')?.x, 354, 2)
  near(at('[data-ui="sidebar-header"]')?.height, 49, 1)
  near(at('[data-ui="sidebar-row"]')?.height, 29, 1)
  near(extra.composerEditor?.width, 650, 8)
  near(extra.newChat?.height, 31, 1)
  expect(extra.titlebarFont).toBe(extra.sidebarFont)
  expect(extra.titlebarChatIcon).toBe(true)
  expect(extra.titleText).toBe("选择本地 Ollama 模型")
  expect(sidebar.text).not.toContain("项目")
  expect(sidebar.failed?.title).toBe("失败的会话")
  expect(sidebar.failed?.dot).toBe(6)
  expect(sidebar.rows.length).toBeGreaterThan(1)
  expect(sidebar.rows.every((row) => row.icon)).toBe(true)
  expect(sidebar.rows[1]!.y - sidebar.rows[0]!.y).toBeCloseTo(31, 0)
  expect(rail.state).toBe("pressed")
  expect(rail.background).toBe("rgb(238, 238, 238)")
  expect(rail.icon).toBe(true)
  expect(backgrounds.app).toBe("rgba(246, 246, 246, 0.9)")
})

test("replica rail opens the inbox", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 })
  await mockWorkspace(page, {
    name: "ReplicaInbox",
    sessions: [{ id: "ses_replica_inbox", title: "收件箱入口" }],
    seed: { locale: "zh" },
  })
  await page.goto("/")
  await page.waitForSelector('[data-slot="replica-rail"]', { timeout: 15_000 })
  await page.locator('[data-slot="replica-rail"] button[aria-label="收件箱"]').click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.locator('[data-slot="replica-sidebar-title"]')).toHaveText("收件箱")
  await expect(page.getByRole("button", { name: "全部标记已读" })).toBeVisible()
  await expect(page.locator('[data-ui="workspace-content"]')).toContainText("选择一项")
})

test("replica rail switches the navigation column per destination", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 })
  await mockWorkspace(page, {
    name: "ReplicaDestinations",
    sessions: [{ id: "ses_replica_dest", title: "目的地" }],
    schedules: [
      {
        id: "sch_replica_dest",
        name: "Nightly report",
        when: { type: "cron", cron: "0 3 * * *" },
        tz: "UTC",
        action: { type: "prompt", prompt: "report" },
        status: "active",
        runCount: 1,
        time: { created: T0, updated: T0 + 4_000 },
      },
    ],
    seed: { locale: "zh" },
  })
  await page.goto("/")
  await page.waitForSelector('[data-slot="replica-rail"]', { timeout: 15_000 })

  await page.locator('[data-slot="replica-rail"] button[aria-label="定时任务"]').click()
  await expect(page).toHaveURL(/\/scheduled$/)
  await expect(page.locator('[data-slot="replica-sidebar-title"]')).toHaveText("定时任务")
  await expect(page.locator('[data-ui="scheduled-row"]')).toContainText("Nightly report")
  await expect(page.locator('[data-ui="workspace-content"]')).toContainText("Nightly report")

  await page.locator('[data-slot="replica-rail"] button[aria-label="探索"]').click()
  await expect(page).toHaveURL(/\/knowledge$/)
  await expect(page.locator('[data-slot="replica-sidebar-title"]')).toHaveText("探索")
  await expect(page.locator('[data-ui="navigation-sidebar"]').getByRole("button", { name: "新建知识库" })).toBeVisible()

  await page.locator('[data-slot="replica-rail"] button[aria-label="设置"]').click()
  await expect(page).toHaveURL(/\/settings/)
  await expect(page.getByTestId("settings-screen")).toBeVisible()
  await expect(page.locator('[data-ui="navigation-sidebar"]')).toHaveCount(0)
})
