import type {
  ApplicationError,
  CanonicalValue,
  Observation,
} from "@distlab/contracts";
import {
  attemptOf,
  edgeBetween,
  edgeFor,
  movementOf,
  movementText,
  orderObservations,
  payloadVisibility,
  recordedChanges,
} from "./records.ts";
import type { Movement, MovementEdge, MovementKind } from "./records.ts";
import { byCode } from "./i18n/catalog.ts";
import type { Messages } from "./i18n/catalog.ts";
import type { QuickViewId } from "./timeline-quick-views.ts";
import type { ClearedField } from "./timeline-query.ts";
import { displayName } from "./component-display.ts";
import type { ComponentNames } from "./component-display.ts";

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
 * Plain-language label derived only from stored observation fields. It maps the
 * stored type and a stored delivery attempt to text; it never infers outcomes,
 * durations, or causality. A redacted or omitted payload stores no attempt, so
 * no attempt is named and no value is reconstructed.
 *
 * The wording is shared by the detail heading, the Learning row, and architecture
 * playback so the three never name the same record differently. `recordLabels` in
 * the catalog is typed by `MilestoneType`: a milestone without a label is a compile
 * error, not a raw type string shown to a student. Records that are not milestones
 * state their stored type, which is all that is stored for them.
 */
export function recordLabel(observation: Observation, m: Messages): string {
  if (observation.type === "message.delivered") {
    const attempt = attemptOf(observation);
    if (attempt !== undefined) return m.timeline.deliveredAttempt(attempt);
  }
  const base = byCode(m.timeline.recordLabels, observation.type)
    ?? (observation.type.startsWith("fault.") ? m.timeline.faultRecorded : undefined);
  return base ?? observation.type;
}

/**
 * A read-only teaching projection. Only adjacent scheduler/clock bookkeeping and
 * byte-for-byte unchanged assertion evaluations collapse; every other record,
 * including deliveries, retries, effects, and faults, remains its own item.
 */
export type LearningTimelineItem =
  | { readonly kind: "observation"; readonly observation: Observation; readonly summary: string }
  | { readonly kind: "group"; readonly id: string; readonly summary: string; readonly observations: readonly Observation[] };

export function learningTimeline(observations: readonly Observation[], m: Messages): readonly LearningTimelineItem[] {
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
      items.push({ kind: "observation", observation: first, summary: recordLabel(first, m) });
      index += 1;
      continue;
    }
    const members = [first];
    let cursor = index + 1;
    while (cursor < ordered.length && sameCollapsedContext(first, ordered[cursor]!, groupKind, firstStartedEvent, cursor)) {
      members.push(ordered[cursor]!);
      cursor += 1;
    }
    if (members.length === 1) items.push({ kind: "observation", observation: first, summary: recordLabel(first, m) });
    else items.push({
      kind: "group",
      id: `learning:${groupKind}:${members[0]!.id}`,
      summary: m.timeline.learningGroups[groupKind === "setup" ? "setup" : "assertion"],
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

/** A canonical key for comparing stored data. It is identity, not display, so it sorts by code unit in every language. */
function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
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
export function changeEvidence(observation: Observation, m: Messages): readonly ChangeEvidence[] {
  return recordedChanges(observation).map(change => ({
    label: change.table ? `${change.table}${change.key ? ` ${change.key}` : ""}` : m.timeline.recordedChange,
    ...(Object.hasOwn(change, "before") ? { before: change.before } : {}),
    ...(Object.hasOwn(change, "after") ? { after: change.after } : {}),
  }));
}

/** Selection highlight, or the movement cue when the observation travels a link. */
export function emphasisFor(observation: Observation, edges: readonly MovementEdge[], m: Messages, names?: ComponentNames): GraphEmphasis {
  const movement = movementOf(observation);
  // A selected movement carries its sentence: the reader is told what moved, where, and when.
  if (movement) return { ...emphasisOf(movement, edges), text: movementText(movement, m, names), pulseId: movement.observationId, origin: "selection" };
  const involved = observation.target !== undefined && observation.target !== observation.source
    ? [observation.source, observation.target] : [observation.source];
  const link = observation.target !== undefined ? edgeBetween(edges, observation.source, observation.target) : undefined;
  const target = observation.target !== undefined && observation.target !== observation.source ? displayName(names, observation.target) : undefined;
  return {
    nodeIds: involved,
    ...(link !== undefined ? { edgeId: link.id } : {}),
    origin: "selection",
    text: m.timeline.selectedNoMovement({
      type: observation.type, source: displayName(names, observation.source), time: observation.time, ...(target !== undefined ? { target } : {}),
    }),
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

/** Index of the row this direction would select, or null when the selection would stay put. */
export function selectionStep(index: number, count: number, delta: -1 | 1): number | null {
  if (count <= 0) return null;
  if (index < 0) return delta < 0 ? count - 1 : 0;
  const next = index + delta;
  if (next < 0 || next >= count) return null;
  return next;
}

/** The position among visible rows. It is part of the live announcement only, never visible text (#146). */
export function boundaryCopy(index: number, count: number, m: Messages): string {
  const copy = m.timeline.boundary;
  if (count <= 0) return copy.none;
  if (index < 0) return copy.unselected(count);
  const position = copy.position({ index: index + 1, count });
  if (count === 1) return `${position} ${copy.cannotMoveBoth}`;
  if (index === 0) return `${position} ${copy.cannotMovePrevious}`;
  if (index === count - 1) return `${position} ${copy.cannotMoveNext}`;
  return position;
}

/** The stored fields a selection announcement names. Small enough to keep in state without keeping the record. */
export interface SelectionRef {
  readonly sequence: number;
  readonly type: string;
  readonly time: number;
}

/**
 * The review position, naming the stored type. It is announced through Recorded history's one
 * polite live region and never shown: the docked detail's header is the visible statement (#146).
 */
export function selectionMessage(observation: SelectionRef, m: Messages): string {
  return m.timeline.selection({ sequence: observation.sequence, type: observation.type, time: observation.time });
}

/** A filter a reveal or a trace narrowing removed: a field, or the quick view that hid the record. */
export type ClearedFilter = ClearedField | { readonly quickView: QuickViewId };

/** The names of what was cleared, rendered at the end so deduplication and ordering never depend on the language. */
function clearedNames(cleared: readonly ClearedFilter[], m: Messages): readonly string[] {
  return cleared.map(item => typeof item === "string"
    ? m.timeline.clearedName[item]
    : m.timeline.clearedQuickView(m.timeline.quickView.views[item.quickView].inline));
}

export function revealMessage(cleared: readonly ClearedFilter[], observation: SelectionRef, m: Messages): string {
  const selected = selectionMessage(observation, m);
  if (cleared.length === 0) return selected;
  return `${selected} ${m.timeline.revealCleared(clearedNames(cleared, m))}`;
}

export function movementMessage(observation: SelectionRef, index: number, count: number, m: Messages): string {
  return `${selectionMessage(observation, m)} ${boundaryCopy(index, count, m)}`;
}

export function traceFilterMessage(traceId: string, change: { readonly changed: boolean; readonly cleared: readonly ClearedFilter[] }, m: Messages): string {
  if (!change.changed) return m.timeline.traceAlready(traceId);
  const now = m.timeline.traceNow(traceId);
  if (change.cleared.length === 0) return now;
  return `${now} ${m.timeline.traceCleared(clearedNames(change.cleared, m))}`;
}

export function payloadCopy(observation: Observation, m: Messages): string {
  const visibility = payloadVisibility(observation);
  if (visibility === "omitted") return m.timeline.payload.omitted;
  if (visibility === "redacted") return m.timeline.payload.redacted;
  return m.timeline.payload.stored;
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

export function terminalCopy(mark: TerminalMark, m: Messages): string {
  const copy = m.timeline.terminal;
  const history = mark.historyComplete === false ? copy.historyIncomplete
    : mark.historyComplete === true ? copy.historyComplete : copy.historyNotReported;
  // Completeness that was not reported does not name a last observation.
  const last = mark.historyComplete !== null && mark.lastObservationId ? ` ${copy.lastObservation(mark.lastObservationId)}` : "";
  return `${copy.failure(mark.code)} ${history}${last}`;
}

function isRecord(value: unknown): value is Record<string, CanonicalValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
