export * as Contract from "./contract.js"

import { Schema } from "effect"
import { Ledger } from "./ledger.js"

export const BoardPlan = Schema.Struct({
  planID: Schema.String,
  plannerSessionID: Schema.String,
  createdAt: Schema.String,
})
export type BoardPlan = typeof BoardPlan.Type

export const BoardTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Ledger.Status,
  sessionID: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.String),
  elapsedMs: Schema.Number,
  anomaly: Schema.NullOr(Schema.String),
})
export type BoardTask = typeof BoardTask.Type

export const BoardCurrent = Schema.Struct({
  planID: Schema.String,
  counts: Schema.Record(Schema.String, Schema.Number),
  tasks: Schema.Array(BoardTask),
})
export type BoardCurrent = typeof BoardCurrent.Type

export const BoardState = Schema.Struct({
  plans: Schema.Array(BoardPlan),
  current: Schema.NullOr(BoardCurrent),
})
export type BoardState = typeof BoardState.Type
