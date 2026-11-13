export * as PluginSecrets from "./secrets.js"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"

/**
 * Plugin secrets are encrypted with a machine-local key. This keeps them out of accidental commits, uploads, and
 * plain-text backups; it does not defend against anyone who can already read this machine, because the key and the
 * ciphertext live side by side.
 */
const algorithm = "aes-256-gcm"

type Ciphertext = Record<string, string>

const keyFile = (home: string) => path.join(home, ".opencode", "secrets.key")

const file = (home: string, id: string) =>
  path.join(home, ".opencode", "secrets", `${id.replaceAll(/[\\/]/g, "+")}.json`)

/** Creates the user key on first use. Two processes racing for it resolve to whichever key landed first. */
async function readKey(home: string) {
  const target = keyFile(home)
  const existing = await readFile(target).catch(() => undefined)
  if (existing) return existing
  await mkdir(path.dirname(target), { recursive: true })
  const key = randomBytes(32)
  return writeFile(target, key, { mode: 0o600, flag: "wx" }).then(
    () => key,
    () => readFile(target),
  )
}

function seal(key: Buffer, value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(algorithm, key, iv)
  const payload = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return [iv, cipher.getAuthTag(), payload].map((part) => part.toString("base64")).join(".")
}

function open(key: Buffer, payload: string) {
  const [iv, tag, data] = payload.split(".")
  if (!iv || !tag || !data) throw new Error("This secret is unreadable.")
  const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, "base64"))
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")
}

async function read(home: string, id: string) {
  const text = await readFile(file(home, id), "utf8").catch(() => undefined)
  if (text === undefined) return {} satisfies Ciphertext
  const parsed: unknown = JSON.parse(text)
  return (typeof parsed === "object" && parsed !== null ? parsed : {}) as Ciphertext
}

/** Writes through a temporary file so a crash cannot leave a half-written secret store. */
async function write(home: string, id: string, values: Ciphertext) {
  const target = file(home, id)
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(values), { mode: 0o600 })
  await rename(temporary, target)
}

export function make(input: { readonly home: string; readonly id: string }) {
  return {
    get: (name: string) =>
      Effect.promise(async () => {
        const values = await read(input.home, input.id)
        const payload = values[name]
        if (payload === undefined) return undefined
        return open(await readKey(input.home), payload)
      }),
    set: (name: string, value: string) =>
      Effect.promise(async () => {
        const values = await read(input.home, input.id)
        await write(input.home, input.id, { ...values, [name]: seal(await readKey(input.home), value) })
      }),
    delete: (name: string) =>
      Effect.promise(async () => {
        const values = await read(input.home, input.id)
        if (values[name] === undefined) return
        const next = { ...values }
        delete next[name]
        await write(input.home, input.id, next)
      }),
  }
}
