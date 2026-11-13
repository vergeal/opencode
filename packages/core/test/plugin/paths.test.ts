import { describe, expect, it } from "bun:test"
import { PluginPaths } from "@opencode/core/plugin/paths"

const windows = "C:\\Users\\me"
const posix = "/home/me"

describe("PluginPaths.make", () => {
  it("keeps everything under the home directory off Windows", () => {
    expect(PluginPaths.make({ home: posix, id: "acme.data" })).toEqual({
      data: "/home/me/.opencode/plugin-data/acme.data",
      cache: "/home/me/.opencode/plugin-cache/acme.data",
      runtime: "/home/me/.opencode/plugin-runtime/acme.data",
      log: "/home/me/.opencode/logs/plugin/acme.data.log",
    })
  })

  it("puts the cache and runtime on D: while data and log stay home", () => {
    expect(PluginPaths.make({ home: windows, id: "acme.data", platform: "win32", drive: true })).toEqual({
      data: "C:\\Users\\me\\.opencode\\plugin-data\\acme.data",
      cache: "D:\\.opencode\\plugin-cache\\acme.data",
      runtime: "D:\\.opencode\\plugin-runtime\\acme.data",
      log: "C:\\Users\\me\\.opencode\\logs\\plugin\\acme.data.log",
    })
  })

  it("falls back to the home directory when the drive is unavailable", () => {
    expect(PluginPaths.make({ home: windows, id: "acme.data", platform: "win32", drive: false })).toEqual({
      data: "C:\\Users\\me\\.opencode\\plugin-data\\acme.data",
      cache: "C:\\Users\\me\\.opencode\\plugin-cache\\acme.data",
      runtime: "C:\\Users\\me\\.opencode\\plugin-runtime\\acme.data",
      log: "C:\\Users\\me\\.opencode\\logs\\plugin\\acme.data.log",
    })
  })

  it("keeps a scoped id as one directory name on either root", () => {
    const scoped = PluginPaths.make({ home: windows, id: "@acme/data", platform: "win32", drive: true })
    expect(scoped.cache).toBe("D:\\.opencode\\plugin-cache\\@acme+data")
    expect(scoped.data).toBe("C:\\Users\\me\\.opencode\\plugin-data\\@acme+data")
    const home = PluginPaths.make({ home: windows, id: "@acme/data", platform: "win32", drive: false })
    expect(home.cache).toBe("C:\\Users\\me\\.opencode\\plugin-cache\\@acme+data")
  })
})

describe("PluginPaths.legacy", () => {
  it("names the home-drive directories a D drive replaced", () => {
    expect(PluginPaths.legacy({ home: windows, id: "acme.data", platform: "win32", drive: true })).toEqual({
      cache: "C:\\Users\\me\\.opencode\\plugin-cache\\acme.data",
      runtime: "C:\\Users\\me\\.opencode\\plugin-runtime\\acme.data",
    })
  })

  it("has nothing to clean up when the environment already sits on the home drive", () => {
    expect(PluginPaths.legacy({ home: windows, id: "acme.data", platform: "win32", drive: false })).toBeUndefined()
  })

  it("has nothing to clean up off Windows", () => {
    expect(PluginPaths.legacy({ home: posix, id: "acme.data" })).toBeUndefined()
  })
})
