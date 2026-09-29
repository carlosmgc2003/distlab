import type {
  ApplicationError,
  CanonicalValue,
  Observation,
} from "@distlab/contracts";
import {
  attemptLabel,
  edgeBetween,
  edgeFor,
  movementOf,
  orderObservations,
  payloadVisibility,
  recordedChanges,
} from "./records.ts";
import type { MilestoneType, Movement, MovementEdge, MovementKind } from "./records.ts";

/** Fixed row geometry so the timeline window stays bounded at the history baseline. */
export const TIMELINE_ROW_HEIGHT = 44;
export const TIMELINE_VIEWPORT = 320;

export interface GraphEmphasis {
  readonly nodeIds: readonly string[];
  readonly edgeId?: string;
  readonly kind?: MovementKind;
  readonly text?: string;
  /** Changes when a movement cue should replay its transient paint. */
  readonly pulseId?: string;
  /**
   * How the highlight was raised. `selection` is a record the reader chose in
   * Recorded history; `live` is the newest recorded movement flashing by itself.
   * Only a selection takes the graph highlight back from architecture playback.
   */
  readonly origin?: "selection" | "live";
}

export interface ChangeEvidence {
  readonly label: string;
  readonly before?: CanonicalValue;
  readonly after?: CanonicalValue;
}

export type PayloadVisibility = "visible" | "redacted" | "omitted";

export interface TerminalMark {
  readonly code: string | null;
  readonly historyComplete: boolean | null;
  readonly time: number | null;
  readonly lastObservationId: string | null;
}

/**
 * Wording for one stored record, shared by the detail heading, the Learning row,
 * and architecture playback so the three never name the same record differently.
 *
 * Typed by `MilestoneType`: a milestone without a label is a compile error, not
 * a raw type string shown to a student. Records that are not milestones state
 * their stored type, which is all that is stored for them.
 */
const RECORD_LABELS: Readonly<Record<MilestoneType, string>> = {
  "network.request.sent": "Request sent",
  "network.request.delivered": "Request delivered",
  "network.request.dropped": "Request dropped",
  "network.request.timedout": "Request timed out",
  "network.response.sent": "Response sent",
  "network.response.received": "Response received",
  "network.response.dropped": "Response dropped",
  "message.published": "Message published",
  "message.delivered": "Message delivered",
  "message.acknowledged": "Message acknowledged",
  "message.ack.stale": "Stale message acknowledgement",
  "message.retry.scheduled": "Message retry scheduled",
  "database.transaction.committed": "Database transaction committed",
  "database.transaction.rolledback": "Database transaction rolled back",
  "external.effect.committed": "External side effect committed",
  "fault.rule.matched": "Fault rule matched",
  "fault.effect.selected": "Fault effect selected",
};

/** Wording for a fault record the milestone table does not name individually. */
const OTHER_FAULT_LABEL = "Fault recorded";

/**
 * Plain-language label derived only from stored observation fields. It maps the
 * stored type and a stored delivery attempt to text; it never infers outcomes,
 * durations, or causality. A redacted or omitted payload stores no attempt, so
 * no attempt is named and no value is reconstructed.
 */
export function recordLabel(observation: Observation): string {
  const base = (RECORD_LABELS as Readonly<Record<string, string | undefined>>)[observation.type]
    ?? (observation.type.startsWith("fault.") ? OTHER_FAULT_LABEL : undefined);
  if (base === undefined) return observation.type;
  return observation.type === "message.delivered" ? `${base}${attemptLabel(observation)}` : base;
}

/**
 * A read-only teaching projection. Only adjacent scheduler/clock bookkeeping and
 * byte-for-byte unchanged assertion evaluations collapse; every other record,
 * including deliveries, retries, effects, and faults, remains its own item.
 */
export type LearningTimelineItem =
  | { readonly kind: "observation"; readonly observation: Observation; readonly summary: string }
  | { readonly kind: "group"; readonly id: string; readonly summary: string; readonly observations: readonly Observation[] };

export function learningTimeline(observations: readonly Observation[]): readonly LearningTimelineItem[] {
  const ordered = orderObservations(observations);
  const firstStartedEvent = ordered.findIndex(observation => observation.type === "simulation.event.started");
  const items: LearningTimelineItem[] = [];
  for (let index = 0; index < ordered.length;) {
    const first = ordered[index]!;
    // Startup queue construction is the only scheduler bookkeeping that is
    // collapsed. Later scheduling is part of the execution story and remains
    // individually inspectable.
    const setup = firstStartedEvent < 0 || index < firstStartedEvent;
    const groupKind = collapsibleKind(first, setup);
    if (!groupKind) {
      items.push({ kind: "observation", observation: first, summary: recordLabel(first) });
      index += 1;
      continue;
    }
    const members = [first];
    let cursor = index + 1;
    while (cursor < ordered.length && sameCollapsedContext(first, ordered[cursor]!, groupKind, firstStartedEvent, cursor)) {
      members.push(ordered[cursor]!);
      cursor += 1;
    }
    if (members.length === 1) items.push({ kind: "observation", observation: first, summary: recordLabel(first) });
    else items.push({
      kind: "group",
      id: `learning:${groupKind}:${members[0]!.id}`,
      summary: groupKind === "setup" ? "Initial engine queue setup" : "Unchanged assertion evaluations",
      observations: members,
    });
    index = cursor;
  }
  return items;
}

function collapsibleKind(observation: Observation, setup: boolean): "setup" | "assertion" | undefined {
  if (setup && (observation.type.startsWith("scheduler.") || observation.type.startsWith("clock."))) return "setup";
  if (observation.type === "scenario.assertion.evaluated") return "assertion";
  return undefined;
}

function sameCollapsedContext(
  first: Observation,
  candidate: Observation,
  kind: "setup" | "assertion",
  firstStartedEvent: number,
  candidateIndex: number,
): boolean {
  const candidateSetup = firstStartedEvent < 0 || candidateIndex < firstStartedEvent;
  if (collapsibleKind(candidate, candidateSetup) !== kind) return false;
  // Assertions collapse only when their stored result and correlation context
  // are unchanged. Never merge records merely because their timestamps match.
  return kind === "setup" || (stableValue(first.data) === stableValue(candidate.data)
    && first.source === candidate.source && first.target === candidate.target
    && first.traceId === candidate.traceId && first.eventId === candidate.eventId);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface VisibleRowRange {
  readonly start: number;
  readonly end: number;
}

export function visibleRowRange(count: number, scrollTop: number, viewport: number, rowHeight: number, overscan = 6): VisibleRowRange {
  if (count <= 0 || viewport <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}

/** Reads only stored before/after fields. Redacted and omitted payloads contribute no evidence. */
export function changeEvidence(observation: Observation): readonly ChangeEvidence[] {
  return recordedChanges(observation).map(change => ({
    label: change.table ? `${change.table}${change.key ? ` ${change.key}` : ""}` : "Recorded change",
    ...(Object.hasOwn(change, "before") ? { before: change.before } : {}),
    ...(Object.hasOwn(change, "after") ? { after: change.after } : {}),
  }));
}

/** Selection highlight, or the movement cue when the observation travels a link. */
export function emphasisFor(observation: Observation, edges: readonly MovementEdge[]): GraphEmphasis {
  const movement = movementOf(observation);
  // A selected movement carries its sentence: the reader is told what moved, where, and when.
  if (movement) return { ...emphasisOf(movement, edges), text: movement.text, pulseId: movement.observationId, origin: "selection" };
  const involved = observation.target !== undefined && observation.target !== observation.source
    ? [observation.source, observation.target] : [observation.source];
  const link = observation.target !== undefined ? edgeBetween(edges, observation.source, observation.target) : undefined;
  const where = observation.target !== undefined && observation.target !== observation.source
    ? `${observation.source} to ${observation.target}` : observation.source;
  return {
    nodeIds: involved,
    ...(link !== undefined ? { edgeId: link.id } : {}),
    origin: "selection",
    text: `Selected ${observation.type} at ${where} at virtual time ${observation.time}. No request or message movement.`,
  };
}

/** The components and drawn link a movement touches. */
function emphasisOf(movement: Movement, edges: readonly MovementEdge[]): GraphEmphasis {
  const nodeIds = movement.to !== undefined ? [movement.from, movement.to] : [movement.from];
  const edge = edgeFor(movement, edges);
  return { nodeIds, ...(edge !== undefined ? { edgeId: edge.id } : {}), kind: movement.kind };
}

/** CSS-safe token so a new cue restarts the transient stroke without putting observation ids in a class. */
export function movementPulseClass(id: string): string {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return `pulse-${(hash >>> 0).toString(36)}`;
}

export type PlaybackPhase = "idle" | "playing" | "paused" | "ended";

export interface PlaybackControl {
  readonly action: "play" | "restart" | "unavailable";
  readonly label: "Play timeline" | "Restart timeline";
  readonly reason: string;
}

/** Index of the row this direction would select, or null when the selection would stay put. */
export function selectionStep(index: number, count: number, delta: -1 | 1): number | null {
  if (count <= 0) return null;
  if (index < 0) return delta < 0 ? count - 1 : 0;
  const next = index + delta;
  if (next < 0 || next >= count) return null;
  return next;
}

export function selectionAvailability(index: number, count: number): { readonly previous: boolean; readonly next: boolean } {
  return { previous: selectionStep(index, count, -1) !== null, next: selectionStep(index, count, 1) !== null };
}

export function boundaryCopy(index: number, count: number): string {
  if (count <= 0) return "No visible observations.";
  if (index < 0) {
    return count === 1
      ? "1 visible observation. Next and Previous select it."
      : `${count} visible observations. Next selects the first. Previous selects the last.`;
  }
  const position = `Visible observation ${index + 1} of ${count}.`;
  if (count === 1) return `${position} Previous and Next cannot move.`;
  if (index === 0) return `${position} Previous cannot move.`;
  if (index === count - 1) return `${position} Next cannot move.`;
  return position;
}

/** Play, pause, and restart describe the UI cursor. They do not rewind the simulation. */
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

/** The review position, naming the stored type. Rows and the detail panel carry the wording. */
export function selectionMessage(observation: Observation): string {
  return `Selected #${observation.sequence} ${observation.type} at virtual time ${observation.time}.`;
}

export function revealMessage(cleared: readonly string[], observation: Observation): string {
  const selected = selectionMessage(observation);
  if (cleared.length === 0) return selected;
  const labels = listLabels(cleared);
  const verb = cleared.length === 1 ? "filter was" : "filters were";
  return `${selected} The ${labels} ${verb} cleared so this observation is visible.`;
}

export function movementMessage(observation: Observation, index: number, count: number): string {
  return `${selectionMessage(observation)} ${boundaryCopy(index, count)}`;
}

export function traceFilterMessage(traceId: string, change: { readonly changed: boolean; readonly cleared: readonly string[] }): string {
  if (!change.changed) return `The timeline already shows trace ${traceId}.`;
  if (change.cleared.length === 0) return `The timeline now shows trace ${traceId}.`;
  const verb = change.cleared.length === 1 ? "filter was" : "filters were";
  return `The timeline now shows trace ${traceId}. The ${listLabels(change.cleared)} ${verb} cleared.`;
}

export function payloadCopy(observation: Observation): string {
  const visibility = payloadVisibility(observation);
  if (visibility === "omitted") return "No data field was stored.";
  if (visibility === "redacted") return "Stored payload is redacted. Hidden fields are not available.";
  return "Stored payload";
}

export function terminalMark(status: string | null | undefined, error: ApplicationError | null): TerminalMark | null {
  if (status !== "FAILED" && error?.code !== "SIMULATION_FAILED") return null;
  const body = isRecord(error?.context ?? null) ? error?.context as Record<string, CanonicalValue> : null;
  if (body && typeof body.code === "string" && typeof body.historyComplete === "boolean") {
    return {
      code: body.code,
      historyComplete: body.historyComplete,
      time: typeof body.time === "number" && Number.isSafeInteger(body.time) ? body.time : null,
      lastObservationId: typeof body.lastObservationId === "string" ? body.lastObservationId : null,
    };
  }
  return {
    code: body && typeof body.code === "string" ? body.code : error?.code ?? null,
    historyComplete: null,
    time: null,
    lastObservationId: null,
  };
}

export function terminalCopy(mark: TerminalMark): string {
  const code = mark.code ? ` ${mark.code}` : "";
  const last = mark.lastObservationId ? ` Last recorded observation: ${mark.lastObservationId}.` : "";
  if (mark.historyComplete === false) return `Terminal failure${code}. Execution history is incomplete.${last}`;
  if (mark.historyComplete === true) return `Terminal failure${code}. Execution history is complete.${last}`;
  return `Terminal failure${code}. Execution history completeness was not reported.`;
}

function listLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function isRecord(value: unknown): value is Record<string, CanonicalValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
