import type { CanonicalValue, Observation, SimulationTime } from "@distlab/contracts";
import type { Messages } from "./i18n/catalog.ts";
import { displayName } from "./component-display.ts";
import type { ComponentNames } from "./component-display.ts";

/**
 * Record reading. One place decides what a stored record *is*, using only its
 * stored type and stored fields. This module reads records; it knows nothing
 * about views, filters, layout, scrolling, playback, or the architecture graph.
 * Each presentation keeps its own wording and its own link styling.
 */

/**
 * Canonical order of stored records: virtual time first, then sequence number,
 * with equal records keeping their published order. Every reader sees the same
 * order, so no view can present the history differently from another.
 */
export function orderObservations(observations: readonly Observation[]): readonly Observation[] {
  if (observations.every((observation, index) => index === 0 || observations[index - 1]!.sequence <= observation.sequence)) return observations;
  return observations.map((observation, index) => ({ observation, index }))
    .sort((left, right) => left.observation.sequence - right.observation.sequence || left.index - right.index)
    .map(item => item.observation);
}

/** True when `next` continues `previous` record for record, so published history only grew. */
export function continuesHistory(previous: readonly Observation[], next: readonly Observation[]): boolean {
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (!before || !after || before.id !== after.id || before.sequence !== after.sequence) return false;
  }
  return true;
}

/**
 * Teaching category of a record, in legend order. Categories are assigned by
 * the milestone table below and by nothing else.
 */
export type RecordKind =
  | "request"
  | "response"
  | "message"
  | "retry"
  | "commit"
  | "rollback"
  | "external"
  | "fault"
  | "drop"
  | "timeout"
  | "failure"
  | "kv"
  | "log"
  | "check";

/** Every teaching category, in legend order. */
export const recordKinds: readonly RecordKind[] = [
  "request", "response", "message", "retry", "commit", "rollback", "external", "fault", "drop", "timeout",
  "failure", "kv", "log", "check",
];

/**
 * The teaching milestone set, transcribed from the Story view section of
 * `docs/learning-timeline.md`. `docs/learning-timeline.md` is the source of
 * truth; `tests/records.test.ts` reads that document and fails when the two
 * disagree.
 *
 * One documented deviation, deliberate: `network.request.timedout` is present
 * here but not in the document. It is pending a ruling, and the same test fails
 * while it is unresolved.
 */
export const milestoneKinds = {
  "network.request.sent": "request",
  "network.request.delivered": "request",
  "network.request.dropped": "drop",
  "network.request.timedout": "timeout",
  "network.response.sent": "response",
  "network.response.received": "response",
  "network.response.dropped": "drop",
  "message.published": "message",
  "message.delivered": "message",
  "message.acknowledged": "message",
  "message.ack.stale": "message",
  "message.retry.scheduled": "retry",
  "database.transaction.committed": "commit",
  "database.transaction.rolledback": "rollback",
  "external.effect.committed": "external",
  "fault.rule.matched": "fault",
  "fault.effect.selected": "fault",
  "database.transaction.rejected": "failure",
  "service.handler.failed": "failure",
  "message.nacked": "failure",
  "message.dead": "failure",
  "kv.condition.failed": "failure",
  "kv.changed": "kv",
  "kv.expired": "kv",
  "runtime.log": "log",
  "scenario.assertion.evaluated": "check",
} as const satisfies Readonly<Record<string, RecordKind>>;

/** A stored type the milestone table names. Presentation wording tables are typed by it. */
export type MilestoneType = keyof typeof milestoneKinds;

/**
 * Types in `milestoneKinds` that are not a canonical contract type, plus any
 * deviation a caller must be able to test. Empty in a healthy tree.
 */
export const milestoneTypeList: readonly MilestoneType[] = Object.keys(milestoneKinds) as readonly MilestoneType[];

/** The teaching category of one stored record, or undefined when the record is not a milestone. */
export function recordKind(observation: Observation): RecordKind | undefined {
  const kind = (milestoneKinds as Readonly<Record<string, RecordKind | undefined>>)[observation.type];
  if (kind !== undefined) return kind;
  // The document keeps every fault record, not only the two named ones.
  if (observation.type.startsWith("fault.")) return "fault";
  return undefined;
}

export type MovementKind = "request" | "response" | "message";

/** Presentation link identity, supplied by the layer that draws the architecture. */
export interface MovementEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relationship: "request" | "subscription" | "publication";
}

/** One span's stored records and the spans nested under it. */
export interface SpanNode {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly observations: readonly Observation[];
  readonly children: SpanNode[];
}

export interface TraceView {
  readonly traceId: string;
  readonly roots: SpanNode[];
  readonly unspanned: Observation[];
  readonly causation: readonly { readonly effectId: string; readonly causeId: string; readonly causeFound: boolean }[];
}

export interface Correlation {
  readonly cause?: Observation;
  /** Set when the stored cause id names nothing in this history. */
  readonly unresolvedCauseId?: string;
  readonly parentObservations: readonly Observation[];
  readonly effects: readonly Observation[];
}

/** The span tree of one stored trace, plus the spans it does not cover and its causation links. */
export function traceView(observations: readonly Observation[], traceId: string): TraceView {
  const members = orderObservations(observations).filter(item => item.traceId === traceId);
  const grouped = new Map<string, Observation[]>();
  const unspanned: Observation[] = [];
  const parentOf = new Map<string, string>();
  for (const item of members) {
    if (item.spanId === undefined) {
      unspanned.push(item);
      continue;
    }
    const group = grouped.get(item.spanId);
    if (group) group.push(item);
    else grouped.set(item.spanId, [item]);
    if (item.parentSpanId !== undefined && !parentOf.has(item.spanId)) parentOf.set(item.spanId, item.parentSpanId);
  }
  const nodes = new Map<string, { spanId: string; parentSpanId?: string; observations: readonly Observation[]; children: SpanNode[] }>();
  for (const [spanId, group] of grouped) {
    const parentSpanId = parentOf.get(spanId);
    nodes.set(spanId, { spanId, ...(parentSpanId !== undefined ? { parentSpanId } : {}), observations: group, children: [] });
  }
  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.parentSpanId;
    const parent = parentId !== undefined && acyclic(node.spanId, parentId, parentOf) ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const known = new Set(observations.map(item => item.id));
  const causation = members.flatMap(item => item.causationId === undefined ? [] : [{
    effectId: item.id,
    causeId: item.causationId,
    causeFound: known.has(item.causationId),
  }]);
  return { traceId, roots, unspanned, causation };
}

/** The stored cause, parent span records, and effects of one record. */
export function correlation(observations: readonly Observation[], observation: Observation): Correlation {
  const cause = observation.causationId === undefined ? undefined : observations.find(item => item.id === observation.causationId);
  const parentObservations = observation.parentSpanId === undefined ? [] : orderObservations(observations).filter(item =>
    item.traceId === observation.traceId && item.spanId === observation.parentSpanId);
  const effects = orderObservations(observations).filter(item => item.id !== observation.id && (
    item.causationId === observation.id
    || (observation.traceId !== undefined && item.traceId === observation.traceId && observation.spanId !== undefined
      && item.parentSpanId === observation.spanId && item.spanId !== observation.spanId)
  ));
  return {
    ...(cause !== undefined ? { cause } : {}),
    ...(observation.causationId !== undefined && cause === undefined ? { unresolvedCauseId: observation.causationId } : {}),
    parentObservations,
    effects,
  };
}

/** A movement the record itself states. Every field is a stored type, a stored
 * source and target, or a stored time. No edge is resolved here, because
 * link identity belongs to the presentation that draws it. Its sentence is
 * produced at render time by `movementText`, so it never outlives the language.
 */
export interface Movement {
  readonly observationId: string;
  readonly sequence: number;
  readonly time: SimulationTime;
  readonly kind: MovementKind;
  /** The stored observation type: a code, never translated. */
  readonly type: string;
  readonly relationship: MovementEdge["relationship"];
  readonly from: string;
  readonly to?: string;
}

/** One sentence naming the stored type, route, and virtual time. An unknown type shows its raw code. */
export function movementText(movement: Movement, m: Messages, names?: ComponentNames): string {
  // The sentence names components by display name (#103); `from` and `to` keep the stored IDs.
  const params = { source: displayName(names, movement.from), ...(movement.to !== undefined ? { target: displayName(names, movement.to) } : {}), time: movement.time };
  const message = Object.hasOwn(m.records.movement, movement.type) ? m.records.movement[movement.type as keyof typeof m.records.movement] : undefined;
  return message !== undefined ? message(params) : m.records.movementUnknown({ ...params, type: movement.type });
}

const REQUEST_TYPES: ReadonlySet<string> = new Set([
  "network.request.sent",
  "network.request.delivered",
  "network.request.dropped",
  "network.request.timedout",
]);
const RESPONSE_TYPES: ReadonlySet<string> = new Set([
  "network.response.sent",
  "network.response.dropped",
  "network.response.received",
]);

/**
 * The movement this record states, or null when it travels no link. A record
 * that travels no link stays in Recorded history and is not a movement.
 */
export function movementOf(observation: Observation): Movement | null {
  if (REQUEST_TYPES.has(observation.type)) return leg("request", observation, observation.source, observation.target, "request");
  if (RESPONSE_TYPES.has(observation.type)) return leg("response", observation, observation.source, observation.target, "request");
  if (observation.type === "message.published") {
    return leg("message", observation, observation.source, storedText(observation, "destination") ?? entityId(observation, "destination"), "publication");
  }
  if (observation.type === "message.delivered") {
    const consumer = storedText(observation, "consumer") ?? observation.source;
    return leg("message", observation, entityId(observation, "destination") ?? observation.source, consumer, "subscription");
  }
  if (observation.type === "message.acknowledged") {
    // The acknowledgement leaves the consumer and travels back to the MessageBus.
    const consumer = storedText(observation, "consumer") ?? observation.source;
    return leg("message", observation, consumer, entityId(observation, "destination"), "subscription");
  }
  return null;
}

/**
 * Which way a movement runs along the drawn link: "forward" when it leaves the
 * link's source, "reverse" when it leaves the link's target. A response travels
 * a request link in reverse; an acknowledgement travels a subscription in reverse.
 */
export function edgeDirection(movement: Pick<Movement, "from">, edge: MovementEdge): "forward" | "reverse" {
  return edge.source === movement.from ? "forward" : "reverse";
}

/** The drawn link of this relationship that this movement travels, or undefined when none is drawn. */
export function edgeFor(movement: Movement, edges: readonly MovementEdge[]): MovementEdge | undefined {
  const relationship = movement.relationship;
  return edges.find(edge => edge.relationship === relationship && edge.source === movement.from && edge.target === movement.to)
    ?? edges.find(edge => edge.relationship === relationship && edge.source === movement.to && edge.target === movement.from);
}

/** Any drawn link between these two components, whatever its relationship. */
export function edgeBetween(edges: readonly MovementEdge[], from: string, to: string): MovementEdge | undefined {
  return edges.find(edge => edge.source === from && edge.target === to)
    ?? edges.find(edge => edge.source === to && edge.target === from);
}

export type PayloadVisibility = "visible" | "redacted" | "omitted";

/**
 * How much of the stored payload exists. A redacted or omitted payload is never
 * reconstructed: readers state the visibility and stop.
 */
export function payloadVisibility(observation: Observation): PayloadVisibility {
  if (!Object.hasOwn(observation, "data")) return "omitted";
  const data = observation.data;
  if (isRecord(data) && Object.keys(data).length === 1 && data.redacted === true) return "redacted";
  return "visible";
}

/** The stored delivery attempt, or undefined when the record stores none. */
export function attemptOf(observation: Observation): number | string | undefined {
  if (!isRecord(observation.data)) return undefined;
  const attempt = observation.data.attempt;
  return typeof attempt === "number" || typeof attempt === "string" ? attempt : undefined;
}

/** The attempt as stored, for a label. No attempt stores no suffix. */
export function attemptLabel(observation: Observation, m: Messages): string {
  const attempt = attemptOf(observation);
  return attempt === undefined ? "" : m.records.attemptSuffix(attempt);
}

/**
 * What a label adds from stored fields, so two records of one type can be told apart: the
 * delivery attempt, a business log's message, a key-value key, a rejection code or reason, and
 * a check's id and verdict. A redacted or omitted payload stores nothing to add.
 */
export function storedQualifier(observation: Observation, m: Messages): string {
  const q = m.records.qualifier;
  const detail = (key: string) => { const value = storedText(observation, key); return value === undefined ? "" : q.detail(value); };
  const code = (key: string) => { const value = storedText(observation, key); return value === undefined ? "" : q.code(value); };
  switch (observation.type) {
    case "message.delivered": return attemptLabel(observation, m);
    case "runtime.log": return detail("message");
    case "kv.changed": case "kv.expired": case "kv.condition.failed": return detail("key");
    case "database.transaction.rejected": case "service.handler.failed": return code("code");
    case "message.nacked": case "message.dead": return code("reason");
    case "scenario.assertion.evaluated": {
      const id = storedText(observation, "assertionId");
      const verdict = storedScalar(observation, "verdict");
      const passed = verdict === "true" ? true : verdict === "false" ? false : undefined;
      if (id === undefined) return passed === undefined ? "" : passed ? q.verdictPassed : q.verdictNotPassed;
      return passed === undefined ? q.checkId(id) : passed ? q.checkPassed(id) : q.checkNotPassed(id);
    }
    default: return "";
  }
}

/**
 * True for a check evaluation that repeats the previous evaluation of the same check with the
 * same stored verdict. Checks are evaluated at every boundary, so only the first result of each
 * check and each change of its result are teaching milestones. A record whose check id or
 * verdict is not stored is never treated as a repeat.
 */
export function repeatsCheckResult(observation: Observation, previous: ReadonlyMap<string, string>): boolean {
  if (observation.type !== "scenario.assertion.evaluated") return false;
  const id = storedText(observation, "assertionId");
  const verdict = storedScalar(observation, "verdict");
  return id !== undefined && verdict !== undefined && previous.get(id) === verdict;
}

/** Records the check result of an evaluation, for `repeatsCheckResult`. */
export function noteCheckResult(observation: Observation, previous: Map<string, string>): void {
  if (observation.type !== "scenario.assertion.evaluated") return;
  const id = storedText(observation, "assertionId");
  const verdict = storedScalar(observation, "verdict");
  if (id !== undefined && verdict !== undefined) previous.set(id, verdict);
}

/** A stored scalar field, read only when the payload is visible. */
export function storedText(observation: Observation, key: string): string | undefined {
  if (payloadVisibility(observation) !== "visible" || !isRecord(observation.data)) return undefined;
  const value = observation.data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A stored scalar field, read only when the payload is visible. Numbers and booleans become text. */
export function storedScalar(observation: Observation, key: string): string | undefined {
  if (payloadVisibility(observation) !== "visible" || !isRecord(observation.data)) return undefined;
  const value = observation.data[key];
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** A stored value inside the payload, addressed by a stored field path. */
export function storedAt(observation: Observation, keys: readonly string[]): CanonicalValue | undefined {
  if (payloadVisibility(observation) !== "visible") return undefined;
  let value: CanonicalValue | undefined = observation.data;
  for (const key of keys) {
    if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/** A stored scalar at a stored field path, read only when the payload is visible. */
export function storedScalarAt(observation: Observation, keys: readonly string[]): string | undefined {
  return scalar(storedAt(observation, keys));
}

/** Field names of a stored value at a stored field path, without the values. */
export function storedFieldsAt(observation: Observation, keys: readonly string[]): string | undefined {
  const value = storedAt(observation, keys);
  if (!isRecord(value)) return undefined;
  const names = Object.keys(value);
  return names.length > 0 ? names.join(", ") : undefined;
}

/** Field names of a stored nested value, without the values. */
export function bodyFields(observation: Observation, key: string): string | undefined {
  return storedFieldsAt(observation, [key]);
}

/** One stored before/after pair. Absent values stay absent. */
export interface RecordedChange {
  readonly table?: string;
  readonly key?: string;
  readonly before?: CanonicalValue;
  readonly after?: CanonicalValue;
}

/**
 * The stored changes of one record, or none. A redacted or omitted payload
 * contributes no evidence.
 */
export function recordedChanges(observation: Observation): readonly RecordedChange[] {
  if (payloadVisibility(observation) !== "visible" || !isRecord(observation.data)) return [];
  const data = observation.data;
  const changes: RecordedChange[] = [];
  if (Object.hasOwn(data, "before") || Object.hasOwn(data, "after")) {
    changes.push(change({ ...(Object.hasOwn(data, "before") ? { before: data.before } : {}), ...(Object.hasOwn(data, "after") ? { after: data.after } : {}) }));
  }
  if (Array.isArray(data.changes)) {
    data.changes.forEach((item, index) => {
      if (!isRecord(item) || (!Object.hasOwn(item, "before") && !Object.hasOwn(item, "after"))) return;
      const table = typeof item.table === "string" ? item.table : "";
      const key = typeof item.key === "string" ? item.key : "";
      changes.push(change({ ...(table ? { table } : {}), ...(key ? { key } : {}),
        ...(Object.hasOwn(item, "before") ? { before: item.before } : {}), ...(Object.hasOwn(item, "after") ? { after: item.after } : {}) }));
      void index;
    });
  }
  return changes;
}

/** One row of an assertion's stored evidence: an optional key and its stored fields as text. */
export interface EvidenceRow {
  readonly key?: string;
  readonly text: string;
}

/**
 * What a `scenario.assertion.evaluated` record stored (#165): the predicate's result at that
 * boundary and its evidence as rows. Undefined for any other record. Pure: it reads stored fields
 * only and never re-evaluates a predicate. A redacted or omitted payload, or a payload without
 * evidence, says so and reconstructs nothing.
 */
export type AssertionEvidence =
  | { readonly kind: "unavailable"; readonly visibility: Exclude<PayloadVisibility, "visible"> }
  | { readonly kind: "none"; readonly assertionId?: string; readonly passed?: boolean }
  | { readonly kind: "rows"; readonly assertionId?: string; readonly passed?: boolean; readonly rows: readonly EvidenceRow[] };

export function assertionEvidence(observation: Observation, m: Messages): AssertionEvidence | undefined {
  if (observation.type !== "scenario.assertion.evaluated") return undefined;
  const visibility = payloadVisibility(observation);
  if (visibility !== "visible") return { kind: "unavailable", visibility };
  const data = isRecord(observation.data) ? observation.data : {};
  const assertionId = typeof data.assertionId === "string" && data.assertionId.length > 0 ? data.assertionId : undefined;
  const passed = typeof data.verdict === "boolean" ? data.verdict : undefined;
  const common = { ...(assertionId !== undefined ? { assertionId } : {}), ...(passed !== undefined ? { passed } : {}) };
  if (!Object.hasOwn(data, "evidence")) return { kind: "none", ...common };
  return { kind: "rows", ...common, rows: evidenceRows(data.evidence!, m) };
}

/** Stored fields as one line, the form Service state uses: `field: value · field: value`. */
function fieldText(value: CanonicalValue, m: Messages): string {
  if (!isRecord(value)) return value === null || typeof value !== "object" ? String(value) : JSON.stringify(value);
  const entries = Object.entries(value);
  if (entries.length === 0) return m.records.noStoredFields;
  return entries.map(([key, item]) => `${key}: ${item !== null && typeof item === "object" ? JSON.stringify(item) : String(item)}`).join(" · ");
}

/**
 * Evidence as rows. A list gives one row per item; an object whose values are all objects (rows
 * keyed by ID) gives one keyed row per entry; an object of scalars (metrics) gives one row; any
 * other object gives one keyed row per field. An empty list or object gives no rows.
 */
function evidenceRows(evidence: CanonicalValue, m: Messages): readonly EvidenceRow[] {
  if (Array.isArray(evidence)) return evidence.map(item => ({ text: fieldText(item, m) }));
  if (!isRecord(evidence)) return [{ text: fieldText(evidence, m) }];
  const entries = Object.entries(evidence);
  if (entries.length === 0) return [];
  if (entries.every(([, value]) => isRecord(value))) return entries.map(([key, value]) => ({ key, text: fieldText(value, m) }));
  if (entries.every(([, value]) => value === null || typeof value !== "object")) return [{ text: fieldText(evidence, m) }];
  return entries.map(([key, value]) => ({
    key, text: Array.isArray(value) ? (value.length ? value.map(item => fieldText(item, m)).join("; ") : m.records.none) : fieldText(value, m),
  }));
}

/** The stored ids and states of one external change entry, or none. */
export function externalChanges(observation: Observation, key: string): readonly string[] {
  const entry = isRecord(observation.data) ? observation.data[key] : undefined;
  if (!isRecord(entry)) return [];
  const parts: string[] = [];
  for (const [group, values] of Object.entries(entry)) {
    if (!Array.isArray(values)) continue;
    for (const item of values) {
      if (!isRecord(item)) continue;
      const id = scalar(item.authorizationId) ?? scalar(item.paymentId) ?? scalar(item.operationId) ?? scalar(item.id);
      const status = scalar(item.status) ?? scalar(item.state);
      if (id !== undefined && status !== undefined) parts.push(`${id} ${status}`);
      else if (id !== undefined) parts.push(id);
    }
    if (parts.length > 0) return [`${group}: ${parts.join(", ")}`];
  }
  return parts;
}

function acyclic(child: string, parent: string, parentOf: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>([child]);
  let current: string | undefined = parent;
  while (current !== undefined) {
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentOf.get(current);
  }
  return true;
}

export function isRecord(value: unknown): value is Record<string, CanonicalValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function leg(
  kind: Movement["kind"],
  observation: Observation,
  from: string | undefined,
  to: string | undefined,
  relationship: MovementEdge["relationship"],
): Movement {
  const source = from && from.length > 0 ? from : observation.source;
  const target = to && to.length > 0 && to !== source ? to : undefined;
  return {
    observationId: observation.id,
    sequence: observation.sequence,
    time: observation.time,
    kind,
    type: observation.type,
    relationship,
    from: source,
    ...(target !== undefined ? { to: target } : {}),
  };
}

function change(value: RecordedChange): RecordedChange {
  return Object.freeze(value);
}

function entityId(observation: Observation, kind: string): string | undefined {
  return observation.entityRefs?.find(entity => entity.kind === kind)?.id;
}

function scalar(value: CanonicalValue | undefined): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
