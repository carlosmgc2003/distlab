import type { CanonicalValue, Observation, SimulationTime } from "@distlab/contracts";
import {
  learningSummary,
  movementCue,
  orderObservations,
  payloadVisibility,
  playbackControl,
  playbackStatus,
  selectionStep,
} from "./timeline.ts";
import type { MovementCue, MovementEdge, PlaybackControl, PlaybackPhase } from "./timeline.ts";

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

export type FlightGlyph = "→" | "←" | "⇢" | "⊘" | "◷";
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
  readonly kind: MovementCue["kind"];
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

function isRecord(value: CanonicalValue | undefined): value is Record<string, CanonicalValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scalar(value: CanonicalValue): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function field(record: Record<string, CanonicalValue>, key: string): CanonicalValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function storedField(record: Record<string, CanonicalValue>, key: string): string | undefined {
  const value = field(record, key);
  return value === undefined ? undefined : scalar(value);
}

/** Field names only. Stored values stay in the technical record, so narration never restates a payload. */
function bodyFields(value: CanonicalValue | undefined): string | undefined {
  if (!isRecord(value)) return undefined;
  const names = Object.keys(value);
  return names.length > 0 ? names.join(", ") : undefined;
}

function changeRows(data: Record<string, CanonicalValue>): string | undefined {
  const changes = field(data, "changes");
  if (!Array.isArray(changes)) return undefined;
  const names = changes.flatMap(item => {
    if (!isRecord(item)) return [];
    const table = storedField(item, "table");
    const key = storedField(item, "key");
    return table !== undefined && key !== undefined ? [`${table}/${key}`] : [];
  });
  return names.length > 0 ? names.join(", ") : undefined;
}

/** Reads the stored external change list. Values are the stored ids and statuses, nothing else. */
function externalChange(value: CanonicalValue | undefined): string | undefined {
  if (!isRecord(value)) return undefined;
  const parts: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!Array.isArray(entry)) continue;
    for (const item of entry) {
      if (!isRecord(item)) continue;
      const id = storedField(item, "authorizationId") ?? storedField(item, "paymentId")
        ?? storedField(item, "operationId") ?? storedField(item, "id");
      const status = storedField(item, "status") ?? storedField(item, "state");
      if (id !== undefined && status !== undefined) parts.push(`${id} ${status}`);
      else if (id !== undefined) parts.push(id);
    }
    if (parts.length === 0) continue;
    return `${key}: ${parts.join(", ")}`;
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Stored fields for the narration. A redacted or omitted payload contributes
 * one visibility statement and nothing else: it is never reconstructed.
 */
export function flightFacts(observation: Observation): readonly FlightFact[] {
  const visibility = payloadVisibility(observation);
  if (visibility !== "visible") {
    return [{ label: "Stored payload", value: visibility === "redacted" ? "Redacted; not shown" : "Omitted; not shown" }];
  }
  if (!Object.hasOwn(observation, "data") || !isRecord(observation.data)) return [];
  const data = observation.data;
  const facts: FlightFact[] = [];
  for (const [key, label] of FIELD_LABELS) {
    const value = storedField(data, key);
    if (value !== undefined) facts.push({ label, value });
  }
  const before = storedField(data, "before");
  const after = storedField(data, "after");
  if (before !== undefined && after !== undefined) facts.push({ label: "Recorded transition", value: `${before} → ${after}` });
  const rows = changeRows(data);
  if (rows !== undefined) facts.push({ label: "Recorded changed rows", value: rows });
  const message = field(data, "message");
  if (isRecord(message)) {
    const type = storedField(message, "type");
    if (type !== undefined) facts.push({ label: "Message type", value: type });
    const fields = bodyFields(field(message, "body"));
    if (fields !== undefined) facts.push({ label: "Message body fields", value: fields });
  }
  const body = bodyFields(field(data, "body"));
  if (body !== undefined) facts.push({ label: "Stored body fields", value: body });
  const change = externalChange(field(data, "visibleChanges"));
  if (change !== undefined) facts.push({ label: "Recorded external change", value: change });
  if (field(data, "redacted") === true) facts.push({ label: "Stored payload", value: "Redacted; not shown" });
  return facts;
}

function relationshipOf(cue: MovementCue, edges: readonly MovementEdge[]): MovementEdge["relationship"] {
  return edges.find(edge => edge.id === cue.edgeId)?.relationship ?? "request";
}

const RELATIONSHIP_LABELS = {
  request: "Request link",
  publication: "MessageBus publication",
  subscription: "MessageBus subscription",
} as const satisfies Record<MovementEdge["relationship"], string>;

function glyphOf(observation: Observation, kind: MovementCue["kind"]): FlightGlyph {
  if (observation.type === "network.request.timedout") return "◷";
  if (observation.type === "network.request.dropped" || observation.type === "network.response.dropped") return "⊘";
  if (kind === "request") return "→";
  if (kind === "response") return "←";
  return "⇢";
}

function shapeOf(observation: Observation, relationship: MovementEdge["relationship"]): FlightShape {
  if (INTERRUPTED_TYPES.has(observation.type)) return "dotted";
  if (relationship === "publication") return "dotted";
  if (relationship === "subscription") return "dashed";
  return "solid";
}

/** One recorded movement, ready to animate. Reads stored fields and presentation link identity only. */
export function flightStep(observation: Observation, cue: MovementCue, edges: readonly MovementEdge[]): FlightStep {
  const relationship = relationshipOf(cue, edges);
  const from = cue.nodeIds[0] ?? observation.source;
  const to = cue.nodeIds[1] ?? observation.target;
  const route = to !== undefined
    ? `${from} → ${to} · ${RELATIONSHIP_LABELS[relationship]}`
    : `${from} · ${RELATIONSHIP_LABELS[relationship]}`;
  const where = to !== undefined ? `from ${from} to ${to}` : `at ${from}`;
  return {
    observationId: cue.observationId,
    sequence: observation.sequence,
    time: observation.time,
    kind: cue.kind,
    relationship,
    ...(cue.edgeId !== undefined ? { edgeId: cue.edgeId } : {}),
    nodeIds: cue.nodeIds,
    from,
    ...(to !== undefined ? { to } : {}),
    headline: learningSummary(observation),
    announcement: `${learningSummary(observation)} ${where} at virtual time ${observation.time}.`,
    route,
    ...(observation.traceId !== undefined ? { traceId: observation.traceId } : {}),
    facts: flightFacts(observation),
    pattern: PATTERNS[observation.type] ?? PATTERN_FALLBACK,
    glyph: glyphOf(observation, cue.kind),
    shape: shapeOf(observation, relationship),
    interrupted: INTERRUPTED_TYPES.has(observation.type),
  };
}

/**
 * Every recorded movement in canonical order. A record that travels no link is
 * not a movement and stays in Recorded history; nothing is merged or reordered.
 */
export function flightSteps(observations: readonly Observation[], edges: readonly MovementEdge[]): readonly FlightStep[] {
  const steps: FlightStep[] = [];
  for (const observation of orderObservations(observations)) {
    const cue = movementCue(observation, edges);
    if (cue) steps.push(flightStep(observation, cue, edges));
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
}

/** Stated once for the playback cursor. Milestone position, virtual time, and the record's own facts. */
export function flightPosition(steps: readonly FlightStep[], cursor: number): FlightPosition {
  const total = steps.length;
  if (total === 0) return { text: "No recorded movements to replay.", detail: "Run the scenario, or open Recorded history and select a record." };
  if (cursor < 0) return { text: `0 of ${total} recorded movements. Nothing selected.`, detail: boundaryDetail(steps) };
  const step = steps[Math.min(cursor, total - 1)]!;
  return {
    text: `Movement ${cursor + 1} of ${total} · virtual time ${step.time} · observation #${step.sequence}.`,
    detail: cursor >= total - 1 ? "At the last recorded movement. Playback waits for the run to record more." : boundaryDetail(steps),
  };
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
  { glyph: "→", shape: "solid", label: "Token: request", detail: "travelling from the caller to the callee" },
  { glyph: "←", shape: "solid", label: "Token: response", detail: "travelling from the callee back to the caller" },
  { glyph: "⇢", shape: "dashed", label: "Token: message", detail: "travelling through the MessageBus to or from a consumer" },
  { glyph: "⊘", shape: "dotted", label: "Token: dropped", detail: "the record says this movement never arrived" },
  { glyph: "◷", shape: "dotted", label: "Token: timed out", detail: "the record says the caller's deadline passed" },
];

/** Where a token stops, as a share of the link, read from the stored record type. */
export function flightStop(step: FlightStep): string {
  if (!step.interrupted) return "100%";
  return step.glyph === "◷" ? "78%" : "52%";
}
