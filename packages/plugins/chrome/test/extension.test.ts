import { describe, expect, it } from "bun:test"
import { Schema } from "effect"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ChromeInstall } from "../src/install"
import { Chrome } from "../src/rpc"

describe("extension package", () => {
  it("ships a valid Manifest V3 extension", async () => {
    const manifest = await Bun.file(join(ChromeInstall.extensionPath(), "manifest.json")).json()
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.background.service_worker).toBe("background.js")
    expect(manifest.permissions).toContain("scripting")
    expect(existsSync(join(ChromeInstall.extensionPath(), "content.js"))).toBe(true)
  })

  it("parses the extension scripts as JavaScript", async () => {
    const transpiler = new Bun.Transpiler({ loader: "js" })
    for (const file of ["background.js", "content.js", "hooks.js", "popup.js", "welcome.js"]) {
      const source = await Bun.file(join(ChromeInstall.extensionPath(), file)).text()
      expect(() => transpiler.transformSync(source)).not.toThrow()
    }
  })

  it("decodes a successful tabs.open result", () => {
    const operation = Chrome.Operations.find((entry) => entry.name === "tabs.open")!
    const value = {
      id: 7,
      windowID: 1,
      url: "https://example.com/",
      title: "Example",
      active: true,
      pinned: false,
      status: "complete",
    }
    expect(Schema.decodeUnknownSync(operation.output)(value)).toEqual(value)
  })

  it("decodes extension results and rejects unknown messages", () => {
    const hello = { type: "hello" as const, version: "1.0.0", userAgent: "Chrome" }
    expect(Schema.decodeUnknownSync(Chrome.ExtensionMessage)(hello)).toEqual(hello)
    expect(() => Schema.decodeUnknownSync(Chrome.ExtensionMessage)({ type: "nope" })).toThrow()
  })
})
