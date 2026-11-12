import type { EntityRef, Observation, ObservationFilter, SimulationTime } from "@distlab/contracts";
import { orderObservations } from "./records.ts";
import type { Messages } from "./i18n/catalog.ts";
import type { QuickViewId } from "./timeline-quick-views.ts";

/** Popup size for recorded values. The applied filter still uses the full visible history. */
export const TIMELINE_SUGGESTION_LIMIT = 8;

export type TextMatchMode = "exact" | "prefix" | "contains";

export interface TextCriterion {
  readonly value: string;
  readonly mode: TextMatchMode;
}

/** UI-owned projection over a history snapshot. It is not an ExecutionHistoryReader filter. */
export interface TimelineQuery {
  readonly fromTime?: SimulationTime;
  readonly toTime?: SimulationTime;
  readonly type?: TextCriterion;
  readonly component?: TextCriterion;
  readonly traceId?: TextCriterion;
  readonly eventId?: TextCriterion;
  readonly entityKind?: TextCriterion;
  readonly entityId?: TextCriterion;
}

export interface TimelineDraft {
  readonly fromTime: string;
  readonly toTime: string;
  readonly type: string;
  readonly typeMode: TextMatchMode;
  readonly component: string;
  readonly componentMode: TextMatchMode;
  readonly traceId: string;
  readonly traceMode: TextMatchMode;
  readonly eventId: string;
  readonly eventMode: TextMatchMode;
  readonly entityKind: string;
  readonly entityKindMode: TextMatchMode;
  readonly entityId: string;
  readonly entityIdMode: TextMatchMode;
}

export const emptyTimelineDraft: TimelineDraft = {
  fromTime: "", toTime: "", type: "", typeMode: "exact", component: "", componentMode: "exact",
  traceId: "", traceMode: "exact", eventId: "", eventMode: "exact", entityKind: "", entityKindMode: "exact",
  entityId: "", entityIdMode: "exact",
};

export type TextFilterField = "type" | "component" | "traceId" | "eventId" | "entityKind" | "entityId";
export type TimelineFilterField = TextFilterField | "fromTime" | "toTime";

/**
 * Why a draft does not parse, as a code and its parameters. Review navigation keeps this in
 * its state and `queryErrorText` renders it, so a language switch never leaves stale text.
 */
export type QueryError =
  | { readonly kind: "not-whole-time"; readonly field: "fromTime" | "toTime"; readonly value: string }
  | { readonly kind: "time-order"; readonly from: number; readonly to: number };

export type QueryParse =
  | { readonly ok: true; readonly query: TimelineQuery }
  | { readonly ok: false; readonly error: QueryError };

export function queryErrorText(error: QueryError, m: Messages): string {
  return error.kind === "not-whole-time"
    ? m.timeline.queryError.notWholeTime({ field: error.field, value: error.value })
    : m.timeline.queryError.timeOrder({ from: error.from, to: error.to });
}

/** A constraint a reveal or a trace narrowing removed. Identified by code, so it is deduplicated without display text. */
export type ClearedField = "fromTime" | "toTime" | "type" | "component" | "traceId" | "eventId" | "entity";

export interface ComponentTitle {
  readonly id: string;
  readonly title: string;
}

export interface FilterChoice {
  readonly value: string;
  readonly label: string;
}

export interface TimelineSuggestions {
  readonly types: readonly FilterChoice[];
  readonly components: readonly FilterChoice[];
  readonly traces: readonly FilterChoice[];
  readonly events: readonly FilterChoice[];
  readonly entityKinds: readonly FilterChoice[];
  readonly entityIds: readonly FilterChoice[];
}

export interface ActiveFilterChip {
  readonly field: TimelineFilterField;
  readonly label: string;
  readonly removeLabel: string;
}

/** Read-only projection. Exact mode matches ExecutionHistoryReader; prefix and contains stay in the UI. */
export function queryTimeline(observations: readonly Observation[], query: TimelineQuery): readonly Observation[] {
  return orderObservations(observations).filter(record => matchesQuery(record, query));
}

export function parseTimelineQuery(draft: TimelineDraft): QueryParse {
  const from = bound(draft.fromTime, "fromTime");
  if (!from.ok) return from;
  const to = bound(draft.toTime, "toTime");
  if (!to.ok) return to;
  if (from.value !== undefined && to.value !== undefined && from.value > to.value) {
    return { ok: false, error: { kind: "time-order", from: from.value, to: to.value } };
  }
  const type = criterion(draft.type, draft.typeMode);
  const component = criterion(draft.component, draft.componentMode);
  const traceId = criterion(draft.traceId, draft.traceMode);
  const eventId = criterion(draft.eventId, draft.eventMode);
  const entityKind = criterion(draft.entityKind, draft.entityKindMode);
  const entityId = criterion(draft.entityId, draft.entityIdMode);
  return {
    ok: true,
    query: {
      ...(from.value !== undefined ? { fromTime: from.value as SimulationTime } : {}),
      ...(to.value !== undefined ? { toTime: to.value as SimulationTime } : {}),
      ...(type ? { type } : {}),
      ...(component ? { component } : {}),
      ...(traceId ? { traceId } : {}),
      ...(eventId ? { eventId } : {}),
      ...(entityKind ? { entityKind } : {}),
      ...(entityId ? { entityId } : {}),
    },
  };
}

/**
 * The reader filter when every active text criterion is exact and entity kind and id are both present or both absent.
 * Prefix, contains, and a single entity side are UI projections and return undefined.
 */
export function readerFilter(query: TimelineQuery): ObservationFilter | undefined {
  const criteria = [query.type, query.component, query.traceId, query.eventId, query.entityKind, query.entityId];
  if (criteria.some(item => item !== undefined && item.mode !== "exact")) return undefined;
  if ((query.entityKind === undefined) !== (query.entityId === undefined)) return undefined;
  const entity: EntityRef | undefined = query.entityKind !== undefined && query.entityId !== undefined
    ? { kind: query.entityKind.value, id: query.entityId.value } : undefined;
  return {
    ...(query.fromTime !== undefined ? { fromTime: query.fromTime } : {}),
    ...(query.toTime !== undefined ? { toTime: query.toTime } : {}),
    ...(query.type !== undefined ? { type: query.type.value } : {}),
    ...(query.component !== undefined ? { component: query.component.value } : {}),
    ...(query.traceId !== undefined ? { traceId: query.traceId.value } : {}),
    ...(query.eventId !== undefined ? { eventId: query.eventId.value } : {}),
    ...(entity !== undefined ? { entity } : {}),
  };
}

/** Distinct canonical values from this history snapshot, sorted by code unit. Payload fields are ignored. */
export function timelineSuggestions(observations: readonly Observation[], titles: readonly ComponentTitle[], m: Messages): TimelineSuggestions {
  const types = new Set<string>();
  const components = new Set<string>();
  const traces = new Set<string>();
  const events = new Set<string>();
  const kinds = new Set<string>();
  const entityIds = new Set<string>();
  for (const observation of observations) {
    add(types, observation.type);
    add(components, observation.source);
    add(components, observation.target);
    add(traces, observation.traceId);
    add(events, observation.eventId);
    for (const entity of observation.entityRefs ?? []) {
      add(kinds, entity.kind);
      add(entityIds, entity.id);
    }
  }
  const plain = (value: string): FilterChoice => ({ value, label: value });
  return {
    types: sorted(types).map(plain),
    components: sorted(components).map(value => ({ value, label: componentLabel(value, titles, m) })),
    traces: sorted(traces).map(plain),
    events: sorted(events).map(plain),
    entityKinds: sorted(kinds).map(plain),
    entityIds: sorted(entityIds).map(plain),
  };
}

export function componentLabel(id: string, titles: readonly ComponentTitle[], m: Messages): string {
  const provided = titles.find(item => item.id === id)?.title;
  const title = provided ?? (id === "simulation" ? m.timeline.simulation : id);
  return title === id ? id : `${title} (${id})`;
}

/** Case-sensitive substring over the stored value and the displayed label. Matching the stored value never depends on the language. */
export function visibleChoices(choices: readonly FilterChoice[], query: string, limit = TIMELINE_SUGGESTION_LIMIT): {
  readonly shown: readonly FilterChoice[];
  readonly hidden: number;
} {
  const needle = query.trim();
  const matches = needle.length === 0 ? choices.slice() : choices.filter(choice => choice.value.includes(needle) || choice.label.includes(needle));
  return { shown: matches.slice(0, limit), hidden: Math.max(0, matches.length - limit) };
}

export function activeFilterChips(query: TimelineQuery, titles: readonly ComponentTitle[], m: Messages): readonly ActiveFilterChip[] {
  const copy = m.timeline.chip;
  const chips: ActiveFilterChip[] = [];
  if (query.fromTime !== undefined) chips.push({ field: "fromTime", label: copy.timeFrom(query.fromTime), removeLabel: copy.removeTimeFrom });
  if (query.toTime !== undefined) chips.push({ field: "toTime", label: copy.timeTo(query.toTime), removeLabel: copy.removeTimeTo });
  for (const item of textFields(query)) {
    if (item.criterion === undefined) continue;
    const { noun, inline } = m.timeline.fieldNoun[item.field];
    const value = item.criterion.mode === "exact" && item.field === "component"
      ? componentLabel(item.criterion.value, titles, m) : item.criterion.value;
    chips.push({ field: item.field, label: copy[item.criterion.mode]({ noun, value }), removeLabel: copy.removeField(inline) });
  }
  return chips;
}

function textFields(query: TimelineQuery): readonly { field: TextFilterField; criterion: TextCriterion | undefined }[] {
  return [
    { field: "type", criterion: query.type },
    { field: "component", criterion: query.component },
    { field: "traceId", criterion: query.traceId },
    { field: "eventId", criterion: query.eventId },
    { field: "entityKind", criterion: query.entityKind },
    { field: "entityId", criterion: query.entityId },
  ];
}

/**
 * Why no observation matches. `resetQuickView` names the active quick view so the closing
 * sentence can point at its chip; without one the sentence points at the filter chips.
 */
export function emptyFilterExplanation(
  query: TimelineQuery,
  observations: readonly Observation[],
  titles: readonly ComponentTitle[],
  resetQuickView: QuickViewId | undefined,
  m: Messages,
): string {
  const copy = m.timeline.explain;
  const suggestions = timelineSuggestions(observations, titles, m);
  const sentences = [copy.intro];
  const explainField = (field: TextFilterField, criterion: TextCriterion | undefined, choices: readonly FilterChoice[], valuesOf: (observation: Observation) => readonly string[]) =>
    explain(sentences, field, criterion, observations, choices, valuesOf, m);
  explainField("type", query.type, suggestions.types, observation => [observation.type]);
  explainField("component", query.component, suggestions.components, observation => [observation.source, ...(observation.target !== undefined ? [observation.target] : [])]);
  explainField("traceId", query.traceId, suggestions.traces, observation => observation.traceId !== undefined ? [observation.traceId] : []);
  explainField("eventId", query.eventId, suggestions.events, observation => observation.eventId !== undefined ? [observation.eventId] : []);
  explainField("entityKind", query.entityKind, suggestions.entityKinds, observation => (observation.entityRefs ?? []).map(entity => entity.kind));
  explainField("entityId", query.entityId, suggestions.entityIds, observation => (observation.entityRefs ?? []).map(entity => entity.id));
  if (query.fromTime !== undefined && query.toTime !== undefined) sentences.push(copy.timeBoth({ from: query.fromTime, to: query.toTime }));
  else if (query.fromTime !== undefined) sentences.push(copy.timeFrom(query.fromTime));
  else if (query.toTime !== undefined) sentences.push(copy.timeTo(query.toTime));
  sentences.push(resetQuickView === undefined ? copy.resetDefault : copy.resetQuickView(m.timeline.quickView.views[resetQuickView].inline));
  return sentences.join(" ");
}

export function clearTimelineField(draft: TimelineDraft, field: TimelineFilterField): TimelineDraft {
  switch (field) {
    case "fromTime": return { ...draft, fromTime: "" };
    case "toTime": return { ...draft, toTime: "" };
    case "type": return { ...draft, type: "", typeMode: "exact" };
    case "component": return { ...draft, component: "", componentMode: "exact" };
    case "traceId": return { ...draft, traceId: "", traceMode: "exact" };
    case "eventId": return { ...draft, eventId: "", eventMode: "exact" };
    case "entityKind": return { ...draft, entityKind: "", entityKindMode: "exact" };
    case "entityId": return { ...draft, entityId: "", entityIdMode: "exact" };
  }
}

export function withExactValue(draft: TimelineDraft, field: TextFilterField, value: string): TimelineDraft {
  switch (field) {
    case "type": return { ...draft, type: value, typeMode: "exact" };
    case "component": return { ...draft, component: value, componentMode: "exact" };
    case "traceId": return { ...draft, traceId: value, traceMode: "exact" };
    case "eventId": return { ...draft, eventId: value, eventMode: "exact" };
    case "entityKind": return { ...draft, entityKind: value, entityKindMode: "exact" };
    case "entityId": return { ...draft, entityId: value, entityIdMode: "exact" };
  }
}

export function traceOnlyDraft(traceId: string): TimelineDraft {
  return { ...emptyTimelineDraft, traceId, traceMode: "exact" };
}

export function timelineDraftIsBlank(draft: TimelineDraft): boolean {
  return draft.fromTime.trim() === "" && draft.toTime.trim() === ""
    && draft.type.trim() === "" && draft.typeMode === "exact"
    && draft.component.trim() === "" && draft.componentMode === "exact"
    && draft.traceId.trim() === "" && draft.traceMode === "exact"
    && draft.eventId.trim() === "" && draft.eventMode === "exact"
    && draft.entityKind.trim() === "" && draft.entityKindMode === "exact"
    && draft.entityId.trim() === "" && draft.entityIdMode === "exact";
}

export interface TimelineReveal {
  readonly draft: TimelineDraft;
  readonly query: TimelineQuery;
  readonly cleared: readonly ClearedField[];
  readonly changed: boolean;
}

export interface TraceNarrowing {
  readonly draft: TimelineDraft;
  readonly changed: boolean;
  readonly cleared: readonly ClearedField[];
}

/** Drop only the constraints that exclude this stored observation, including prefix and contains. */
export function revealTimelineObservation(draft: TimelineDraft, observation: Observation): TimelineReveal {
  let next = draft;
  const cleared: ClearedField[] = [];
  const clear = (field: TimelineFilterField) => {
    next = clearTimelineField(next, field);
    const code = clearedCode(field);
    if (!cleared.includes(code)) cleared.push(code);
  };
  if (wholeTime(next.fromTime) === "invalid") clear("fromTime");
  if (wholeTime(next.toTime) === "invalid") clear("toTime");
  const from = wholeTime(next.fromTime);
  const to = wholeTime(next.toTime);
  if (typeof from === "number" && observation.time < from) clear("fromTime");
  if (typeof to === "number" && observation.time > to) clear("toTime");
  let parsed = parseTimelineQuery(next);
  if (!parsed.ok) {
    if (next.fromTime.trim()) clear("fromTime");
    if (next.toTime.trim()) clear("toTime");
    parsed = parseTimelineQuery(next);
  }
  if (parsed.ok) {
    const query = parsed.query;
    if (query.type !== undefined && !matchesText(observation.type, query.type)) clear("type");
    if (query.component !== undefined && !matchesComponent(observation, query.component)) clear("component");
    if (query.traceId !== undefined && !matchesText(observation.traceId, query.traceId)) clear("traceId");
    if (query.eventId !== undefined && !matchesText(observation.eventId, query.eventId)) clear("eventId");
    if ((query.entityKind !== undefined || query.entityId !== undefined) && !matchesEntity(observation, query.entityKind, query.entityId)) {
      if (next.entityKind.trim()) clear("entityKind");
      if (next.entityId.trim()) clear("entityId");
    }
  }
  const finalParse = parseTimelineQuery(next);
  return { draft: next, query: finalParse.ok ? finalParse.query : {}, cleared, changed: cleared.length > 0 };
}

/** Narrow the timeline to one trace and report every other constraint that was cleared. */
export function narrowToTrace(draft: TimelineDraft, traceId: string): TraceNarrowing {
  const next = traceOnlyDraft(traceId);
  const cleared: ClearedField[] = [];
  const fields: readonly TimelineFilterField[] = ["fromTime", "toTime", "type", "component", "traceId", "eventId", "entityKind", "entityId"];
  for (const key of fields) {
    const value = draft[key].trim();
    if (!value || (key === "traceId" && value === traceId)) continue;
    const code = clearedCode(key);
    if (!cleared.includes(code)) cleared.push(code);
  }
  const changed = textFieldsDiffer(draft, next) || modeFieldsDiffer(draft, next);
  return { draft: next, changed, cleared };
}

/** Entity kind and entity id are one constraint to the reader. */
function clearedCode(field: TimelineFilterField): ClearedField {
  return field === "entityKind" || field === "entityId" ? "entity" : field;
}

function matchesQuery(record: Observation, query: TimelineQuery): boolean {
  if (query.fromTime !== undefined && record.time < query.fromTime) return false;
  if (query.toTime !== undefined && record.time > query.toTime) return false;
  if (query.type !== undefined && !matchesText(record.type, query.type)) return false;
  if (query.component !== undefined && !matchesComponent(record, query.component)) return false;
  if (query.traceId !== undefined && !matchesText(record.traceId, query.traceId)) return false;
  if (query.eventId !== undefined && !matchesText(record.eventId, query.eventId)) return false;
  if ((query.entityKind !== undefined || query.entityId !== undefined) && !matchesEntity(record, query.entityKind, query.entityId)) return false;
  return true;
}

function matchesComponent(record: Observation, criterion: TextCriterion): boolean {
  return matchesText(record.source, criterion) || (record.target !== undefined && matchesText(record.target, criterion));
}

function matchesEntity(record: Observation, kind: TextCriterion | undefined, id: TextCriterion | undefined): boolean {
  return (record.entityRefs ?? []).some(entity =>
    (kind === undefined || matchesText(entity.kind, kind)) && (id === undefined || matchesText(entity.id, id)));
}

function matchesText(stored: string | undefined, criterion: TextCriterion): boolean {
  if (stored === undefined) return false;
  if (criterion.mode === "exact") return stored === criterion.value;
  if (criterion.mode === "prefix") return stored.startsWith(criterion.value);
  return stored.includes(criterion.value);
}

function explain(
  sentences: string[],
  field: TextFilterField,
  criterion: TextCriterion | undefined,
  observations: readonly Observation[],
  choices: readonly FilterChoice[],
  valuesOf: (observation: Observation) => readonly string[],
  m: Messages,
): void {
  if (criterion === undefined) return;
  const copy = m.timeline.explain;
  const { noun, inline } = m.timeline.fieldNoun[field];
  const value = criterion.value;
  const alone = observations.filter(observation => valuesOf(observation).some(item => matchesText(item, criterion))).length;
  if (alone > 0) {
    const excluded = criterion.mode === "exact" ? copy.excludedExact : criterion.mode === "prefix" ? copy.excludedPrefix : copy.excludedContains;
    sentences.push(excluded({ noun, value, count: alone }));
    return;
  }
  const containing = choices.filter(choice => choice.value.includes(value) || choice.label.includes(value)).slice(0, 8);
  if (criterion.mode === "exact" && containing.length > 0 && !containing.some(choice => choice.value === value)) {
    sentences.push(copy.notExact({ noun, inline, value, values: labels(containing) }));
    return;
  }
  if (containing.length === 0) {
    const folded = value.toLowerCase();
    const insensitive = folded === value ? [] : choices.filter(choice =>
      choice.value.toLowerCase().includes(folded) || choice.label.toLowerCase().includes(folded)).slice(0, 4);
    sentences.push(insensitive.length > 0
      ? copy.caseSensitive({ inline, value, values: labels(insensitive) })
      : copy.noneRecorded({ inline, value }));
    return;
  }
  const none = criterion.mode === "prefix" ? copy.nonePrefix : criterion.mode === "contains" ? copy.noneContains : copy.noneExact;
  sentences.push(none({ inline, value, values: labels(containing) }));
}

function labels(choices: readonly FilterChoice[]): readonly string[] {
  return choices.map(choice => choice.label);
}

function criterion(value: string, mode: TextMatchMode): TextCriterion | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? { value: trimmed, mode } : undefined;
}

function wholeTime(value: string): number | undefined | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) return "invalid";
  return Number(trimmed);
}

function textFieldsDiffer(draft: TimelineDraft, next: TimelineDraft): boolean {
  const keys: readonly TimelineFilterField[] = ["fromTime", "toTime", "type", "component", "traceId", "eventId", "entityKind", "entityId"];
  return keys.some(key => draft[key].trim() !== next[key]);
}

function modeFieldsDiffer(draft: TimelineDraft, next: TimelineDraft): boolean {
  return draft.typeMode !== next.typeMode
    || draft.componentMode !== next.componentMode
    || draft.traceMode !== next.traceMode
    || draft.eventMode !== next.eventMode
    || draft.entityKindMode !== next.entityKindMode
    || draft.entityIdMode !== next.entityIdMode;
}

function bound(value: string, field: "fromTime" | "toTime"): { ok: true; value: number | undefined } | { ok: false; error: QueryError } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    return { ok: false, error: { kind: "not-whole-time", field, value: trimmed } };
  }
  return { ok: true, value: Number(trimmed) };
}

function add(values: Set<string>, value: string | undefined): void {
  if (value !== undefined && value.length > 0) values.add(value);
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
