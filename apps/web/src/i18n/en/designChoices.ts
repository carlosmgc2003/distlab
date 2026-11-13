import type { Fmt } from "../format.ts";

/** English source messages for the `designChoices` area (ADR-007): design-choices.ts and design-step.ts. */
export const designChoices = {
  /** Copy by parameter key: the label, and one line on what the switch changes (it makes no claim about the outcome). */
  choices: {
    idempotency: { label: "Idempotency key", hint: "Payments stores each result by idempotency key and returns it for a repeated key." },
    timeout: { label: "Client timeout", hint: "Virtual time the client waits for a Payments response before it gives up or retries." },
    compensation: { label: "Compensation", hint: "Orders undoes completed saga steps when a later step fails." },
    outbox: { label: "Transactional outbox", hint: "Payments records the event in the same commit as the payment and publishes it later." },
    "consumer-idempotency": { label: "Idempotent consumer", hint: "Notifications records each event ID in an inbox and skips one it has seen." },
    "circuit-breaker": { label: "Circuit breaker", hint: "Payments stops calling the risk provider after repeated failures and probes it later." },
    "decoupled-confirmation": { label: "Confirm before notifying", hint: "Orders confirms the order at checkout instead of waiting for NotificationSent." },
    "max-attempts": { label: "Notification delivery attempts", hint: "How many times the bus delivers OrderPlaced before it moves the message to the dead-letter queue." },
    "optimistic-concurrency": { label: "Optimistic concurrency", hint: "Inventory checks the stock and writes the reservation in one transaction, so the database rejects a commit whose stock version changed since it was read." },
    fencing: { label: "Fencing tokens", hint: "Storage remembers the largest lease token it has accepted for a file and rejects a write that carries a smaller one." },
    "lease-ttl": { label: "Lease duration", hint: "The TTL each worker sets on the lease key. The key-value store removes the key when it ends, and another worker can then take the lease." },
    "logical-clock": { label: "Lamport clocks", hint: "Both regions stamp edits with a Lamport counter instead of their wall clocks." },
    "delivery-delay": { label: "Event delivery delay", hint: "How long the MessageBus takes to deliver OrderUpdated to Reporting." },
    "clock-skew": { label: "Clock skew in eu", hint: "How far region eu's wall clock runs ahead of virtual time (negative: behind)." },
    "cache-invalidation": { label: "Invalidate cache on price change", hint: "Catalog deletes the cached price when the back office changes it, instead of letting it live until its TTL ends." },
    "price-ttl": { label: "Cached price lifetime", hint: "The TTL Catalog sets on a price it caches. The key-value store removes the entry when it ends, and the next read takes the price from the database." },
  },
  /** Copy for a lesson (by packaged scenario name) where a key means something different there. */
  lessonChoices: {
    "reliable-checkout@1": {
      retries: { label: "Payment retries", hint: "How many times Payments repeats an authorization that timed out." },
      idempotency: { label: "Idempotency key", hint: "Payments sends the order ID as an idempotency key; the processor answers a repeated key with the authorization it already holds." },
      compensation: { label: "Compensation", hint: "Orders voids the payment and releases the inventory when a checkout step fails, then cancels the order." },
      outbox: { label: "Transactional outbox", hint: "Orders records OrderConfirmed in the same commit as the confirmation and publishes it from a later relay." },
    },
  },
  on: "on",
  off: "off",
  /** Between the `key=value` facts of the run header. */
  separator: " · ",
  /** A problem with a typed value. The section stores the code (`ChoiceError`), never this text. */
  errors: {
    notNumber: "This choice is not a number.",
    range: (p: { minimum: number; maximum: number }, f: Fmt) => `Enter a whole number from ${f.number(p.minimum)} to ${f.number(p.maximum)}.`,
  },
  /** Worker diagnostics under /parameters, by code. The code stays visible after the text. */
  diagnostics: {
    UNKNOWN_PARAMETER: "This lesson does not offer this choice.",
    PARAMETER_VALUE: "This value is outside the allowed range.",
    DUPLICATE: "This choice appears twice.",
    REQUIRED: "This value is required.",
    TYPE: "This value has the wrong type.",
  },
  diagnosticUnknown: "This value is not valid.",
  withCode: (p: { text: string; code: string }, _f: Fmt) => `${p.text} (${p.code})`,
  emptySlot: {
    label: "Empty slot",
    description: "No model fills this component yet. It receives, publishes, and stores nothing, and answers any request with NOT_IMPLEMENTED.",
  },
  /** The Design choices section (DesignChoicesSection.tsx). */
  section: {
    title: "Design choices",
    help: "Business invariants report what your choices achieve. The setup checks still describe the packaged lesson, so one can read \"not reproduced\" under your choices. That shows how your change altered the story, not a simulator error.",
    lessonDefault: (value: string, _f: Fmt) => `Lesson default: ${value}.`,
  },
};
