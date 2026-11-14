import { Ipc } from "@opencode/plugin/gui/main"
import { Contract } from "../src/contract.js"

/**
 * The board Ipc. It lives here, not in `src/`, because only the GUI main entry provides it; importing the GUI SDK from
 * the server side would pull DOM types into the server typecheck. The GUI main entry (b2) owns the ledger read.
 */
export const Board = Ipc.define({
  id: "opencode.orchestrator.board",
  state: Contract.BoardState,
  methods: {
    refetch: {},
  },
})
