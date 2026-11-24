import type { Fmt } from "../format.ts";

type Departure = { time: number; sequence: number };
type Transit = { from: string; to?: string; departure?: Departure };

/** English source messages for the `playback` area (ADR-007): flight.ts, flight-playback.ts, and the replay wording. */
export const playback = {
  pace: {
    label: { slow: "Slow", steady: "Steady", fast: "Fast" },
    note: (p: { seconds: number }, f: Fmt) => `one milestone every ${f.number(p.seconds)} seconds`,
  },
  /**
   * One question per stored milestone type, keyed by the observation type code: the movements,
   * and the milestones that travel no link. A question, never an outcome claim.
   */
  pattern: {
    "network.request.sent": "The caller is waiting for an answer. What has the receiver recorded so far?",
    "network.request.delivered": "The request arrived. What work did the receiver start, and in which order?",
    "network.request.dropped": "The request never arrived. Which component can tell that, and which cannot?",
    "network.request.timedout": "The caller's deadline passed. What does the caller now know about the outcome?",
    "network.response.sent": "The responder produced an answer. Compare it with the effect recorded just before it.",
    "network.response.received": "The caller has an answer. Does it agree with the state the responder still holds?",
    "network.response.dropped": "The response was discarded. What will the caller do next, and what will the sender still believe?",
    "message.published": "The publisher no longer waits for a consumer. What does the MessageBus hold now?",
    "message.delivered": "A consumer received a copy of the message. Was this the first delivery attempt?",
    "message.acknowledged": "The delivery was acknowledged. What would a consumer do if the acknowledgement never arrived?",
    "message.ack.stale": "This acknowledgement does not match the recorded delivery state. Which attempt does it belong to?",
    "message.retry.scheduled": "The same message will be delivered again. Is the consumer's work safe to repeat?",
    "message.nacked": "The consumer rejected the delivery. When will the MessageBus deliver it again, if at all?",
    "message.dead": "The MessageBus stopped delivering this message. Who will look at it now?",
    "database.transaction.committed": "This change is now durable. Was the same change committed earlier in this run?",
    "database.transaction.rolledback": "The transaction rolled back. What did it undo, and which effects outside the database remain?",
    "database.transaction.rejected": "The database refused this transaction. Which stored condition did it fail, and who finds out?",
    "external.effect.committed": "This effect is visible outside the system and cannot be rolled back. Did the same effect happen before?",
    "service.handler.failed": "The handler failed. What had it changed before it failed, and what will try it again?",
    "kv.changed": "A key changed. Which readers still hold the previous value?",
    "kv.expired": "A key expired. What will the next reader of this key do?",
    "kv.read": "A key was read. Is the value it returned still the current one?",
    "kv.condition.failed": "The conditional write did not happen. Which value was there instead, and who wrote it?",
    "fault.rule.matched": "A fault rule matched this operation. Which component will notice the fault, and how?",
    "fault.effect.selected": "The fault chose its effect. What will each side of the operation record next?",
    "fault.applied": "The fault acted. Which later records would be different without it?",
    "runtime.log": "The service wrote down what it believes. Does it agree with the records around it?",
    "scenario.assertion.evaluated": "A lesson check was evaluated. Which records decide its result?",
  },
  patternFallback: "What does this record state, and what does it leave unknown?",
  /** Labels of stored data fields, keyed by the stored field name. */
  fieldLabel: {
    endpoint: "Endpoint",
    operation: "Recorded operation",
    deadline: "Deadline at virtual time",
    dueTime: "Retry due at virtual time",
    previousAttempt: "Retry of delivery attempt",
    status: "Stored status",
    late: "Stored late flag",
    reason: "Stored reason",
    ruleId: "Fault rule",
    attempt: "Delivery attempt",
    destination: "Destination",
    consumer: "Consumer",
    subscriber: "Subscriber",
    transactionId: "Transaction",
    messageId: "Message id",
    deliveryId: "Delivery id",
    routingId: "Routing id",
  },
  fact: {
    storedPayload: "Stored payload",
    redacted: "Redacted; not shown",
    omitted: "Omitted; not shown",
    transition: "Recorded transition",
    changedRows: "Recorded changed rows",
    messageType: "Message type",
    messageBodyFields: "Message body fields",
    bodyFields: "Stored body fields",
    externalChange: "Recorded external change",
  },
  relationship: {
    request: "Request link",
    publication: "MessageBus publication",
    subscription: "MessageBus subscription",
  },
  route: (p: { from: string; to?: string; relationship: string }, _f: Fmt) => p.to !== undefined
    ? `${p.from} → ${p.to} · ${p.relationship}`
    : `${p.from} · ${p.relationship}`,
  transit: {
    departure: (p: Transit, _f: Fmt) => p.to !== undefined
      ? `Departure: the token leaves ${p.from} and waits mid-link. A later record states whether it arrived at ${p.to}.`
      : `Departure: the token leaves ${p.from} and waits mid-link. A later record states whether it arrived at its destination.`,
    arrival: (p: Transit, _f: Fmt) => p.departure !== undefined
      ? (p.to !== undefined
        ? `Arrival: the token from the departure that left at virtual time ${p.departure.time} (observation #${p.departure.sequence}) reaches ${p.to}.`
        : `Arrival: the token from the departure that left at virtual time ${p.departure.time} (observation #${p.departure.sequence}) reaches its destination.`)
      : (p.to !== undefined
        ? `Arrival: the token reaches ${p.to}.`
        : "Arrival: the token reaches its destination."),
    interrupted: (p: Transit, _f: Fmt) => p.departure !== undefined
      ? (p.to !== undefined
        ? `Stopped: the trip that left at virtual time ${p.departure.time} (observation #${p.departure.sequence}) ends on the link and never reaches ${p.to}.`
        : `Stopped: the trip that left at virtual time ${p.departure.time} (observation #${p.departure.sequence}) ends on the link and never reaches its destination.`)
      : (p.to !== undefined
        ? `Stopped: the trip ends on the link and never reaches ${p.to}.`
        : "Stopped: the trip ends on the link and never reaches its destination."),
    timeout: (p: Transit, _f: Fmt) => p.departure !== undefined
      ? `Deadline: ${p.from} stops waiting for the request that left at virtual time ${p.departure.time} (observation #${p.departure.sequence}). Nothing travels; this is the caller's own record.`
      : `Deadline: ${p.from} stops waiting for the request. Nothing travels; this is the caller's own record.`,
    trip: (p: Transit, _f: Fmt) => p.to !== undefined
      ? `Trip: the token travels from ${p.from} to ${p.to} in one record.`
      : `Trip: the token travels from ${p.from} to its destination in one record.`,
  },
  /** The playhead's position (playhead.ts), stated beside the graph. */
  position: {
    unrun: "The run has not executed yet. Run or Step executes it.",
    none: "The run recorded no milestones.",
    start: (total: number, f: Fmt) => f.plural(total, {
      one: "Before the first record. The run recorded 1 milestone.",
      other: `Before the first record. The run recorded ${f.number(total)} milestones.`,
    }),
    current: (p: { index: number; total: number; time: number; sequence: number }, f: Fmt) =>
      `Milestone ${f.number(p.index)} of ${f.number(p.total)} · virtual time ${p.time} · observation #${p.sequence}.`,
    jump: (p: { from: number; to: number }, _f: Fmt) => `Virtual time jumped t=${p.from} → t=${p.to} with no recorded milestone in between.`,
  },
  /** Legend of the tokens painted on the graph, keyed by the token glyph. */
  legend: {
    REQ: { label: "Token: request", detail: "leaves the caller when sent, waits mid-link, and reaches the callee when delivered; its arrowhead points the way it travels" },
    RES: { label: "Token: response", detail: "leaves the callee when sent and reaches the caller when received; its arrowhead points the way it travels" },
    MSG: { label: "Token: message", detail: "travels from the publisher to the MessageBus, or from the MessageBus to a consumer" },
    ACK: { label: "Token: acknowledgement", detail: "travels from the consumer back to the MessageBus" },
    "⊘": { label: "Token: dropped", detail: "the record says this movement never arrived; the token stops on the link" },
    "◷": { label: "Token: timed out", detail: "the record says the caller's deadline passed; the token rests at the caller" },
  },
  /** The legend entry for a token that rests on its link (ArchitectureView.tsx). */
  legendInTransit: { label: "Token: still in transit", detail: "it left earlier, and no record up to this milestone says it arrived or was dropped; a number counts the ones waiting on the same link" },
  /** The playback settings above the graph (ArchitecturePlayback.tsx). UI state only: they never change the run. */
  settings: {
    group: "Playback settings",
    animation: "Animation",
    speed: "Speed",
    help: "Animation on: Run plays the recorded milestones one at a time at the chosen speed. Animation off: Run shows the end of the run at once, and Speed is unavailable. Neither setting changes the run.",
  },
  /** The narration of the painted movement (ArchitecturePlayback.tsx). */
  narration: {
    position: "Playhead position",
    region: "Recorded milestone",
    noFields: "This record stores no further fields for narration.",
    lookFor: "What to look for",
    details: "Recorded details",
    inTransitRoute: (p: { glyph: string; from: string; to?: string }, _f: Fmt) => p.to !== undefined ? `${p.glyph} ${p.from} → ${p.to}` : `${p.glyph} ${p.from}`,
    inTransit: (routes: readonly string[], f: Fmt) => `Still in transit: ${f.list(routes)}.`,
    inTransitMany: (count: number, f: Fmt) => `Still in transit: ${f.number(count)} other movements.`,
    trace: (id: string, _f: Fmt) => `Trace ${id}`,
    activityRegion: "Component activity",
    activityHeading: "Component activity at this record",
    allIdle: "Every component is idle at this record.",
    timeoutRests: "The token rests at the caller. This record states that the caller's deadline passed; it does not state whether the request or its response arrived.",
    interrupted: "The token stops on this link. This record states that the movement did not arrive; it does not state what either component concluded.",
    /** Where a milestone that travels no link is recorded. */
    recordAt: (component: string, _f: Fmt) => `At ${component}`,
    recordBySimulation: "Recorded by the simulation, at no component",
    /** The live-region sentence for a milestone that travels no link. */
    recordAnnouncement: (p: { label: string; component?: string; time: number }, _f: Fmt) => p.component !== undefined
      ? `${p.label} at ${p.component}, virtual time ${p.time}.`
      : `${p.label}, recorded by the simulation at virtual time ${p.time}.`,
    recordTransit: "Nothing travels: this record is painted on its component.",
  },
};
