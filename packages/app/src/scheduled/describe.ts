import type { ScheduleInfo } from "@opencode/client/promise"
import type { useLanguage } from "@/runtime/i18n/language"

type Language = ReturnType<typeof useLanguage>

/** A one-line, human-readable trigger such as "Every 1 hour" or "Cron 0 9 * * 1-5". */
export function describeWhen(info: Pick<ScheduleInfo, "when">, language: Language) {
  const when = info.when

  switch (when.type) {
    case "in":
      return language.t("scheduled.when.in", { duration: when.in })
    case "at":
      return language.t("scheduled.when.at", { at: when.at })
    case "every":
      return language.t("scheduled.when.every", { duration: when.every })
    case "cron":
      return language.t("scheduled.when.cron", { cron: when.cron })
  }
}

export function describeStatus(status: ScheduleInfo["status"], language: Language) {
  switch (status) {
    case "active":
      return language.t("scheduled.status.active")
    case "paused":
      return language.t("scheduled.status.paused")
    case "done":
      return language.t("scheduled.status.done")
  }
}

export function describeOutcome(outcome: ScheduleInfo["lastOutcome"], language: Language) {
  switch (outcome) {
    case "fired":
      return language.t("scheduled.outcome.fired")
    case "late":
      return language.t("scheduled.outcome.late")
    case "checked":
      return language.t("scheduled.outcome.checked")
    case "expired":
      return language.t("scheduled.outcome.expired")
    case "skipped":
      return language.t("scheduled.outcome.skipped")
    case "disabled":
      return language.t("scheduled.outcome.disabled")
    case "failed":
      return language.t("scheduled.outcome.failed")
  }
}

const formatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/** A compact local timestamp; `undefined` reads as a dash so rows keep their shape. */
export function formatTime(millis: number | undefined) {
  return millis === undefined ? "—" : formatter.format(new Date(millis))
}

export function taskName(info: Pick<ScheduleInfo, "name" | "when">, language: Language) {
  const name = info.name?.trim()

  return name ? name : describeWhen(info, language)
}
