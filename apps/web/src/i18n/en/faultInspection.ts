import type { Fmt } from "../format.ts";

/** English source messages for the `faultInspection` area (ADR-007): fault-inspection.ts and checkout-display.ts. */
export const faultInspection = {
  /** A null value, shown only at display; the data keeps null. */
  none: "none",
  notProjected: "not projected",
  /** Labels for the fault status codes `selected`, `recorded`, and `not-recorded`. */
  status: {
    selected: "selected",
    recorded: "recorded",
    "not-recorded": "not recorded",
  },
  /** Display names of the checkout components that are not just their capitalized ID (`Orders`, `Payments`). */
  names: {
    customerApp: "Customer App",
    orders: "Orders",
    payments: "Payments",
    processor: "Payment Processor",
  },
  resources: {
    request: "Model-owned checkout request and outcome",
    ledger: "Model-owned provider authorization ledger",
  },
  evidence: {
    faultSelection: "Show fault selection",
    droppedResponse: "Show dropped processor response",
    processorAuthorization: "Show processor authorization",
    paymentsTimeout: "Show Payments timeout",
    busAcknowledgement: "Show bus acknowledgement",
    ordersLifecycle: "Show Orders lifecycle",
    paymentsLifecycle: "Show Payments lifecycle",
  },
  stagedNote: "No staged transaction is included. The rows below are committed.",
  /** The "what does each side know" paragraph: whole sentences, joined by `knowledge.sentences`. */
  knowledge: {
    sentences: (parts: readonly string[], _f: Fmt) => parts.join(" "),
    noFacts: "No student-visible checkout facts were projected. Host-only component state stays hidden.",
    timeoutBoundary: "A network timeout is a missing response. It is not proof of denial or rollback.",
    payment: (p: { id: string; state: string; outcome: string; authorization: string }, _f: Fmt) =>
      `payment ${p.id} committed ${p.state} with outcome ${p.outcome} and local authorization ID ${p.authorization}`,
    localPayments: (list: string, _f: Fmt) => `${list}.`,
    noPayments: "No payment row is committed yet.",
    authorization: (p: { id: string; status: string }, _f: Fmt) => `${p.id} ${p.status}`,
    ledger: (p: { processor: string; list: string }, _f: Fmt) => `The ${p.processor} visible ledger shows ${p.list}.`,
    emptyLedger: (processor: string, _f: Fmt) => `The ${processor} visible ledger shows no authorization.`,
    timeoutDiffers: "Payments' timeout and the processor ledger are different facts.",
    agreed: "The local authorization ID matches a visible processor authorization.",
    separate: "Local payment state and the processor ledger are shown as separate facts.",
  },
};
