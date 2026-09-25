import type { EntityRef, Observation, ObservationFilter, SimulationTime } from "@distlab/contracts";
import { orderObservations } from "./timeline.ts";

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

export type QueryParse =
  | { readonly ok: true; readonly query: TimelineQuery }
  | { readonly ok: false; readonly message: string };

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

export const TIMELINE_FILTER_HELP = [
  "Filters combine with AND.",
  "Virtual time bounds are inclusive whole simulation times.",
  "Exact matches the full stored value, Prefix matches its start, and Contains matches a substring.",
  "Matching is case-sensitive and uses only this run's visible history.",
  "The suggestion list shows recorded values whose stored value or label contains the typed text.",
  "Choosing a suggestion applies Exact.",
  "A component matches when the source or the target matches.",
  "Entity kind and entity id must match the same stored entity reference.",
].join(" ");

const MODE_WORD: Readonly<Record<TextMatchMode, string>> = {
  exact: "exactly",
  prefix: "starting with",
  contains: "containing",
};

/** Read-only projection. Exact mode matches ExecutionHistoryReader; prefix and contains stay in the UI. */
export function queryTimeline(observations: readonly Observation[], query: TimelineQuery): readonly Observation[] {
  return orderObservations(observations).filter(record => matchesQuery(record, query));
}

export function parseTimelineQuery(draft: TimelineDraft): QueryParse {
  const from = bound(draft.fromTime, "Virtual time from");
  if (!from.ok) return from;
  const to = bound(draft.toTime, "Virtual time to");
  if (!to.ok) return to;
  if (from.value !== undefined && to.value !== undefined && from.value > to.value) {
    return { ok: false, message: `Virtual time from ${from.value} is after virtual time to ${to.value}. Use a from time that is less than or equal to the to time.` };
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
export function timelineSuggestions(observations: readonly Observation[], titles: readonly ComponentTitle[] = []): TimelineSuggestions {
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
    components: sorted(components).map(value => ({ value, label: componentLabel(value, titles) })),
    traces: sorted(traces).map(plain),
    events: sorted(events).map(plain),
    entityKinds: sorted(kinds).map(plain),
    entityIds: sorted(entityIds).map(plain),
  };
}

export function componentLabel(id: string, titles: readonly ComponentTitle[]): string {
  const provided = titles.find(item => item.id === id)?.title;
  const title = provided ?? (id === "simulation" ? "Simulation" : id);
  return title === id ? id : `${title} (${id})`;
}

/** Case-sensitive substring over the stored value and the displayed label. */
export function visibleChoices(choices: readonly FilterChoice[], query: string, limit = TIMELINE_SUGGESTION_LIMIT): {
  readonly shown: readonly FilterChoice[];
  readonly hidden: number;
} {
  const needle = query.trim();
  const matches = needle.length === 0 ? choices.slice() : choices.filter(choice => choice.value.includes(needle) || choice.label.includes(needle));
  return { shown: matches.slice(0, limit), hidden: Math.max(0, matches.length - limit) };
}

export function activeFilterChips(query: TimelineQuery, titles: readonly ComponentTitle[] = []): readonly ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (query.fromTime !== undefined) chips.push({ field: "fromTime", label: `Virtual time from ${query.fromTime} inclusive`, removeLabel: "Remove virtual time from filter" });
  if (query.toTime !== undefined) chips.push({ field: "toTime", label: `Virtual time to ${query.toTime} inclusive`, removeLabel: "Remove virtual time to filter" });
  const text: readonly { field: TextFilterField; noun: string; criterion: TextCriterion | undefined; display: (value: string) => string }[] = [
    { field: "type", noun: "Type", criterion: query.type, display: value => value },
    { field: "component", noun: "Component", criterion: query.component, display: value => componentLabel(value, titles) },
    { field: "traceId", noun: "Trace", criterion: query.traceId, display: value => value },
    { field: "eventId", noun: "Event", criterion: query.eventId, display: value => value },
    { field: "entityKind", noun: "Entity kind", criterion: query.entityKind, display: value => value },
    { field: "entityId", noun: "Entity id", criterion: query.entityId, display: value => value },
  ];
  for (const item of text) {
    if (item.criterion === undefined) continue;
    const shown = item.criterion.mode === "exact" ? item.display(item.criterion.value) : item.criterion.value;
    chips.push({
      field: item.field,
      label: `${item.noun} ${MODE_WORD[item.criterion.mode]} ${shown}`,
      removeLabel: `Remove ${item.noun.toLowerCase()} filter`,
    });
  }
  return chips;
}

export function emptyFilterExplanation(query: TimelineQuery, observations: readonly Observation[], titles: readonly ComponentTitle[] = []): string {
  const suggestions = timelineSuggestions(observations, titles);
  const sentences = ["No observations match every active filter. Filters combine with AND."];
  explain(sentences, "Type", query.type, observations, suggestions.types, observation => [observation.type]);
  explain(sentences, "Component", query.component, observations, suggestions.components, observation => [observation.source, ...(observation.target !== undefined ? [observation.target] : [])]);
  explain(sentences, "Trace", query.traceId, observations, suggestions.traces, observation => observation.traceId !== undefined ? [observation.traceId] : []);
  explain(sentences, "Event", query.eventId, observations, suggestions.events, observation => observation.eventId !== undefined ? [observation.eventId] : []);
  explain(sentences, "Entity kind", query.entityKind, observations, suggestions.entityKinds, observation => (observation.entityRefs ?? []).map(entity => entity.kind));
  explain(sentences, "Entity id", query.entityId, observations, suggestions.entityIds, observation => (observation.entityRefs ?? []).map(entity => entity.id));
  if (query.fromTime !== undefined || query.toTime !== undefined) {
    const from = query.fromTime !== undefined ? `from ${query.fromTime}` : "from the start";
    const to = query.toTime !== undefined ? `to ${query.toTime}` : "onward";
    sentences.push(`Virtual time is inclusive ${from} ${to}.`);
  }
  sentences.push("Remove a filter chip or clear all filters to see observations again.");
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
  noun: string,
  criterion: TextCriterion | undefined,
  observations: readonly Observation[],
  choices: readonly FilterChoice[],
  valuesOf: (observation: Observation) => readonly string[],
): void {
  if (criterion === undefined) return;
  const alone = observations.filter(observation => valuesOf(observation).some(value => matchesText(value, criterion))).length;
  if (alone > 0) {
    sentences.push(`${noun} ${MODE_WORD[criterion.mode]} ${quote(criterion.value)} matches ${alone} observations. Another active filter excludes them.`);
    return;
  }
  const containing = choices.filter(choice => choice.value.includes(criterion.value) || choice.label.includes(criterion.value)).slice(0, 8);
  if (criterion.mode === "exact" && containing.length > 0 && !containing.some(choice => choice.value === criterion.value)) {
    sentences.push(`${noun} ${quote(criterion.value)} is not an exact recorded value. Recorded values containing ${quote(criterion.value)}: ${labels(containing)}. Choose one for an exact match, or set ${noun} match to Prefix or Contains.`);
    return;
  }
  if (containing.length === 0) {
    const folded = criterion.value.toLowerCase();
    const insensitive = folded === criterion.value ? [] : choices.filter(choice =>
      choice.value.toLowerCase().includes(folded) || choice.label.toLowerCase().includes(folded)).slice(0, 4);
    sentences.push(insensitive.length > 0
      ? `No recorded ${noun.toLowerCase()} contains ${quote(criterion.value)}. Matching is case-sensitive. Recorded values include ${labels(insensitive)}.`
      : `No recorded ${noun.toLowerCase()} matches ${quote(criterion.value)}.`);
    return;
  }
  const how = criterion.mode === "prefix" ? "starts with" : criterion.mode === "contains" ? "contains" : "equals";
  sentences.push(`No recorded ${noun.toLowerCase()} ${how} ${quote(criterion.value)}. Recorded values containing ${quote(criterion.value)}: ${labels(containing)}.`);
}

function labels(choices: readonly FilterChoice[]): string {
  return choices.map(choice => choice.label).join(", ");
}

function quote(value: string): string {
  return `"${value}"`;
}

function criterion(value: string, mode: TextMatchMode): TextCriterion | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? { value: trimmed, mode } : undefined;
}

function bound(value: string, label: string): { ok: true; value: number | undefined } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    return { ok: false, message: `${label} "${trimmed}" is not a whole simulation time. Use a non-negative integer such as 0 or 12.` };
  }
  return { ok: true, value: Number(trimmed) };
}

function add(values: Set<string>, value: string | undefined): void {
  if (value !== undefined && value.length > 0) values.add(value);
}

function sorted(values: ReadonlySet<string>): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
