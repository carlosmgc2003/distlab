import type { Fmt } from "../format.ts";

type Departure = { time: number; sequence: number };
type Transit = { from: string; to?: string; departure?: Departure };

/** English source messages for the `playback` area (ADR-007): flight.ts, flight-playback.ts, and the replay wording. */
export const playback = {
  pace: {
    label: { slow: "Slow", steady: "Steady", fast: "Fast" },
    note: (p: { seconds: number }, f: Fmt) => `one movement every ${f.number(p.seconds)} seconds`,
  },
  /** One question per stored movement type, keyed by the observation type code. */
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
  position: {
    none: "No recorded movements to replay.",
    noneDetail: "Run the scenario, or open Recorded history and select a record.",
    nothingSelected: (total: number, f: Fmt) => f.plural(total, {
      one: "0 of 1 recorded movement. Nothing selected.",
      other: `0 of ${f.number(total)} recorded movements. Nothing selected.`,
    }),
    current: (p: { index: number; total: number; time: number; sequence: number }, f: Fmt) =>
      `Movement ${f.number(p.index)} of ${f.number(p.total)} · virtual time ${p.time} · observation #${p.sequence}.`,
    atLast: "At the last recorded movement. Playback waits for the run to record more.",
    jump: (p: { from: number; to: number }, _f: Fmt) => `Virtual time jumped t=${p.from} → t=${p.to} with no recorded movement in between.`,
    sameTime: (p: { total: number; time: number }, f: Fmt) => f.plural(p.total, {
      one: `The 1 recorded movement is at virtual time ${p.time}.`,
      other: `All ${f.number(p.total)} recorded movements are at virtual time ${p.time}.`,
    }),
    boundaries: (p: { total: number; boundaries: number; from: number; to: number }, f: Fmt) =>
      `${f.number(p.total)} recorded movements across ${f.number(p.boundaries)} recorded virtual-time boundaries, from t=${p.from} to t=${p.to}. Rules mark boundaries only; no duration is stored.`,
  },
  control: {
    play: "Play replay",
    restart: "Restart replay",
    pause: "Pause replay",
    playing: "Playing the visible timeline. Pause stops the cursor.",
    noObservations: "No visible observations to play.",
    atEnd: "At the end of the visible results. Restart replay plays from the first visible observation.",
    fromStart: "Play replay starts at the first visible observation.",
    fromSelected: "Play replay continues from the selected observation.",
    paused: "Playback is paused.",
    ended: "Playback reached the end of the visible results. Restart replay plays from the first visible observation.",
    recording: "Playing recorded movements. The cursor waits at the end while the run records more.",
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
  /** The Replay toolbar (ArchitecturePlayback.tsx). */
  toolbar: {
    label: "Replay",
    group: "Replay recorded movements",
    previous: "Previous movement",
    next: "Next movement",
    speed: "Speed",
    help: "These controls move a browser cursor over movements the run has already recorded. They send no simulation command, do not change virtual time, and do not record observations. From the keyboard, Left arrow and Right arrow move one movement, and Space plays or pauses.",
  },
  /** The narration of the painted movement (ArchitecturePlayback.tsx). */
  narration: {
    position: "Architecture playback position",
    region: "Recorded movement",
    noFields: "This record stores no further fields for narration.",
    lookFor: "What to look for",
    details: "Recorded details",
    trace: (id: string, _f: Fmt) => `Trace ${id}`,
    activityRegion: "Component activity",
    activityHeading: "Component activity at this record",
    allIdle: "Every component is idle at this record.",
    timeoutRests: "The token rests at the caller. This record states that the caller's deadline passed; it does not state whether the request or its response arrived.",
    interrupted: "The token stops on this link. This record states that the movement did not arrive; it does not state what either component concluded.",
  },
};
