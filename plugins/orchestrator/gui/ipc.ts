import { Ipc } from "@opencode/plugin/gui/main"
import { Schema } from "effect"
import { Contract } from "../src/contract.js"

/**
 * The board Ipc. It lives here, not in `src/`, because only the GUI main entry provides it; importing the GUI SDK from
 * the server side would pull DOM types into the server typecheck. The GUI main entry (b2) owns the ledger read.
 *
 * The board is per session, but `IpcImpl.state` only receives a window id, so each window reports its routed session
 * with `setSession` first.
 */
export const Board = Ipc.define({
  id: "changhong.orchestrator.board",
  state: Contract.BoardState,
  methods: {
    setSession: { input: Schema.String },
    refetch: {},
  },
})
