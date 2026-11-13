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
import { movementText } from "./records.ts";
import type { Movement, MovementEdge } from "./records.ts";
import type { Messages } from "./i18n/catalog.ts";
import { recordLabel, selectionStep } from "./timeline.ts";
import { displayName } from "./component-display.ts";
import type { ComponentNames } from "./component-display.ts";
import type { ComponentActivity } from "./activity.ts";

/**
 * Presentation-only reading of recorded movements. Every value here is copied
 * from a stored observation field. Nothing is inferred, and no simulation state
 * is read, allocated, or changed by this module.
 */

/** How long the browser paints one recorded movement. Presentation only: it never changes virtual time. */
export const FLIGHT_PACES = [
  { id: "slow", delayMs: 1800 },
  { id: "steady", delayMs: 900 },
  { id: "fast", delayMs: 350 },
] as const;

export type FlightPace = (typeof FLIGHT_PACES)[number]["id"];
export const DEFAULT_FLIGHT_PACE: FlightPace = "slow";

export function flightPace(pace: FlightPace): (typeof FLIGHT_PACES)[number] {
  return FLIGHT_PACES.find(item => item.id === pace) ?? FLIGHT_PACES[0];
}

/** The pace's name and its note, for the Speed selector. */
export function flightPaceText(pace: FlightPace, m: Messages): { readonly label: string; readonly note: string } {
  return { label: m.playback.pace.label[pace], note: m.playback.pace.note({ seconds: flightPace(pace).delayMs / 1000 }) };
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

/** The stored fields worth naming in the narration, in reading order. Labels come from the catalog. Values are printed as stored. */
const FIELD_KEYS = [
  "endpoint", "operation", "deadline", "dueTime", "previousAttempt", "status", "late", "reason", "ruleId",
  "attempt", "destination", "consumer", "subscriber", "transactionId", "messageId", "deliveryId", "routingId",
] as const satisfies readonly (keyof Messages["playback"]["fieldLabel"])[];

/** The pattern question of one stored type, or the generic question for any other type. */
function patternOf(type: string, m: Messages): string {
  const table: Readonly<Record<string, string>> = m.playback.pattern;
  return Object.hasOwn(table, type) ? table[type]! : m.playback.patternFallback;
}

const INTERRUPTED_TYPES = new Set([
  "network.request.dropped",
  "network.request.timedout",
  "network.response.dropped",
]);


/**
 * Stored fields for the narration. A redacted or omitted payload contributes
 * one visibility statement and nothing else: it is never reconstructed.
 */
export function flightFacts(observation: Observation, m: Messages): readonly FlightFact[] {
  const visibility = payloadVisibility(observation);
  if (visibility !== "omitted" && visibility !== "redacted" && visibility !== "visible") return [];
  if (visibility !== "visible") {
    return [{ label: m.playback.fact.storedPayload, value: visibility === "redacted" ? m.playback.fact.redacted : m.playback.fact.omitted }];
  }
  const facts: FlightFact[] = [];
  for (const key of FIELD_KEYS) {
    const value = storedScalar(observation, key);
    if (value !== undefined) facts.push({ label: m.playback.fieldLabel[key], value });
  }
  const changes = recordedChanges(observation);
  const before = changes.find(change => change.before !== undefined)?.before;
  const after = changes.find(change => change.after !== undefined)?.after;
  if (before !== undefined && after !== undefined) facts.push({ label: m.playback.fact.transition, value: `${before} \u2192 ${after}` });
  const rows = changes.flatMap(change => change.table !== undefined && change.key !== undefined ? [`${change.table}/${change.key}`] : []);
  if (rows.length > 0) facts.push({ label: m.playback.fact.changedRows, value: rows.join(", ") });
  const messageType = storedScalarAt(observation, ["message", "type"]);
  if (messageType !== undefined) facts.push({ label: m.playback.fact.messageType, value: messageType });
  const messageFields = storedFieldsAt(observation, ["message", "body"]);
  if (messageFields !== undefined) facts.push({ label: m.playback.fact.messageBodyFields, value: messageFields });
  const body = bodyFields(observation, "body");
  if (body !== undefined) facts.push({ label: m.playback.fact.bodyFields, value: body });
  const external = externalChanges(observation, "visibleChanges");
  if (external.length > 0) facts.push({ label: m.playback.fact.externalChange, value: external.join(", ") });
  return facts;
}

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

function transitText(leg: FlightLeg, movement: Movement, departure: FlightStep["departure"], m: Messages, names: ComponentNames | undefined): string {
  // Narration names components by display name (#103).
  const params = {
    from: displayName(names, movement.from),
    ...(movement.to !== undefined ? { to: displayName(names, movement.to) } : {}),
    ...(departure !== undefined ? { departure: { time: departure.time, sequence: departure.sequence } } : {}),
  };
  return m.playback.transit[leg](params);
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
  departure: FlightStep["departure"] | undefined,
  m: Messages,
  names?: ComponentNames,
): FlightStep {
  const edge = edgeFor(movement, edges);
  const leg = legOf(observation);
  const hopId = hopKey(observation, movement.kind);
  const relationship = movement.relationship;
  const from = movement.from;
  const to = movement.to;
  const nodeIds = to !== undefined ? [from, to] : [from];
  // Narration names components by display name (#103); `from`, `to`, and `nodeIds` keep the stored IDs.
  const route = m.playback.route({ from: displayName(names, from), ...(to !== undefined ? { to: displayName(names, to) } : {}), relationship: m.playback.relationship[relationship] });
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
    headline: recordLabel(observation, m),
    announcement: movementText(movement, m, names),
    route,
    ...(observation.traceId !== undefined ? { traceId: observation.traceId } : {}),
    facts: flightFacts(observation, m),
    pattern: patternOf(observation.type, m),
    glyph: glyphOf(observation, movement.kind),
    shape: shapeOf(observation, relationship),
    interrupted: INTERRUPTED_TYPES.has(observation.type),
    leg,
    span: LEG_SPANS[leg],
    reversed: edge !== undefined && edgeDirection(movement, edge) === "reverse",
    heading: leg !== "timeout",
    ...(hopId !== undefined ? { hopId } : {}),
    ...(departure !== undefined && leg !== "departure" && leg !== "trip" ? { departure } : {}),
    transit: transitText(leg, movement, leg !== "departure" && leg !== "trip" ? departure : undefined, m, names),
  };
}

/**
 * Every recorded movement in canonical order. A record that travels no link is
 * not a movement and stays in Recorded history; nothing is merged or reordered.
 */
export function flightSteps(observations: readonly Observation[], edges: readonly MovementEdge[], m: Messages, names?: ComponentNames): readonly FlightStep[] {
  const steps: FlightStep[] = [];
  // Departures seen so far, by hop id. Only earlier records pair: nothing is read ahead of a step.
  const departures = new Map<string, NonNullable<FlightStep["departure"]>>();
  for (const observation of orderObservations(observations)) {
    const movement = movementOf(observation);
    if (!movement) continue;
    const hop = hopKey(observation, movement.kind);
    // An arrival, a drop, and a timeout share the stored request id of the departure they end.
    const departure = hop !== undefined ? departures.get(hop) : undefined;
    const step = flightStep(observation, movement, edges, departure, m, names);
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
export function flightPosition(steps: readonly FlightStep[], cursor: number, m: Messages): FlightPosition {
  const total = steps.length;
  if (total === 0) return { text: m.playback.position.none, detail: m.playback.position.noneDetail };
  if (cursor < 0) return { text: m.playback.position.nothingSelected(total), detail: boundaryDetail(steps, m) };
  const index = Math.min(cursor, total - 1);
  const step = steps[index]!;
  const jump = flightJump(steps, index, m);
  return {
    text: m.playback.position.current({ index: index + 1, total, time: step.time, sequence: step.sequence }),
    detail: index >= total - 1 ? m.playback.position.atLast : boundaryDetail(steps, m),
    ...(jump !== undefined ? { jump } : {}),
  };
}

/** The virtual-time jump into this movement from the previous one, or undefined when time did not advance. */
export function flightJump(steps: readonly FlightStep[], index: number, m: Messages): string | undefined {
  const step = steps[index];
  const previous = index > 0 ? steps[index - 1] : undefined;
  if (step === undefined || previous === undefined || step.time <= previous.time) return undefined;
  return m.playback.position.jump({ from: previous.time, to: step.time });
}

/** Recorded virtual-time boundaries of the movement list. No duration or latency is implied. */
export function flightBoundaries(steps: readonly FlightStep[]): readonly SimulationTime[] {
  const times: SimulationTime[] = [];
  for (const step of steps) if (step.time !== times.at(-1)) times.push(step.time);
  return times;
}

function boundaryDetail(steps: readonly FlightStep[], m: Messages): string {
  const times = flightBoundaries(steps);
  if (times.length === 0) return "";
  return times.length === 1
    ? m.playback.position.sameTime({ total: steps.length, time: times[0]! })
    : m.playback.position.boundaries({ total: steps.length, boundaries: times.length, from: times[0]!, to: times.at(-1)! });
}

export type PlaybackPhase = "idle" | "playing" | "paused" | "ended";

export interface PlaybackControl {
  readonly action: "play" | "restart" | "unavailable";
  readonly label: string;
  readonly reason: string;
}

/** Play, pause, and restart describe the cursor. They do not rewind the simulation. */
export function playbackControl(index: number, count: number, playing: boolean, m: Messages): PlaybackControl {
  const copy = m.playback.control;
  if (playing) return { action: "unavailable", label: copy.play, reason: copy.playing };
  if (count <= 0) return { action: "unavailable", label: copy.play, reason: copy.noObservations };
  // One recorded movement is still worth painting (#192): Play paints it, and Restart paints it again.
  if (index >= 0 && index >= count - 1) return { action: "restart", label: copy.restart, reason: copy.atEnd };
  if (index < 0) return { action: "play", label: copy.play, reason: copy.fromStart };
  return { action: "play", label: copy.play, reason: copy.fromSelected };
}

export function playbackStatus(phase: PlaybackPhase, control: PlaybackControl, m: Messages): string {
  if (phase === "playing") return m.playback.control.playing;
  if (phase === "paused") return m.playback.control.paused;
  if (phase === "ended") return m.playback.control.ended;
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
  readonly pauseLabel: string;
  readonly status: string;
  readonly reason: string;
  readonly previous: boolean;
  readonly next: boolean;
}

/** Play, pause, restart, and the two step directions over recorded movements. */
export function flightTransport(cursor: number, count: number, phase: PlaybackPhase, recording: boolean, m: Messages): FlightTransport {
  const playing = phase === "playing";
  const control = playbackControl(cursor, count, playing, m);
  const steps = selectionAvailability(cursor, count);
  return {
    control,
    pauseLabel: m.playback.control.pause,
    status: playbackStatus(phase, control, m),
    reason: recording && playing ? m.playback.control.recording : control.reason,
    previous: steps.previous,
    next: steps.next,
  };
}

/**
 * The movement a Replay step selects, or null when that direction is unavailable. With nothing
 * selected, Next selects the first movement and Previous is unavailable (#191): a replay starts at
 * the start of the story. `selectionStep` alone wraps from no selection to the last movement.
 */
export function transportStep(index: number, count: number, delta: -1 | 1): number | null {
  if (index < 0 && delta < 0) return null;
  return selectionStep(index, count, delta);
}

function selectionAvailability(index: number, count: number): { readonly previous: boolean; readonly next: boolean } {
  return { previous: transportStep(index, count, -1) !== null, next: transportStep(index, count, 1) !== null };
}

/**
 * The hops still on their link at the cursor: every departure recorded before the cursor's
 * movement whose arrival or drop is not recorded at or before it. Two requests sent at the same
 * virtual time are two records, so the cursor stands on one while the other is still in transit.
 *
 * Only an arrival or a drop ends a transit. A caller's timeout does not: that record says the
 * caller stopped waiting, not what happened to the request. The cursor's own movement is not
 * listed, and a MessageBus record is a whole trip, so it is never in transit. Nothing after the
 * cursor is read.
 */
export function flightInTransit(steps: readonly FlightStep[], cursor: number): readonly FlightStep[] {
  if (cursor < 0) return [];
  const open = new Map<string, FlightStep>();
  const last = Math.min(cursor, steps.length - 1);
  for (let index = 0; index <= last; index += 1) {
    const step = steps[index]!;
    if (step.hopId === undefined) continue;
    if (step.leg === "departure") { if (index < last) open.set(step.hopId, step); }
    else if (step.leg === "arrival" || step.leg === "interrupted") open.delete(step.hopId);
  }
  return [...open.values()];
}

export interface FlightTransitGroup {
  /** The most recent departure of the group: the token the graph draws. */
  readonly step: FlightStep;
  /** How many hops of this kind wait on this link in this direction. */
  readonly count: number;
}

/**
 * In-transit hops grouped by link, kind, and direction, so sixteen requests waiting on one link
 * are one token with a count. Hops whose link the graph does not draw are left out.
 */
export function flightTransitGroups(inTransit: readonly FlightStep[]): ReadonlyMap<string, readonly FlightTransitGroup[]> {
  const groups = new Map<string, Map<string, FlightTransitGroup>>();
  for (const step of inTransit) {
    if (step.edgeId === undefined) continue;
    const onEdge = groups.get(step.edgeId) ?? new Map<string, FlightTransitGroup>();
    const key = `${step.kind}:${step.reversed ? "reverse" : "forward"}`;
    onEdge.set(key, { step, count: (onEdge.get(key)?.count ?? 0) + 1 });
    groups.set(step.edgeId, onEdge);
  }
  return new Map([...groups].map(([edgeId, onEdge]) => [edgeId, [...onEdge.values()]]));
}

/** The glyph the legend shows on its sample of a token still in transit. */
export const TRANSIT_SAMPLE_GLYPH: FlightGlyph = "REQ";

/** At most this many in-transit routes are named in the narration; beyond it, the count is stated. */
export const IN_TRANSIT_NAMED = 3;

/** One sentence naming what else is on a link at the cursor, or undefined when nothing is. */
export function flightInTransitText(inTransit: readonly FlightStep[], m: Messages, names?: ComponentNames): string | undefined {
  if (inTransit.length === 0) return undefined;
  if (inTransit.length > IN_TRANSIT_NAMED) return m.playback.narration.inTransitMany(inTransit.length);
  return m.playback.narration.inTransit(inTransit.map(step => m.playback.narration.inTransitRoute({
    glyph: step.glyph, from: displayName(names, step.from), ...(step.to !== undefined ? { to: displayName(names, step.to) } : {}),
  })));
}

/**
 * The components a painted movement leaves in the background: not an end of the movement or of
 * a hop still in transit, and with no recorded work, wait, or timeout at the cursor. The graph
 * draws them fainter, so the eye goes to the movement and to whoever is still busy. With no
 * movement painted, nothing is in the background. Presentation only: it reads the step and the
 * activity already read from records.
 */
export function flightBackground(
  componentIds: readonly string[],
  step: Pick<FlightStep, "nodeIds"> | undefined,
  activity: ReadonlyMap<string, ComponentActivity>,
  inTransit: readonly Pick<FlightStep, "nodeIds">[] = [],
): ReadonlySet<string> {
  const background = new Set<string>();
  if (step === undefined) return background;
  const travelling = new Set(inTransit.flatMap(item => item.nodeIds));
  for (const id of componentIds) {
    if (step.nodeIds.includes(id) || travelling.has(id)) continue;
    const current = activity.get(id);
    if (current !== undefined && (current.state !== "idle" || current.timedOut !== undefined)) continue;
    background.add(id);
  }
  return background;
}

export type ReplayKeyAction = "previous" | "next" | "toggle";

/** The keys the Replay toolbar answers to, as `KeyboardEvent.key` values. Key names are not translated. */
export const REPLAY_KEYS = { previous: "ArrowLeft", next: "ArrowRight", toggle: " " } as const satisfies Record<ReplayKeyAction, string>;

export interface ReplayKeyPress {
  readonly key: string;
  /** True when Alt, Control, Meta, or Shift is held: those chords belong to the browser. */
  readonly modified: boolean;
  /** True for an auto-repeated key. Holding Space must not flip play and pause over and over. */
  readonly repeat: boolean;
  /** True when focus is in a control that uses the arrow keys itself: a field, a select, a tab list, a dialog. */
  readonly arrowsClaimed: boolean;
  /** True when focus is on anything Space already activates: a button, a link, a component node. */
  readonly spaceClaimed: boolean;
}

/**
 * The Replay action a key press asks for, or null when the key is not Replay's to take.
 * Left and Right step one recorded movement; Space plays or pauses. A key a focused control
 * already uses keeps its own meaning, so no existing gesture changes.
 */
export function replayKeyAction(press: ReplayKeyPress): ReplayKeyAction | null {
  if (press.modified) return null;
  if (press.key === REPLAY_KEYS.previous) return press.arrowsClaimed ? null : "previous";
  if (press.key === REPLAY_KEYS.next) return press.arrowsClaimed ? null : "next";
  if (press.key === REPLAY_KEYS.toggle) return press.spaceClaimed || press.repeat ? null : "toggle";
  return null;
}

export interface FlightLegendEntry {
  readonly glyph: FlightGlyph;
  readonly shape: FlightShape;
  readonly label: string;
  /** The full statement, read after the short legend label. */
  readonly detail: string;
}

const LEGEND_GLYPHS: readonly { readonly glyph: FlightGlyph; readonly shape: FlightShape }[] = [
  { glyph: "REQ", shape: "solid" },
  { glyph: "RES", shape: "solid" },
  { glyph: "MSG", shape: "dashed" },
  { glyph: "ACK", shape: "dashed" },
  { glyph: "⊘", shape: "dotted" },
  { glyph: "◷", shape: "dotted" },
];

/** Legend of the tokens painted on the architecture graph. Text and shape carry the meaning. */
export function flightLegend(m: Messages): readonly FlightLegendEntry[] {
  return LEGEND_GLYPHS.map(item => ({ ...item, ...m.playback.legend[item.glyph] }));
}

/** Where a token stops, as a share of the link measured from the movement's own origin. */
export function flightStop(step: FlightStep): string {
  return `${step.span.end}%`;
}
