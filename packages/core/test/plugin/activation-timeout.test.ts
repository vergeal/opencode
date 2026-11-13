import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { Plugin } from "@opencode/core/plugin"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("times out an activation that never settles, records a ref, and releases the lock and hold", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const hung = Plugin.ID.make("hung-activation")
    const after = Plugin.ID.make("after-hung")
    let afterRan = false
    let laterRan = false

    const activation = yield* plugins
      .activate([
        { id: hung, revision: "1", effect: () => Effect.never },
        {
          id: after,
          revision: "1",
          effect: () =>
            Effect.sync(() => {
              afterRan = true
            }),
        },
      ])
      .pipe(Effect.forkChild({ startImmediately: true }))

    // `hold()` keeps the activation latch closed for as long as the load runs, so this waiter cannot finish before the
    // timeout releases it.
    const waiter = yield* plugins.awaitActivation.pipe(Effect.forkChild({ startImmediately: true }))
    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)))
    expect(waiter.pollUnsafe()).toBeUndefined()

    // Directory setup and the module import run as real promises, so advance real time until the activation reaches its
    // timeout sleep, then advance virtual time past it. `Effect.timeout` races the activation against that sleep.
    for (let attempt = 0; attempt < 200 && activation.pollUnsafe() === undefined; attempt++) {
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1)))
      yield* TestClock.adjust("31 seconds")
    }
    yield* Fiber.join(activation)
    yield* Fiber.join(waiter)

    // Snapshot before activating anything else: a new `activate` call replaces the whole slot list, so the failed entry
    // is only visible while its batch is the current one.
    const inventory = yield* plugins.list()
    const failed = inventory.find((plugin) => plugin.id === hung)
    expect(failed?.state.status).toBe("failed")
    if (failed?.state.status === "failed") {
      expect(failed.state.ref).toMatch(/^err_[0-9a-f]{8}$/)
      expect(failed.state.reason).toEqual({ kind: "activation-timeout", seconds: 30 })
    }
    // The registry keeps loading in order after the timed-out entry.
    expect(afterRan).toBe(true)
    expect(inventory.find((plugin) => plugin.id === after)?.state.status).toBe("active")

    // The lock is free again: a later activation completes instead of waiting behind the hung one.
    yield* plugins.activate([
      {
        id: Plugin.ID.make("later-activation"),
        revision: "1",
        effect: () =>
          Effect.sync(() => {
            laterRan = true
          }),
      },
    ])
    expect(laterRan).toBe(true)
    expect((yield* plugins.list()).find((plugin) => plugin.id === Plugin.ID.make("later-activation"))?.state.status).toBe(
      "active",
    )
  }),
)

it.effect("does not disable an activation that returns", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const id = Plugin.ID.make("quick-activation")
    let ran = false

    yield* plugins.activate([
      {
        id,
        revision: "1",
        effect: () =>
          Effect.sync(() => {
            ran = true
          }),
      },
    ])

    expect(ran).toBe(true)
    expect((yield* plugins.list()).find((plugin) => plugin.id === id)?.state.status).toBe("active")
    // No virtual time was advanced, so the guard never fired; a real success must not be reported as a timeout.
  }),
)
