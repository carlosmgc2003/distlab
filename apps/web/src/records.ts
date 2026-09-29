import type { CanonicalValue, Observation, SimulationTime } from "@distlab/contracts";

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
  | "timeout";

/** Every teaching category, in legend order. */
export const recordKinds: readonly RecordKind[] = [
  "request", "response", "message", "retry", "commit", "rollback", "external", "fault", "drop", "timeout",
];

/**
 * The teaching milestone set, transcribed from the Story view section of
 * `docs/learning-timeline.md`. `docs/learning-timeline.md` is the source of
 * truth; `tests/records.test.ts` reads that document and fails when the two
 * disagree.
 *
 * Two documented deviations, both deliberate:
 *
 * - `runtime.log` is absent here. The document does not list it as a milestone,
 *   and the document wins. Those records stay in Learning and Raw.
 * - `network.request.timedout` is present here but not in the document. It is
 *   pending a ruling, and the same test fails while it is unresolved.
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
 * source and target, or text built from them. No edge is resolved here, because
 * link identity belongs to the presentation that draws it.
 */
export interface Movement {
  readonly observationId: string;
  readonly sequence: number;
  readonly time: SimulationTime;
  readonly kind: MovementKind;
  /** Stored type's last segment, or the stored phase word. */
  readonly phase: string;
  readonly relationship: MovementEdge["relationship"];
  readonly from: string;
  readonly to?: string;
  /** One sentence naming the stored type, route, and virtual time. */
  readonly text: string;
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
  if (observation.type === "message.delivered" || observation.type === "message.acknowledged") {
    const consumer = storedText(observation, "consumer") ?? observation.source;
    return leg("message", observation, entityId(observation, "destination") ?? observation.source, consumer, "subscription");
  }
  return null;
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
export function attemptLabel(observation: Observation): string {
  const attempt = attemptOf(observation);
  return attempt === undefined ? "" : ` (attempt ${attempt})`;
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
  const phase = observation.type === "message.published" ? "published"
    : observation.type === "message.delivered" ? "delivered"
    : observation.type === "message.acknowledged" ? "acknowledged"
    : observation.type.endsWith(".timedout") ? "timed out"
    : observation.type.split(".").at(-1) ?? observation.type;
  const where = target !== undefined ? `from ${source} to ${target}` : `at ${source}`;
  const text = kind === "request" ? `Request ${phase} ${where} at virtual time ${observation.time}.`
    : kind === "response" ? `Response ${phase} ${where} at virtual time ${observation.time}.`
    : phase === "acknowledged" && target !== undefined ? `Message acknowledged by ${target} on ${source} at virtual time ${observation.time}.`
    : phase === "published" ? `Message published ${where} at virtual time ${observation.time}.`
    : phase === "delivered" ? `Message delivered ${where} at virtual time ${observation.time}.`
    : `Message ${phase} ${where} at virtual time ${observation.time}.`;
  return {
    observationId: observation.id,
    sequence: observation.sequence,
    time: observation.time,
    kind,
    phase,
    relationship,
    from: source,
    ...(target !== undefined ? { to: target } : {}),
    text,
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
