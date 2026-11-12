import type { Fmt } from "../format.ts";

/** English source messages for the `faults` area (ADR-007): break-faults.ts. */
export const faults = {
  /** Labels for "<point>/<effect>" rule kinds. A kind with no entry falls back to `unknownRule`. */
  ruleLabels: {
    "network.request/delay": "Delay request",
    "network.request/drop": "Drop request",
    "network.request/disconnect": "Disconnect request",
    "network.response/delay": "Delay response",
    "network.response/drop": "Drop response",
    "message.delivery/delay": "Delay message delivery",
    "message.delivery/drop": "Drop message delivery",
    "message.delivery/duplicate": "Duplicate message delivery",
    "database.commit/fail": "Fail database commit",
  },
  unknownRule: (p: { effect: string; point: string }, _f: Fmt) => `${p.effect} at ${p.point}`,
  scheduledLabels: {
    crash: "Crash service",
    "external-availability": "Change external service availability",
  },
  /** Form field problems. The Faults section stores the code (`FieldError`), never this text. */
  errors: {
    chooseFault: "Choose a fault this lesson allows.",
    chooseTarget: "Choose a target.",
    wholeNumber: "Enter a whole number.",
    minimum: (minimum: number, f: Fmt) => `Enter ${f.number(minimum)} or more.`,
    chooseState: "Choose an availability state.",
    probability: "Enter a probability from 0 to 1.",
  },
  /** The chip text and graph mark label: one whole message per fact, joined by `describe.separator`. */
  describe: {
    separator: " · ",
    at: (time: number, _f: Fmt) => `at t=${time}`,
    becomes: (p: { target: string; state: string }, _f: Fmt) => `${p.target} becomes ${p.state}`,
    delayed: (p: { label: string; duration: number }, _f: Fmt) => `${p.label} by ${p.duration}`,
    duplicated: (p: { label: string; copies: number; spacing: number }, _f: Fmt) => `${p.label} ×${p.copies}, ${p.spacing} apart`,
    any: "any",
    anyDestination: "any destination",
    anyConsumer: "any consumer",
    database: (name: string, _f: Fmt) => `database ${name}`,
    anyDatabase: "database any",
    route: (p: { from: string; to: string }, _f: Fmt) => `${p.from} → ${p.to}`,
    routeNamed: (p: { from: string; to: string; name: string }, _f: Fmt) => `${p.from} → ${p.to} ${p.name}`,
    window: (p: { from: number; until: number }, _f: Fmt) => `t=${p.from}–${p.until}`,
    from: (time: number, _f: Fmt) => `from t=${time}`,
    occurrence: (n: number, f: Fmt) => `occurrence ${f.number(n)}`,
    times: (n: number, f: Fmt) => `up to ${f.number(n)}×`,
    probability: (probability: number, f: Fmt) => `probability ${f.number(probability, { maximumFractionDigits: 20 })}, uses the session seed`,
  },
  /** Worker diagnostics on a draft entry, by code. The code stays visible after the text. */
  diagnostics: {
    OVERLAY_NOT_ALLOWED: "This lesson does not allow this fault.",
    OVERLAY_ID_PREFIX: "Student fault IDs must start with student-.",
    OVERLAY_LIMIT: "This lesson allows fewer faults. Remove one.",
    FAULT: "This value breaks a fault rule: check the time window, counts, and overlapping duplicate rules.",
    BEFORE_START: "This time is before the lesson starts.",
    DUPLICATE: "Another fault already uses this ID.",
    UNKNOWN_COMPONENT: "This component is not part of the lesson.",
    REFERENCE: "This target does not exist in the lesson.",
    TYPE: "This value has the wrong type.",
    TIME: "This is not a valid virtual time.",
    REQUIRED: "This value is required.",
    UNSUPPORTED: "This field is not supported.",
    STATE: "This state is not supported.",
  },
  diagnosticUnknown: "This value is not valid.",
  withCode: (p: { text: string; code: string }, _f: Fmt) => `${p.text} (${p.code})`,
  general: (p: { path: string; message: string }, _f: Fmt) => `${p.path || "/"}: ${p.message}`,
  /** What Compare dropped, as it appears in the carry notice. */
  dropped: {
    slot: (component: string, _f: Fmt) => `${component} slot`,
    binding: (p: { component: string; peer: string }, _f: Fmt) => `${p.component}.${p.peer} binding`,
    resource: (p: { owner: string; resource: string }, _f: Fmt) => `${p.owner} ${p.resource}`,
    subscription: (p: { consumer: string; destination: string }, _f: Fmt) => `${p.consumer} subscription to ${p.destination}`,
  },
};
