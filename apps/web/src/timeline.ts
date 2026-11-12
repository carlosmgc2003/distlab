import type {
  ApplicationError,
  CanonicalValue,
  Observation,
} from "@distlab/contracts";
import {
  edgeBetween,
  edgeFor,
  movementOf,
  payloadVisibility,
  recordedChanges,
  storedQualifier,
} from "./records.ts";
import type { MilestoneType, Movement, MovementEdge, MovementKind } from "./records.ts";

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
 * Wording for one stored record, shared by the detail heading and architecture
 * playback so the two never name the same record differently.
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
  "database.transaction.rejected": "Database transaction rejected",
  "service.handler.failed": "Handler failed",
  "message.nacked": "Message rejected (NACK)",
  "message.dead": "Message dead-lettered",
  "kv.condition.failed": "Key-value condition failed",
  "kv.changed": "Key-value entry changed",
  "kv.expired": "Key-value entry expired",
  "runtime.log": "Log",
  "scenario.assertion.evaluated": "Check",
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
  return `${base}${storedQualifier(observation)}`;
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

/** Index of the row this direction would select, or null when the selection would stay put. */
export function selectionStep(index: number, count: number, delta: -1 | 1): number | null {
  if (count <= 0) return null;
  if (index < 0) return delta < 0 ? count - 1 : 0;
  const next = index + delta;
  if (next < 0 || next >= count) return null;
  return next;
}

/**
 * The review position, naming the stored type. It is announced through Recorded history's one
 * polite live region and never shown: the docked detail's header is the visible statement (#146).
 */
export function selectionMessage(observation: Observation): string {
  return `Selected Observation #${observation.sequence}: ${observation.type} at virtual time ${observation.time}.`;
}

export function revealMessage(cleared: readonly string[], observation: Observation): string {
  const selected = selectionMessage(observation);
  if (cleared.length === 0) return selected;
  const labels = listLabels(cleared);
  const verb = cleared.length === 1 ? "filter was" : "filters were";
  return `${selected} The ${labels} ${verb} cleared so this observation is visible.`;
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
