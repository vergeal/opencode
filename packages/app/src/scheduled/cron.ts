/** The browser's IANA zone, so the prompt, the cron expression and the schedule all read the same clock. */
export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * One stateless generation turns a request such as "every weekday at 5pm" into a cron expression.
 * The current date and zone travel in the prompt because the server's zone may differ from the user's.
 */
export function cronPrompt(request: string) {
  const now = new Date()

  return [
    "Turn the request below into one recurring schedule.",
    "Answer with a standard five-field cron expression only: minute hour day-of-month month day-of-week.",
    `Interpret it in the IANA time zone ${localTimeZone()}. The current local date and time is ${now.toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })}.`,
    "Do not use seconds. Do not add prose, quotes or a code fence.",
    "If the request does not describe a recurring time, answer exactly NOT_A_SCHEDULE.",
    "",
    `Request: ${request}`,
  ].join("\n")
}

const TOKEN = /^[0-9A-Za-z*/,?#LW-]+$/

/** The first five-field cron line in the answer; a model that answers in prose still has to produce one. */
export function parseCron(answer: string) {
  return answer
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^```[a-z]*|```$/gi, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .trim(),
    )
    .find((line) => {
      const fields = line.split(/\s+/)

      return (
        (fields.length === 5 || fields.length === 6) &&
        /^(\*|\d)/.test(fields[0] ?? "") &&
        fields.every((field) => TOKEN.test(field))
      )
    })
}
