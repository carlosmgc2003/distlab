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
  /** Text of FaultInspectionView.tsx. Values that are data (IDs, states, outcomes, amounts) arrive as parameters and stay raw. */
  view: {
    noCommittedRows: "No committed rows.",
    lifecycle: "Lifecycle",
    processGeneration: "Process generation",
    committedRevision: "Committed revision",
    stateDetails: (rows: number, f: Fmt) => `Committed state details · ${f.plural(rows, { one: "1 row", other: `${f.number(rows)} rows` })}`,
    serviceNotProjected: "Service state was not projected.",
    noBusDelivery: "No bus delivery is recorded.",
    delivery: (p: { destination: string; state: string; attempt: number; messageId: string }, _f: Fmt) =>
      `${p.destination} state ${p.state}, attempt ${p.attempt}. Message ${p.messageId}.`,
    deliveryConsumer: (p: { destination: string; state: string; attempt: number; consumer: string; messageId: string }, _f: Fmt) =>
      `${p.destination} state ${p.state}, attempt ${p.attempt}, consumer ${p.consumer}. Message ${p.messageId}.`,
    distributedState: "Distributed state",
    aboutSession: "About this session",
    aboutSessionBody: "This session was constructed from the recorded scenario input. Changing the experiment loads a new session.",
    scenario: "Scenario",
    seed: "Seed",
    faultStatus: "Fault status",
    statusIs: (status: string, _f: Fmt) => `Status: ${status}`,
    /** One fault rule; the route and name are included only when the rule has them. */
    fault: (p: { id: string; point: string; source?: string; target?: string; name?: string; effect: string; status: string }, _f: Fmt) =>
      `Fault ${p.id} on ${p.point}${p.source ? ` from ${p.source}` : ""}${p.target ? ` to ${p.target}` : ""}${p.name ? ` for ${p.name}` : ""}, effect ${p.effect}. Status: ${p.status}.`,
    noFaultRule: "No fault rule is recorded.",
    localVsProcessor: "Local knowledge vs processor outcome",
    observedNote: "Observed facts so far; scenario expectations are not outcomes.",
    paymentsKnowledgeRegion: "Payments local knowledge",
    paymentsKnows: "Payments knows",
    authorizationId: (id: string, _f: Fmt) => `authorization ID ${id}`,
    noLocalPaymentObserved: "No local payment row observed.",
    processorOutcomeRegion: "Processor visible outcome",
    processorFact: "Processor visible fact",
    noAuthorizationVisible: "No authorization visible so far.",
    customerAppOutcome: "Customer App observed outcome",
    request: "Request",
    outcome: "Outcome",
    clientUncertain: "Uncertain: the local result does not establish denial.",
    rawRecords: "Raw payment and processor records",
    paymentsLocalOutcomes: "Payments local outcomes",
    /** Rich: `{state}` is the styled payment state. */
    paymentRow: "Payment {payment} for order {order}: {state}",
    /** Rich: `{outcome}` is the styled outcome. Shown after a separator. */
    paymentRowOutcome: "outcome {outcome}",
    paymentUncertain: "Local state is uncertain; this does not prove denial.",
    noLocalPaymentCommitted: "No local payment row is committed.",
    ordersCommitted: "Orders committed state",
    paymentsCommitted: "Payments committed state",
    processorAuthorizations: "Payment Processor visible authorizations",
    /** Rich: `{status}` is the styled status. */
    authorizationRow: "{id} status {status}, amount {amount}, order {order}, payment {payment}.",
    noAuthorizationDeclared: "No visible authorization is declared.",
    busDelivery: "Bus delivery",
    linkedObservations: "Linked observations",
    noEvidence: "No fault, timeout, authorization, or delivery observation has been recorded yet.",
    noStudentState: "No student-visible state is projected for this component.",
    runtimeFacts: "Runtime facts",
    processorFacts: "Declared visible authorizations. Provider counters stay hidden.",
    processorAuthorizationRow: (p: { id: string; status: string; amount: string; order: string }, _f: Fmt) =>
      `${p.id} status ${p.status}, amount ${p.amount}, order ${p.order}.`,
    clientFacts: "Client-observed checkout request and outcome.",
  },
};
