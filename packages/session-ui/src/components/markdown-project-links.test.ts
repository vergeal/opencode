import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { markProjectLinks, setupProjectLinks } from "./markdown-project-links"

const directory = "/Users/ekko/Projects/opencode"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

test("a known directory keeps its short label and opens project settings", () => {
  const root = document.createElement("div")
  root.innerHTML = `<p>project: <a href="@project:${directory}" title="${directory}">opencode</a></p>`
  markProjectLinks(root, (path) => path === directory)

  const button = root.querySelector<HTMLButtonElement>("button[data-project-directory]")
  expect(button?.dataset.projectDirectory).toBe(directory)
  expect(button?.textContent).toBe("opencode")
  expect(button?.title).toBe(directory)
  expect(root.querySelector("a")).toBeNull()
  expect(root.querySelector("code")).toBeNull()
})

test("an unknown directory falls back to the full path as inline code", () => {
  const root = document.createElement("div")
  root.innerHTML = `<p>project: <a href="@project:/tmp/elsewhere" title="/tmp/elsewhere">elsewhere</a></p>`
  markProjectLinks(root, (path) => path === directory)

  expect(root.querySelector("button")).toBeNull()
  expect(root.querySelector("a")).toBeNull()
  expect(root.querySelector("code")?.textContent).toBe("/tmp/elsewhere")
})

test("delegates clicks to the directory carried by the button", () => {
  const root = document.createElement("div")
  const opened: string[] = []
  const dispose = setupProjectLinks(root, () => (path) => opened.push(path))
  root.innerHTML = `<p>project: <a href="@project:${directory}">opencode</a></p>`
  markProjectLinks(root, () => true)

  root.querySelector("button")?.click()
  expect(opened).toEqual([directory])

  dispose()
  root.querySelector("button")?.click()
  expect(opened).toEqual([directory])
})
