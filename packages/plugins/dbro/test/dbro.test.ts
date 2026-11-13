import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import manifest from "../ocplugin.json" with { type: "json" }
import * as Dialects from "../src/dialects.js"
import * as Sources from "../src/sources.js"

describe("ocplugin manifest", () => {
  test("reserves the dbro namespace and advertises its skill", () => {
    expect(manifest.id).toBe("opencode.dbro")
    expect(manifest.display.tools).toEqual(["dbro.*"])
    expect(manifest.skills.map((skill) => skill.id)).toEqual(["dbro"])
    for (const skill of manifest.skills) expect(existsSync(join(import.meta.dir, "..", skill.path))).toBe(true)
  })
})

describe("sources", () => {
  test("parses URL shorthand and defaults the port, user and name", () => {
    const settings = Sources.settings({ sources: ["mysql://readonly@10.0.0.6/mall"] }, {})
    expect(settings.errors).toEqual([])
    expect(settings.sources).toEqual([
      { name: "mysql:10.0.0.6/mall", dialect: "mysql", host: "10.0.0.6", port: 3306, user: "readonly", database: "mall" },
    ])
  })

  test("lets the runtime config override a project source with the same name", () => {
    const settings = Sources.settings(
      { sources: ["mall=dm://SYSDBA@10.0.0.5/BIZ"] },
      { sources: ["mall=pg://readonly@10.0.0.7/analytics"] },
    )
    expect(settings.sources).toHaveLength(1)
    expect(settings.sources[0]?.dialect).toBe("pg")
    expect(settings.sources[0]?.database).toBe("analytics")
  })

  test("reports bad entries instead of dropping them silently", () => {
    const settings = Sources.settings({ sources: ["oracle://host/db", "name=broken"] }, {})
    expect(settings.sources).toEqual([])
    expect(settings.errors).toHaveLength(2)
  })

  test("names the password environment variable", () => {
    const settings = Sources.settings({ sources: ["report prod=pg://readonly@host/db"] }, {})
    expect(Sources.passwordEnv(settings.sources[0]!)).toBe("DBRO_REPORT_PROD_PASSWORD")
  })
})

describe("dialect SQL", () => {
  test("escapes a single quote in a compared literal", () => {
    expect(Dialects.literal("o'brien")).toBe("'o''brien'")
    expect(Dialects.columns("pg", "t'1")).toContain("table_name = 't''1'")
  })

  test("uses each engine's catalogue", () => {
    expect(Dialects.tables("dm", "BIZ")).toContain("all_tables")
    expect(Dialects.tables("dm")).toContain("user_tables")
    expect(Dialects.tables("mysql")).toContain("DATABASE()")
    expect(Dialects.tables("pg", "report")).toContain("information_schema.tables")
    expect(Dialects.columns("dm", "orders", "BIZ")).toContain("all_tab_columns")
    expect(Dialects.columns("mysql", "orders")).toContain("information_schema.columns")
    expect(Dialects.columns("pg", "orders")).toContain("current_schema()")
  })
})
