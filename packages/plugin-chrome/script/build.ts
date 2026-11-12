import { cp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const target = join(root, "dist", "extension")

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(join(root, "extension"), target, { recursive: true })

console.log(`copied extension to ${target}`)
