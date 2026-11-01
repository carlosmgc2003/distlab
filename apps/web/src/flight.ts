import type { CanonicalValue, Observation, SimulationTime } from "@distlab/contracts";
import {
  bodyFields,
  edgeDirection,
  edgeFor,
  externalChanges,
  movementOf,
  orderObservations,
  payloadVisibility,
  recordedChanges,
  storedFieldsAt,
  storedScalar,
  storedScalarAt,
} from "./records.ts";
import type { Movement, MovementEdge } from "./records.ts";
import { recordLabel, selectionStep } from "./timeline.ts";

/**
 * Presentation-only reading of recorded movements. Every value here is copied
 * from a stored observation field. Nothing is inferred, and no simulation state
 * is read, allocated, or changed by this module.
 */

/** How long the browser paints one recorded movement. Presentation only: it never changes virtual time. */
export const FLIGHT_PACES = [
  { id: "slow", label: "Slow", delayMs: 1800, note: "one movement every 1.8 seconds" },
  { id: "steady", label: "Steady", delayMs: 900, note: "one movement every 0.9 seconds" },
  { id: "fast", label: "Fast", delayMs: 350, note: "one movement every 0.35 seconds" },
] as const;

export type FlightPace = (typeof FLIGHT_PACES)[number]["id"];
export const DEFAULT_FLIGHT_PACE: FlightPace = "slow";

export function flightPace(pace: FlightPace): (typeof FLIGHT_PACES)[number] {
  return FLIGHT_PACES.find(item => item.id === pace) ?? FLIGHT_PACES[0];
}

/** Milliseconds the host timer waits before painting the next recorded movement. */
export function flightDelayMs(pace: FlightPace): number {
  return flightPace(pace).delayMs;
}

/**
 * Direction-neutral token text. The direction of travel is carried by a
 * separate heading mark that turns with the link path, so no glyph can point
 * against the motion.
 */
export type FlightGlyph = "REQ" | "RES" | "MSG" | "ACK" | "⊘" | "◷";
/**
 * The part of one hop a record paints. A network hop is two records: `*.sent`
 * departs and stops mid-link, `*.delivered` or `*.received` arrives, so one
 * request or response crosses its link once. A drop stops on the link past the
 * middle. A MessageBus record is a whole trip on its own. A timeout travels
 * nowhere: it is the caller's deadline, painted at the caller's end.
 */
export type FlightLeg = "departure" | "arrival" | "interrupted" | "trip" | "timeout";
/** Outline shape carries the same meaning as the movement glyph, without color. */
export type FlightShape = "solid" | "dashed" | "dotted";

export interface FlightFact {
  readonly label: string;
  readonly value: string;
}

export interface FlightStep {
  readonly observationId: string;
  readonly sequence: number;
  readonly time: SimulationTime;
  readonly kind: Movement["kind"];
  readonly relationship: MovementEdge["relationship"];
  readonly edgeId?: string;
  readonly nodeIds: readonly string[];
  readonly from: string;
  readonly to?: string;
  /** Stored plain-language label for the record type. */
  readonly headline: string;
  /** One sentence for the live region: stored label, stored route, stored virtual time. */
  readonly announcement: string;
  /** Route as a link label, including the presentation relationship of the link. */
  readonly route: string;
  readonly traceId?: string;
  readonly facts: readonly FlightFact[];
  /** A question about the pattern this record belongs to. Never an outcome claim. */
  readonly pattern: string;
  readonly glyph: FlightGlyph;
  readonly shape: FlightShape;
  /** True for a recorded drop or timeout: the token stops on the link instead of arriving. */
  readonly interrupted: boolean;
  readonly leg: FlightLeg;
  /**
   * Where the token starts and stops, as a share of the link measured from
   * `from` toward `to`. Presentation only: no duration or latency is implied.
   */
  readonly span: { readonly start: number; readonly end: number };
  /** True when the movement runs against the drawn link, from its target to its source. */
  readonly reversed: boolean;
  /** True when the token carries a heading mark: everything except a timeout travels. */
  readonly heading: boolean;
  /** Stored id that pairs the legs of one network hop, when the payload stores one. */
  readonly hopId?: string;
  /** For an arrival, drop, or timeout: the departure record of the same hop, when it is recorded earlier. */
  readonly departure?: { readonly observationId: string; readonly sequence: number; readonly time: SimulationTime };
  /** One sentence naming the part of the trip this record paints. */
  readonly transit: string;
}

const PATTERNS: Readonly<Record<string, string>> = {
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
};

const PATTERN_FALLBACK = "What does this record state, and what does it leave unknown?";

/** Stored data fields worth naming in the narration, in reading order. Values are printed as stored. */
const FIELD_LABELS: readonly (readonly [string, string])[] = [
  ["endpoint", "Endpoint"],
  ["operation", "Recorded operation"],
  ["deadline", "Deadline at virtual time"],
  ["dueTime", "Retry due at virtual time"],
  ["previousAttempt", "Retry of delivery attempt"],
  ["status", "Stored status"],
  ["late", "Stored late flag"],
  ["reason", "Stored reason"],
  ["ruleId", "Fault rule"],
  ["attempt", "Delivery attempt"],
  ["destination", "Destination"],
  ["consumer", "Consumer"],
  ["subscriber", "Subscriber"],
  ["transactionId", "Transaction"],
  ["messageId", "Message id"],
  ["deliveryId", "Delivery id"],
  ["routingId", "Routing id"],
];

const INTERRUPTED_TYPES = new Set([
  "network.request.dropped",
  "network.request.timedout",
  "network.response.dropped",
]);


/**
 * Stored fields for the narration. A redacted or omitted payload contributes
 * one visibility statement and nothing else: it is never reconstructed.
 */
export function flightFacts(observation: Observation): readonly FlightFact[] {
  const visibility = payloadVisibility(observation);
  if (visibility !== "omitted" && visibility !== "redacted" && visibility !== "visible") return [];
  if (visibility !== "visible") {
    return [{ label: "Stored payload", value: visibility === "redacted" ? "Redacted; not shown" : "Omitted; not shown" }];
  }
  const facts: FlightFact[] = [];
  for (const [key, label] of FIELD_LABELS) {
    const value = storedScalar(observation, key);
    if (value !== undefined) facts.push({ label, value });
  }
  const changes = recordedChanges(observation);
  const before = changes.find(change => change.before !== undefined)?.before;
  const after = changes.find(change => change.after !== undefined)?.after;
  if (before !== undefined && after !== undefined) facts.push({ label: "Recorded transition", value: `${before} \u2192 ${after}` });
  const rows = changes.flatMap(change => change.table !== undefined && change.key !== undefined ? [`${change.table}/${change.key}`] : []);
  if (rows.length > 0) facts.push({ label: "Recorded changed rows", value: rows.join(", ") });
  const messageType = storedScalarAt(observation, ["message", "type"]);
  if (messageType !== undefined) facts.push({ label: "Message type", value: messageType });
  const messageFields = storedFieldsAt(observation, ["message", "body"]);
  if (messageFields !== undefined) facts.push({ label: "Message body fields", value: messageFields });
  const body = bodyFields(observation, "body");
  if (body !== undefined) facts.push({ label: "Stored body fields", value: body });
  const external = externalChanges(observation, "visibleChanges");
  if (external.length > 0) facts.push({ label: "Recorded external change", value: external.join(", ") });
  return facts;
}

const RELATIONSHIP_LABELS = {
  request: "Request link",
  publication: "MessageBus publication",
  subscription: "MessageBus subscription",
} as const satisfies Record<MovementEdge["relationship"], string>;

function glyphOf(observation: Observation, kind: Movement["kind"]): FlightGlyph {
  if (observation.type === "network.request.timedout") return "◷";
  if (observation.type === "network.request.dropped" || observation.type === "network.response.dropped") return "⊘";
  if (observation.type === "message.acknowledged") return "ACK";
  if (kind === "request") return "REQ";
  if (kind === "response") return "RES";
  return "MSG";
}

const DEPARTURE_TYPES = new Set(["network.request.sent", "network.response.sent"]);
const ARRIVAL_TYPES = new Set(["network.request.delivered", "network.response.received"]);

function legOf(observation: Observation): FlightLeg {
  if (observation.type === "network.request.timedout") return "timeout";
  if (INTERRUPTED_TYPES.has(observation.type)) return "interrupted";
  if (DEPARTURE_TYPES.has(observation.type)) return "departure";
  if (ARRIVAL_TYPES.has(observation.type)) return "arrival";
  return "trip";
}

/** Share of the link each leg paints, from `from` toward `to`. Together the two legs of a hop cross it once. */
const LEG_SPANS = {
  departure: { start: 0, end: 50 },
  arrival: { start: 50, end: 100 },
  interrupted: { start: 50, end: 64 },
  trip: { start: 0, end: 100 },
  timeout: { start: 8, end: 8 },
} as const satisfies Record<FlightLeg, { readonly start: number; readonly end: number }>;

/** The stored id that pairs the legs of one network hop: the request and its response share it. */
function hopKey(observation: Observation, kind: Movement["kind"]): string | undefined {
  if (kind === "message") return undefined;
  const requestId = storedScalar(observation, "requestId");
  return requestId === undefined ? undefined : `${kind}:${requestId}`;
}

function transitText(leg: FlightLeg, movement: Movement, departure: FlightStep["departure"]): string {
  const to = movement.to ?? "its destination";
  const left = departure !== undefined ? ` that left at virtual time ${departure.time} (observation #${departure.sequence})` : "";
  switch (leg) {
    case "departure":
      return `Departure: the token leaves ${movement.from} and waits mid-link. A later record states whether it arrived at ${to}.`;
    case "arrival":
      return `Arrival: the token${left ? ` from the departure${left}` : ""} reaches ${to}.`;
    case "interrupted":
      return `Stopped: the trip${left} ends on the link and never reaches ${to}.`;
    case "timeout":
      return `Deadline: ${movement.from} stops waiting for the request${left}. Nothing travels; this is the caller's own record.`;
    case "trip":
      return `Trip: the token travels from ${movement.from} to ${to} in one record.`;
  }
}

function shapeOf(observation: Observation, relationship: MovementEdge["relationship"]): FlightShape {
  if (INTERRUPTED_TYPES.has(observation.type)) return "dotted";
  if (relationship === "publication") return "dotted";
  if (relationship === "subscription") return "dashed";
  return "solid";
}

/**
 * One recorded movement, ready to animate. Reads stored fields and presentation
 * link identity only. `departure` names the earlier record of the same hop, when
 * the caller has paired one.
 */
export function flightStep(
  observation: Observation,
  movement: Movement,
  edges: readonly MovementEdge[],
  departure?: FlightStep["departure"],
): FlightStep {
  const edge = edgeFor(movement, edges);
  const leg = legOf(observation);
  const hopId = hopKey(observation, movement.kind);
  const relationship = movement.relationship;
  const from = movement.from;
  const to = movement.to;
  const nodeIds = to !== undefined ? [from, to] : [from];
  const route = to !== undefined
    ? `${from} → ${to} · ${RELATIONSHIP_LABELS[relationship]}`
    : `${from} · ${RELATIONSHIP_LABELS[relationship]}`;
  const where = to !== undefined ? `from ${from} to ${to}` : `at ${from}`;
  return {
    observationId: movement.observationId,
    sequence: observation.sequence,
    time: observation.time,
    kind: movement.kind,
    relationship,
    ...(edge !== undefined ? { edgeId: edge.id } : {}),
    nodeIds,
    from,
    ...(to !== undefined ? { to } : {}),
    headline: recordLabel(observation),
    announcement: movement.text,
    route,
    ...(observation.traceId !== undefined ? { traceId: observation.traceId } : {}),
    facts: flightFacts(observation),
    pattern: PATTERNS[observation.type] ?? PATTERN_FALLBACK,
    glyph: glyphOf(observation, movement.kind),
    shape: shapeOf(observation, relationship),
    interrupted: INTERRUPTED_TYPES.has(observation.type),
    leg,
    span: LEG_SPANS[leg],
    reversed: edge !== undefined && edgeDirection(movement, edge) === "reverse",
    heading: leg !== "timeout",
    ...(hopId !== undefined ? { hopId } : {}),
    ...(departure !== undefined && leg !== "departure" && leg !== "trip" ? { departure } : {}),
    transit: transitText(leg, movement, leg !== "departure" && leg !== "trip" ? departure : undefined),
  };
}

/**
 * Every recorded movement in canonical order. A record that travels no link is
 * not a movement and stays in Recorded history; nothing is merged or reordered.
 */
export function flightSteps(observations: readonly Observation[], edges: readonly MovementEdge[]): readonly FlightStep[] {
  const steps: FlightStep[] = [];
  // Departures seen so far, by hop id. Only earlier records pair: nothing is read ahead of a step.
  const departures = new Map<string, NonNullable<FlightStep["departure"]>>();
  for (const observation of orderObservations(observations)) {
    const movement = movementOf(observation);
    if (!movement) continue;
    const hop = hopKey(observation, movement.kind);
    // An arrival, a drop, and a timeout share the stored request id of the departure they end.
    const departure = hop !== undefined ? departures.get(hop) : undefined;
    const step = flightStep(observation, movement, edges, departure);
    if (step.leg === "departure" && hop !== undefined) {
      departures.set(hop, { observationId: step.observationId, sequence: step.sequence, time: step.time });
    }
    steps.push(step);
  }
  return steps;
}

/** Index of the step for one recorded observation, or -1 when it travels no link. */
export function flightIndexOf(steps: readonly FlightStep[], observationId: string | null): number {
  if (observationId === null) return -1;
  return steps.findIndex(step => step.observationId === observationId);
}

export interface FlightPosition {
  readonly text: string;
  readonly detail: string;
  /**
   * Set when virtual time advanced since the previous movement. It names the two
   * recorded times only: playback never paints the interval as a duration.
   */
  readonly jump?: string;
}

/** Stated once for the playback cursor. Milestone position, virtual time, and the record's own facts. */
export function flightPosition(steps: readonly FlightStep[], cursor: number): FlightPosition {
  const total = steps.length;
  if (total === 0) return { text: "No recorded movements to replay.", detail: "Run the scenario, or open Recorded history and select a record." };
  if (cursor < 0) return { text: `0 of ${total} recorded movements. Nothing selected.`, detail: boundaryDetail(steps) };
  const index = Math.min(cursor, total - 1);
  const step = steps[index]!;
  const jump = flightJump(steps, index);
  return {
    text: `Movement ${index + 1} of ${total} · virtual time ${step.time} · observation #${step.sequence}.`,
    detail: index >= total - 1 ? "At the last recorded movement. Playback waits for the run to record more." : boundaryDetail(steps),
    ...(jump !== undefined ? { jump } : {}),
  };
}

/** The virtual-time jump into this movement from the previous one, or undefined when time did not advance. */
export function flightJump(steps: readonly FlightStep[], index: number): string | undefined {
  const step = steps[index];
  const previous = index > 0 ? steps[index - 1] : undefined;
  if (step === undefined || previous === undefined || step.time <= previous.time) return undefined;
  return `Virtual time jumped t=${previous.time} → t=${step.time} with no recorded movement in between.`;
}

/** Recorded virtual-time boundaries of the movement list. No duration or latency is implied. */
export function flightBoundaries(steps: readonly FlightStep[]): readonly SimulationTime[] {
  const times: SimulationTime[] = [];
  for (const step of steps) if (step.time !== times.at(-1)) times.push(step.time);
  return times;
}

function boundaryDetail(steps: readonly FlightStep[]): string {
  const times = flightBoundaries(steps);
  if (times.length === 0) return "";
  return times.length === 1
    ? `All ${steps.length} recorded movements are at virtual time ${times[0]}.`
    : `${steps.length} recorded movements across ${times.length} recorded virtual-time boundaries, from t=${times[0]} to t=${times.at(-1)}. Rules mark boundaries only; no duration is stored.`;
}

export type PlaybackPhase = "idle" | "playing" | "paused" | "ended";

export interface PlaybackControl {
  readonly action: "play" | "restart" | "unavailable";
  readonly label: "Play timeline" | "Restart timeline";
  readonly reason: string;
}

/** Play, pause, and restart describe the cursor. They do not rewind the simulation. */
export function playbackControl(index: number, count: number, playing: boolean): PlaybackControl {
  if (playing) {
    return {
      action: "unavailable",
      label: "Play timeline",
      reason: "Playing the visible timeline. Pause stops the cursor.",
    };
  }
  if (count <= 0) return { action: "unavailable", label: "Play timeline", reason: "No visible observations to play." };
  if (count === 1) return { action: "unavailable", label: "Play timeline", reason: "Only one visible observation. Playback cannot advance." };
  if (index >= 0 && index >= count - 1) {
    return {
      action: "restart",
      label: "Restart timeline",
      reason: "At the end of the visible results. Restart timeline plays from the first visible observation.",
    };
  }
  if (index < 0) return { action: "play", label: "Play timeline", reason: "Play timeline starts at the first visible observation." };
  return { action: "play", label: "Play timeline", reason: "Play timeline continues from the selected observation." };
}

export function playbackStatus(phase: PlaybackPhase, control: PlaybackControl): string {
  if (phase === "playing") return "Playing the visible timeline. Pause stops the cursor.";
  if (phase === "paused") return "Playback is paused.";
  if (phase === "ended") return "Playback reached the end of the visible results. Restart timeline plays from the first visible observation.";
  return control.reason;
}

export interface FlightAdvance {
  readonly cursor: number;
  readonly phase: PlaybackPhase;
  /** True when the host timer should schedule the next paint. */
  readonly waiting: boolean;
}

/**
 * Moves the playback cursor within an already recorded movement list.
 * While the run is still recording, the cursor waits at the end for the next
 * record instead of stopping. The cursor never re-executes anything.
 */
export function flightAdvance(cursor: number, count: number, phase: PlaybackPhase, recording: boolean): FlightAdvance {
  if (count === 0) return { cursor: -1, phase: "idle", waiting: false };
  if (phase !== "playing") return { cursor: Math.min(Math.max(cursor, 0), count - 1), phase, waiting: false };
  if (cursor >= count - 1) {
    // At the recorded end: keep waiting only while the simulation is still recording.
    return recording
      ? { cursor: count - 1, phase: "playing", waiting: true }
      : { cursor: count - 1, phase: "ended", waiting: false };
  }
  return { cursor: cursor + 1, phase: "playing", waiting: false };
}

export interface FlightTransport {
  readonly control: PlaybackControl;
  readonly pauseLabel: "Pause timeline";
  readonly status: string;
  readonly reason: string;
  readonly previous: boolean;
  readonly next: boolean;
}

/** Play, pause, restart, and the two step directions over recorded movements. */
export function flightTransport(cursor: number, count: number, phase: PlaybackPhase, recording: boolean): FlightTransport {
  const playing = phase === "playing";
  const control = playbackControl(cursor, count, playing);
  const steps = selectionAvailability(cursor, count);
  return {
    control,
    pauseLabel: "Pause timeline",
    status: playbackStatus(phase, control),
    reason: recording && playing
      ? "Playing recorded movements. The cursor waits at the end while the run records more."
      : control.reason,
    previous: steps.previous,
    next: steps.next,
  };
}

function selectionAvailability(index: number, count: number): { readonly previous: boolean; readonly next: boolean } {
  return { previous: selectionStep(index, count, -1) !== null, next: selectionStep(index, count, 1) !== null };
}

export interface FlightLegendEntry {
  readonly glyph: FlightGlyph;
  readonly shape: FlightShape;
  readonly label: string;
  /** The full statement, read after the short legend label. */
  readonly detail: string;
}

/** Legend of the tokens painted on the architecture graph. Text and shape carry the meaning. */
export const FLIGHT_LEGEND: readonly FlightLegendEntry[] = [
  { glyph: "REQ", shape: "solid", label: "Token: request", detail: "leaves the caller when sent, waits mid-link, and reaches the callee when delivered; its arrowhead points the way it travels" },
  { glyph: "RES", shape: "solid", label: "Token: response", detail: "leaves the callee when sent and reaches the caller when received; its arrowhead points the way it travels" },
  { glyph: "MSG", shape: "dashed", label: "Token: message", detail: "travels from the publisher to the MessageBus, or from the MessageBus to a consumer" },
  { glyph: "ACK", shape: "dashed", label: "Token: acknowledgement", detail: "travels from the consumer back to the MessageBus" },
  { glyph: "⊘", shape: "dotted", label: "Token: dropped", detail: "the record says this movement never arrived; the token stops on the link" },
  { glyph: "◷", shape: "dotted", label: "Token: timed out", detail: "the record says the caller's deadline passed; the token rests at the caller" },
];

/** Where a token stops, as a share of the link measured from the movement's own origin. */
export function flightStop(step: FlightStep): string {
  return `${step.span.end}%`;
}
