import type {
  ApplicationError,
  CanonicalValue,
  EntityRef,
  Observation,
  ObservationFilter,
  SimulationTime,
} from "@distlab/contracts";

/** Fixed row geometry so the timeline window stays bounded at the history baseline. */
export const TIMELINE_ROW_HEIGHT = 44;
export const TIMELINE_VIEWPORT = 320;

export interface MovementEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly relationship: "request" | "subscription" | "publication";
}

export interface MovementCue {
  readonly observationId: string;
  readonly sequence: number;
  readonly time: number;
  readonly kind: "request" | "response" | "message";
  readonly phase: string;
  readonly nodeIds: readonly string[];
  readonly edgeId?: string;
  readonly text: string;
}

export type LearningTimelineItem =
  | { readonly kind: "observation"; readonly observation: Observation; readonly summary: string }
  | { readonly kind: "group"; readonly id: string; readonly summary: string; readonly observations: readonly Observation[] };

/**
 * A read-only teaching projection. Only adjacent scheduler/clock bookkeeping and
 * byte-for-byte unchanged assertion evaluations collapse; every other record,
 * including deliveries, retries, effects, and faults, remains its own item.
 */
export function learningTimeline(observations: readonly Observation[]): readonly LearningTimelineItem[] {
  const ordered = orderObservations(observations);
  const items: LearningTimelineItem[] = [];
  for (let index = 0; index < ordered.length;) {
    const first = ordered[index]!;
    const groupKind = collapsibleKind(first);
    if (!groupKind) {
      items.push({ kind: "observation", observation: first, summary: learningSummary(first) });
      index += 1;
      continue;
    }
    const members = [first];
    let cursor = index + 1;
    while (cursor < ordered.length && sameCollapsedContext(first, ordered[cursor]!, groupKind)) {
      members.push(ordered[cursor]!);
      cursor += 1;
    }
    if (members.length === 1) items.push({ kind: "observation", observation: first, summary: learningSummary(first) });
    else items.push({
      kind: "group",
      id: `learning:${groupKind}:${members[0]!.id}`,
      summary: groupKind === "setup" ? "Simulation scheduling and clock bookkeeping" : "Unchanged assertion evaluations",
      observations: members,
    });
    index = cursor;
  }
  return items;
}

/** Human-readable labels describe only the stored observation type, never inferred elapsed time or causation. */
export function learningSummary(observation: Observation): string {
  const type = observation.type;
  if (type === "network.request.sent") return "Request sent";
  if (type === "network.request.delivered") return "Request delivered";
  if (type === "network.request.timedout") return "Request timed out";
  if (type === "network.response.sent") return "Response sent";
  if (type === "network.response.received") return "Response received";
  if (type === "network.response.dropped") return "Response dropped";
  if (type === "message.published") return "Message published";
  if (type === "message.delivered") return `Message delivered${attemptLabel(observation)}`;
  if (type === "message.acknowledged") return "Message acknowledged";
  if (type === "database.transaction.committed") return "Database transaction committed";
  if (type === "database.transaction.rolled_back") return "Database transaction rolled back";
  if (type === "external.effect.committed") return "External side effect committed";
  if (type.startsWith("fault.")) return "Fault selected";
  return type;
}

export interface GraphEmphasis {
  readonly nodeIds: readonly string[];
  readonly edgeId?: string;
  readonly kind?: MovementCue["kind"];
  readonly text?: string;
  /** Changes when a movement cue should replay its transient paint. */
  readonly pulseId?: string;
}

export interface ChangeEvidence {
  readonly label: string;
  readonly before?: CanonicalValue;
  readonly after?: CanonicalValue;
}

export type PayloadVisibility = "visible" | "redacted" | "omitted";

export interface SpanNode {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly observations: readonly Observation[];
  readonly children: readonly SpanNode[];
}

export interface TraceView {
  readonly traceId: string;
  readonly roots: readonly SpanNode[];
  readonly unspanned: readonly Observation[];
  readonly causation: readonly { readonly effectId: string; readonly causeId: string; readonly causeFound: boolean }[];
}

export interface Correlation {
  readonly cause?: Observation;
  readonly unresolvedCauseId?: string;
  readonly parentObservations: readonly Observation[];
  readonly effects: readonly Observation[];
}

export type FilterParse =
  | { readonly ok: true; readonly filter: ObservationFilter }
  | { readonly ok: false; readonly message: string };

export interface TerminalMark {
  readonly code: string | null;
  readonly historyComplete: boolean | null;
  readonly time: number | null;
  readonly lastObservationId: string | null;
}

const REQUEST_TYPES = new Set([
  "network.request.sent",
  "network.request.delivered",
  "network.request.dropped",
  "network.request.timedout",
]);
const RESPONSE_TYPES = new Set([
  "network.response.sent",
  "network.response.dropped",
  "network.response.received",
]);

export function orderObservations(observations: readonly Observation[]): readonly Observation[] {
  if (observations.every((observation, index) => index === 0 || observations[index - 1]!.sequence <= observation.sequence)) return observations;
  return observations.map((observation, index) => ({ observation, index }))
    .sort((left, right) => left.observation.sequence - right.observation.sequence || left.index - right.index)
    .map(item => item.observation);
}

/** Same AND rules as ExecutionHistoryReader.query: inclusive time, exact type, source or target, trace, event, and entity kind plus id. */
export function filterObservations(observations: readonly Observation[], filter: ObservationFilter): readonly Observation[] {
  return orderObservations(observations).filter(record => {
    if (filter.fromTime !== undefined && record.time < filter.fromTime) return false;
    if (filter.toTime !== undefined && record.time > filter.toTime) return false;
    if (filter.type !== undefined && record.type !== filter.type) return false;
    if (filter.component !== undefined && record.source !== filter.component && record.target !== filter.component) return false;
    if (filter.traceId !== undefined && record.traceId !== filter.traceId) return false;
    if (filter.eventId !== undefined && record.eventId !== filter.eventId) return false;
    if (filter.entity !== undefined && !(record.entityRefs ?? []).some(entity => entity.kind === filter.entity!.kind && entity.id === filter.entity!.id)) return false;
    return true;
  });
}

export function parseTimelineFilter(input: {
  readonly fromTime: string;
  readonly toTime: string;
  readonly type: string;
  readonly component: string;
  readonly traceId: string;
  readonly eventId: string;
  readonly entityKind: string;
  readonly entityId: string;
}): FilterParse {
  const from = bound(input.fromTime);
  const to = bound(input.toTime);
  if (from === "invalid" || to === "invalid") return { ok: false, message: "Virtual time filters use whole simulation times." };
  if (from !== undefined && to !== undefined && from > to) return { ok: false, message: "Virtual time from is after virtual time to." };
  const type = text(input.type);
  const component = text(input.component);
  const traceId = text(input.traceId);
  const eventId = text(input.eventId);
  const entityKind = text(input.entityKind);
  const entityId = text(input.entityId);
  if ((entityKind === undefined) !== (entityId === undefined)) return { ok: false, message: "Entity filters need both a kind and an id." };
  const entity: EntityRef | undefined = entityKind !== undefined && entityId !== undefined ? { kind: entityKind, id: entityId } : undefined;
  return {
    ok: true,
    filter: {
      ...(from !== undefined ? { fromTime: from as SimulationTime } : {}),
      ...(to !== undefined ? { toTime: to as SimulationTime } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(component !== undefined ? { component } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(eventId !== undefined ? { eventId } : {}),
      ...(entity !== undefined ? { entity } : {}),
    },
  };
}

export function continuesHistory(previous: readonly Observation[], next: readonly Observation[]): boolean {
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index];
    const after = next[index];
    if (!before || !after || before.id !== after.id || before.sequence !== after.sequence) return false;
  }
  return true;
}

export function visibleRowRange(count: number, scrollTop: number, viewport: number, rowHeight: number, overscan = 6): { start: number; end: number } {
  if (count <= 0 || viewport <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((Math.max(0, scrollTop) + viewport) / rowHeight) + overscan);
  return { start, end: Math.max(start, end) };
}

export function payloadVisibility(observation: Observation): PayloadVisibility {
  if (!Object.hasOwn(observation, "data")) return "omitted";
  const data = observation.data;
  if (isRecord(data) && Object.keys(data).length === 1 && data.redacted === true) return "redacted";
  return "visible";
}

/** Reads only stored before/after fields. Redacted and omitted payloads contribute no evidence. */
export function changeEvidence(observation: Observation): readonly ChangeEvidence[] {
  if (payloadVisibility(observation) !== "visible" || !isRecord(observation.data)) return [];
  const data = observation.data;
  const evidence: ChangeEvidence[] = [];
  if (Object.hasOwn(data, "before") || Object.hasOwn(data, "after")) evidence.push(change("Recorded change", data));
  if (Array.isArray(data.changes)) {
    data.changes.forEach((item, index) => {
      if (!isRecord(item) || (!Object.hasOwn(item, "before") && !Object.hasOwn(item, "after"))) return;
      const table = typeof item.table === "string" ? item.table : "";
      const key = typeof item.key === "string" ? item.key : "";
      const label = table ? `${table}${key ? ` ${key}` : ""}` : `Change ${index + 1}`;
      evidence.push(change(label, item));
    });
  }
  return evidence;
}

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

export function movementCue(observation: Observation, edges: readonly MovementEdge[]): MovementCue | null {
  if (REQUEST_TYPES.has(observation.type)) return leg("request", observation, observation.source, observation.target, edges, "request");
  if (RESPONSE_TYPES.has(observation.type)) return leg("response", observation, observation.source, observation.target, edges, "request");
  if (observation.type === "message.published") {
    return leg("message", observation, observation.source, textField(observation, "destination") ?? entityId(observation, "destination"), edges, "publication");
  }
  if (observation.type === "message.delivered" || observation.type === "message.acknowledged") {
    const consumer = textField(observation, "consumer") ?? observation.source;
    return leg("message", observation, entityId(observation, "destination") ?? observation.source, consumer, edges, "subscription");
  }
  return null;
}

/** Selection highlight, or the movement cue when the observation travels a link. */
export function emphasisFor(observation: Observation, edges: readonly MovementEdge[]): GraphEmphasis {
  const cue = movementCue(observation, edges);
  if (cue) {
    return {
      nodeIds: cue.nodeIds,
      ...(cue.edgeId !== undefined ? { edgeId: cue.edgeId } : {}),
      kind: cue.kind,
      text: cue.text,
      pulseId: cue.observationId,
    };
  }
  const involved = involvement(observation, edges);
  const where = observation.target !== undefined && observation.target !== observation.source
    ? `${observation.source} to ${observation.target}` : observation.source;
  return { ...involved, text: `Selected ${observation.type} at ${where} at virtual time ${observation.time}. No request or message movement.` };
}

/** CSS-safe token so a new cue restarts the transient stroke without putting observation ids in a class. */
export function movementPulseClass(id: string): string {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return `pulse-${(hash >>> 0).toString(36)}`;
}

/**
 * Move the playback cursor within an already recorded list.
 * The cursor is an index into filtered UI rows. It does not allocate observations.
 */
export function playbackAdvance(index: number, count: number): { readonly cursor: number; readonly playing: boolean } {
  if (count <= 0) return { cursor: -1, playing: false };
  const next = index + 1;
  if (next >= count) return { cursor: Math.min(Math.max(index, 0), count - 1), playing: false };
  return { cursor: next, playing: true };
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
      reason: "Playing the visible timeline. Pause stops the cursor. Virtual time does not change.",
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
  if (phase === "playing") return "Playing the visible timeline. Pause stops the cursor. Virtual time does not change.";
  if (phase === "paused") return "Playback is paused.";
  if (phase === "ended") return "Playback reached the end of the visible results. Restart timeline plays from the first visible observation.";
  return control.reason;
}

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

export function involvement(observation: Observation, edges: readonly MovementEdge[]): GraphEmphasis {
  const cue = movementCue(observation, edges);
  if (cue) return { nodeIds: cue.nodeIds, ...(cue.edgeId !== undefined ? { edgeId: cue.edgeId } : {}), kind: cue.kind };
  const nodeIds = observation.target !== undefined && observation.target !== observation.source
    ? [observation.source, observation.target] : [observation.source];
  const edge = observation.target !== undefined ? findEdge(edges, observation.source, observation.target) : undefined;
  return { nodeIds, ...(edge !== undefined ? { edgeId: edge.id } : {}) };
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

function collapsibleKind(observation: Observation): "setup" | "assertion" | undefined {
  if (observation.type.startsWith("scheduler.") || observation.type.startsWith("clock.")) return "setup";
  if (observation.type === "scenario.assertion.evaluated") return "assertion";
  return undefined;
}

function sameCollapsedContext(first: Observation, candidate: Observation, kind: "setup" | "assertion"): boolean {
  if (collapsibleKind(candidate) !== kind) return false;
  // Scheduler/clock records are adjacent implementation bookkeeping. Assertions
  // collapse only when their stored result is unchanged, so a changed result is visible.
  return kind === "setup" || (JSON.stringify(first.data) === JSON.stringify(candidate.data)
    && first.source === candidate.source && first.target === candidate.target
    && first.traceId === candidate.traceId && first.eventId === candidate.eventId);
}

function attemptLabel(observation: Observation): string {
  if (!isRecord(observation.data)) return "";
  const attempt = observation.data.attempt;
  return typeof attempt === "number" || typeof attempt === "string" ? ` (attempt ${attempt})` : "";
}

function leg(
  kind: MovementCue["kind"],
  observation: Observation,
  from: string | undefined,
  to: string | undefined,
  edges: readonly MovementEdge[],
  relationship: MovementEdge["relationship"],
): MovementCue {
  const source = from && from.length > 0 ? from : observation.source;
  const target = to && to.length > 0 && to !== source ? to : undefined;
  const edge = target !== undefined ? findEdge(edges, source, target, relationship) : undefined;
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
    nodeIds: target !== undefined ? [source, target] : [source],
    ...(edge !== undefined ? { edgeId: edge.id } : {}),
    text,
  };
}

function findEdge(edges: readonly MovementEdge[], from: string, to: string, relationship?: MovementEdge["relationship"]): MovementEdge | undefined {
  if (relationship !== undefined) return edges.find(edge => edge.relationship === relationship && edge.source === from && edge.target === to)
    ?? edges.find(edge => edge.relationship === relationship && edge.source === to && edge.target === from);
  return edges.find(edge => edge.source === from && edge.target === to)
    ?? edges.find(edge => edge.source === to && edge.target === from);
}

function change(label: string, value: Record<string, CanonicalValue>): ChangeEvidence {
  return {
    label,
    ...(Object.hasOwn(value, "before") ? { before: value.before } : {}),
    ...(Object.hasOwn(value, "after") ? { after: value.after } : {}),
  };
}

function entityId(observation: Observation, kind: string): string | undefined {
  return observation.entityRefs?.find(entity => entity.kind === kind)?.id;
}

function textField(observation: Observation, key: string): string | undefined {
  if (!Object.hasOwn(observation, "data") || !isRecord(observation.data)) return undefined;
  const value = observation.data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function bound(value: string): number | undefined | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) return "invalid";
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

function text(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function listLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function isRecord(value: unknown): value is Record<string, CanonicalValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
