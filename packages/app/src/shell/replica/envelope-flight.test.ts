import { expect, test } from "bun:test"
import { deliveryFrom } from "./envelope-flight"

test("reads the sending session from a delivery envelope", () => {
  expect(
    deliveryFrom({
      delivery: { kind: "session.delivery", from: { sessionID: "ses_sender" }, to: "ses_target" },
      displayText: "",
    }),
  ).toBe("ses_sender")
})

test("reads the sending session from a redirect envelope", () => {
  expect(
    deliveryFrom({
      delivery: { kind: "session.redirect", from: { sessionID: "ses_sender" }, to: "ses_target" },
      displayText: "",
    }),
  ).toBe("ses_sender")
})

test("ignores metadata that is not a cross-session delivery", () => {
  expect(deliveryFrom(undefined)).toBeUndefined()
  expect(deliveryFrom({})).toBeUndefined()
  expect(deliveryFrom({ delivery: { kind: "other", from: { sessionID: "ses_sender" } } })).toBeUndefined()
  expect(deliveryFrom({ delivery: { kind: "session.delivery", from: {} } })).toBeUndefined()
  expect(deliveryFrom({ delivery: { kind: "session.delivery", from: { sessionID: 1 } } })).toBeUndefined()
})
