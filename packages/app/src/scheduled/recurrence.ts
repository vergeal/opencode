/**
 * The recurrence the create form edits. Everything the form shows maps onto one of these variants, and each
 * variant knows how to become the `when` the schedule API accepts.
 */
import type { Schedule } from "@opencode/schema/schedule"

export type Recurrence =
  | { kind: "hourly"; hours: number }
  | { kind: "daily"; time: string }
  /** `days` is ISO weekday numbering: 1 is Monday and 7 is Sunday. */
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "cron"; cron: string }

const HOUR = 60 * 60_000

const MINUTE = { min: 0, max: 59 }
const HOUR_FIELD = { min: 0, max: 23 }
const DAY_OF_MONTH = { min: 1, max: 31 }
const MONTH = { min: 1, max: 12 }
const DAY_OF_WEEK = { min: 0, max: 7 }

export const DEFAULT_RECURRENCE: Recurrence = { kind: "daily", time: "09:00" }

/** The time-of-day part of a recurrence, as `HH:MM`. */
export function timeOf(recurrence: Recurrence) {
  switch (recurrence.kind) {
    case "daily":
    case "weekly":
    case "monthly":
      return recurrence.time
    default:
      return undefined
  }
}

export function clockOf(time: string) {
  const [hour, minute] = time.split(":").map(Number)

  return {
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  }
}

export function formatClock(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function cronOf(recurrence: Recurrence) {
  if (recurrence.kind === "cron") return recurrence.cron

  const { hour, minute } = clockOf("time" in recurrence ? recurrence.time : "00:00")

  switch (recurrence.kind) {
    case "hourly":
      return `${minute} */${recurrence.hours} * * *`
    case "daily":
      return `${minute} ${hour} * * *`
    case "weekly": {
      const days = [...recurrence.days]
        .sort((left, right) => left - right)
        .map((day) => (day === 7 ? 0 : day))
        .join(",")

      return `${minute} ${hour} * * ${days || "*"}`
    }
    case "monthly":
      return `${minute} ${hour} ${recurrence.day} * *`
  }
}

/** The `when` the create call takes: an interval for "every N hours", a cron otherwise. */
export function whenOf(recurrence: Recurrence, tz: string): Schedule.WhenInput {
  if (recurrence.kind === "hourly")
    return { every: `${recurrence.hours} ${recurrence.hours === 1 ? "hour" : "hours"}`, tz }

  return { cron: cronOf(recurrence), tz }
}

/**
 * Keep the cadence the user picked and take the time the prompt described. Reading the prompt is only for the
 * details the form does not ask for, so the visible choice always wins over a different inferred cadence.
 */
export function mergeRecurrence(choice: Recurrence, inferred: Recurrence | undefined): Recurrence {
  if (!inferred) return choice

  const time = timeOf(inferred)

  switch (choice.kind) {
    case "hourly":
      return choice
    case "daily":
      return time ? { kind: "daily", time } : choice
    case "weekly":
      return {
        kind: "weekly",
        days: inferred.kind === "weekly" ? inferred.days : choice.days,
        time: time ?? choice.time,
      }
    case "monthly":
      return {
        kind: "monthly",
        day: inferred.kind === "monthly" ? inferred.day : choice.day,
        time: time ?? choice.time,
      }
    case "cron":
      return choice
  }
}

/**
 * Read a cron back into a preset when it is one, so an inferred schedule fills the visible controls.
 * A six-field cron contributes its minute and up: the controls and the preview work in whole minutes.
 */
export function recurrenceOfCron(cron: string): Recurrence {
  const source = cron.trim().split(/\s+/)
  const fields = source.length === 6 ? source.slice(1) : source

  if (fields.length !== 5) return { kind: "cron", cron }

  const [minuteField, hourField, domField, monthField, dowField] = fields
  const normalized = fields.join(" ")

  if (monthField !== "*") return { kind: "cron", cron: normalized }

  const minute = plainNumber(minuteField)

  if (minute === undefined) return { kind: "cron", cron: normalized }

  if (domField === "*" && dowField === "*") {
    const hour = plainNumber(hourField)

    if (hour === undefined) return { kind: "cron", cron: normalized }

    return { kind: "daily", time: formatClock(hour, minute) }
  }

  if (domField === "*") {
    const days = weekdaysOf(dowField)

    if (!days || !plainNumber(hourField)) return { kind: "cron", cron: normalized }

    return { kind: "weekly", days, time: formatClock(plainNumber(hourField)!, minute) }
  }

  if (dowField === "*") {
    const hour = plainNumber(hourField)
    const day = plainNumber(domField)

    if (hour === undefined || day === undefined) return { kind: "cron", cron: normalized }

    return { kind: "monthly", day, time: formatClock(hour, minute) }
  }

  return { kind: "cron", cron: normalized }
}

export function isValidCron(cron: string) {
  return parseCron(cron) !== undefined
}

/**
 * The next local instant this recurrence fires. `hourly` cannot be resolved from the cron alone, so it is
 * measured from `from`, which matches the interval the server starts counting at creation.
 */
export function nextRun(recurrence: Recurrence, from: Date) {
  if (recurrence.kind === "hourly") return new Date(from.getTime() + recurrence.hours * HOUR)

  const start = new Date(from)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)

  const parsed = parseCron(cronOf(recurrence))

  if (!parsed) return undefined

  const hours = [...parsed.hours].sort((left, right) => left - right)
  const minutes = [...parsed.minutes].sort((left, right) => left - right)

  // Try the matching days in order and stop at the first instant in the future: a cron that fires today
  // resolves on the first pass, while a yearly one still finishes without building every candidate date.
  for (let offset = 0; offset < 366; offset++) {
    const day = addDays(start, offset)

    if (!matchesDay(parsed, day)) continue

    for (const hour of hours) {
      for (const minute of minutes) {
        const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)

        if (date.getTime() >= start.getTime()) return date
      }
    }
  }

  return undefined
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function plainNumber(field: string) {
  return /^\d+$/.test(field) ? Number(field) : undefined
}

/** ISO weekdays in, cron days out: 1–7 with Sunday last reads like a calendar week in the picker. */
function weekdaysOf(field: string) {
  const values = parseField(field, DAY_OF_WEEK)

  if (!values) return

  return [...new Set([...values].map((day) => (day === 0 || day === 7 ? 7 : day)))].sort((left, right) => left - right)
}

type ParsedCron = {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
  anyDayOfMonth: boolean
  anyDayOfWeek: boolean
}

function parseCron(cron: string): ParsedCron | undefined {
  const fields = cron.trim().split(/\s+/)

  if (fields.length !== 5) return

  const [minuteField, hourField, domField, monthField, dowField] = fields
  const minutes = parseField(minuteField, MINUTE)
  const hours = parseField(hourField, HOUR_FIELD)
  const daysOfMonth = parseField(domField, DAY_OF_MONTH)
  const months = parseField(monthField, MONTH)
  const daysOfWeek = parseField(dowField, DAY_OF_WEEK)

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return

  // Sunday is both 0 and 7 in cron; normalize so a single membership test works.
  daysOfWeek.delete(7)
  if ([...parseField(dowField, DAY_OF_WEEK)!].includes(7)) daysOfWeek.add(0)

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    anyDayOfMonth: domField === "*",
    anyDayOfWeek: dowField === "*",
  }
}

function parseField(field: string, range: { min: number; max: number }) {
  const values = new Set<number>()

  const parts = field.split(",")

  for (const part of parts) {
    const [body, stepText] = part.split("/")
    const step = stepText === undefined ? 1 : Number(stepText)

    if (!Number.isInteger(step) || step < 1) return

    const bounds =
      body === "*"
        ? { from: range.min, to: range.max }
        : body.includes("-")
          ? readRange(body)
          : readRange(`${body}-${body}`)

    if (!bounds) return
    if (bounds.from < range.min || bounds.to > range.max || bounds.from > bounds.to) return

    for (let value = bounds.from; value <= bounds.to; value += step) values.add(value)
  }

  return values.size > 0 ? values : undefined
}

function readRange(body: string) {
  const [fromText, toText] = body.split("-")

  if (!/^\d+$/.test(fromText ?? "") || !/^\d+$/.test(toText ?? "")) return

  return { from: Number(fromText), to: Number(toText) }
}

function matchesDay(cron: ParsedCron, day: Date) {
  if (!cron.months.has(day.getMonth() + 1)) return false

  const dom = cron.daysOfMonth.has(day.getDate())
  const dow = cron.daysOfWeek.has(day.getDay())

  if (cron.anyDayOfMonth) return cron.anyDayOfWeek || dow
  if (cron.anyDayOfWeek) return dom

  // Standard cron treats a restricted day-of-month and day-of-week as "either", not "both".
  return dom || dow
}
