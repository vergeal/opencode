export type ScheduleDraft = {
  /** A five or six field cron expression. */
  cron: string
  /** The cadence in the request's language, such as "every weekday". */
  frequency: string
  /** The clock time in the request, such as "08:30". */
  time: string
  timezone: string
}

/** The browser's IANA zone, so the prompt, the cron expression and the schedule all read the same clock. */
export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * One stateless generation turns a request such as "every weekday at 5pm" into a cron expression and
 * the labels shown under the prompt. The current date and zone travel in the prompt because the
 * server's zone may differ from the user's.
 */
export function schedulePrompt(request: string) {
  const now = new Date()

  return [
    "Turn the request below into one recurring schedule.",
    'Reply with JSON only, in this shape: {"cron":"minute hour day-of-month month day-of-week","frequency":"short cadence","time":"clock time","timezone":"IANA zone"}',
    `Interpret the cron expression in the IANA time zone ${localTimeZone()}. The current local date and time is ${now.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}.`,
    "The cron expression must have five fields and no seconds.",
    'frequency is a short label such as "every weekday" and time is a clock time such as "08:30". Write both in the language of the request.',
    'If the request has no recurring time, reply exactly {"error":"no schedule"}.',
    "",
    `Request: ${request}`,
  ].join("\n")
}

const TOKEN = /^[0-9A-Za-z*/,?#LW-]+$/

/** Providers sometimes wrap JSON in prose or a code fence, so read the first complete object. */
export function parseSchedule(answer: string) {
  const start = answer.indexOf("{")
  const end = answer.lastIndexOf("}")

  if (start === -1 || end <= start) return

  let decoded: unknown

  try {
    decoded = JSON.parse(answer.slice(start, end + 1))
  } catch {
    return
  }

  if (!decoded || typeof decoded !== "object") return

  // SAFETY: every field is read and type-checked below.
  const record = decoded as Record<string, unknown>
  const cron = typeof record.cron === "string" ? readCron(record.cron) : undefined

  if (!cron) return

  return {
    cron,
    frequency: readText(record.frequency),
    time: readText(record.time),
    timezone: readText(record.timezone) || localTimeZone(),
  } satisfies ScheduleDraft
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readCron(value: string) {
  const fields = value.trim().split(/\s+/)

  if (fields.length !== 5 && fields.length !== 6) return
  if (!/^(\*|\d)/.test(fields[0] ?? "")) return
  if (!fields.every((field) => TOKEN.test(field))) return

  return fields.join(" ")
}
