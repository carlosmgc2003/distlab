import type { Observation } from "@distlab/contracts";
import { continuesHistory, edgeFor, movementOf } from "./records.ts";
import type { Movement, MovementEdge } from "./records.ts";
import {
  emphasisFor,
  revealMessage,
  selectionMessage,
  traceFilterMessage,
} from "./timeline.ts";
import type { GraphEmphasis } from "./timeline.ts";
import {
  activeFilterChips,
  clearTimelineField,
  componentLabel,
  emptyFilterExplanation,
  emptyTimelineDraft,
  narrowToTrace,
  parseTimelineQuery,
  queryTimeline,
  revealTimelineObservation,
  timelineDraftIsBlank,
  timelineSuggestions,
  withExactValue,
} from "./timeline-query.ts";
import type {
  ActiveFilterChip,
  ComponentTitle,
  TextFilterField,
  TimelineDraft,
  TimelineQuery,
  TimelineSuggestions,
} from "./timeline-query.ts";
import {
  emptyQuickViewExplanation,
  quickViewChip,
  quickViewCounts,
  quickViewFeedback,
  quickViewLabel,
  quickViewObservations,
  quickViewSummary,
  recordedComponentChips,
  revealQuickView,
} from "./timeline-quick-views.ts";
import type { QuickViewChip, QuickViewId } from "./timeline-quick-views.ts";
import {
  storyDetail,
  storyLanes,
  storyLegend,
  storyMilestones,
  storyReduction,
  storySummary,
  storyTableRows,
} from "./story-timeline.ts";
import type { StoryLegendEntry, StoryMilestone, StoryTableRow } from "./story-timeline.ts";
import type { ComponentNames } from "./component-display.ts";

/**
 * Review navigation. One place decides where the reader is in Recorded history:
 * which record is the review position, which constraints are active, and which
 * record the reader asked to focus.
 *
 * This module is pure. It reads only the records the worker published and the
 * presentation link identity, never a DOM node, never virtual time, and never a
 * worker command. Scroll and focus are returned as requests for the DOM adapter
 * to apply, so navigation can be tested without a browser.
 *
 * It is not playback. The architecture-graph flight cursor owns playback and
 * shares no seam with this module; selecting a record here never moves it.
 */

/**
 * How the reader reads the Story: the milestone diagram or the milestone table.
 * Both present the same teaching milestones of the recorded history.
 */
export type ReviewViewMode = "diagram" | "table";

/** A record the reader asked to have focused, with a token that changes per request. */
export interface FocusRequest {
  readonly observationId: string;
  /** Changes on every request, so the adapter acts even when the record repeats. */
  readonly token: number;
}

/** What the DOM adapter should do about scroll position after a transition. */
export type ScrollKind = "top" | "ensure-visible" | "focus-row";

export interface ScrollRequest {
  readonly kind: ScrollKind;
  /** Changes whenever the desired scroll changes, so the adapter applies it once. */
  readonly epoch: number;
  readonly view: ReviewViewMode;
  /** The selected record's position among the visible records. -1 when nothing is selected. */
  readonly index: number;
  /** The record whose row to keep visible. */
  readonly observationId?: string;
}

/** Everything review navigation owns. The reader's position, never the run's. */
export interface ReviewNavigation {
  readonly draft: TimelineDraft;
  readonly query: TimelineQuery;
  readonly filterError: string | null;
  readonly filterField: TextFilterField;
  readonly quickView: QuickViewId | null;
  readonly view: ReviewViewMode;
  /** The review position: the stored record the reader selected. */
  readonly selectedId: string | null;
  readonly feedback: string;
  /** The newest recorded movement flashing by itself. Never takes the graph highlight from playback. */
  readonly liveCueId: string | null;
  readonly focus: FocusRequest | null;
  readonly scroll: ScrollRequest;
  /** Highest published sequence already read, so only new records raise a live cue. */
  readonly seenSequence: number;
  /** Records as last published, for continuity only. Never rendered. */
  readonly published: readonly Observation[] | null;
}

export interface ReviewContext {
  readonly observations: readonly Observation[];
  readonly edges: readonly MovementEdge[];
  readonly componentTitles: readonly ComponentTitle[];
}

/** A reader's move. Named by intent, not by the state it touches. */
export type ReviewIntent =
  | { readonly type: "reveal"; readonly observationId: string }
  | { readonly type: "select"; readonly observationId: string }
  | { readonly type: "toggle-quick-view"; readonly id: QuickViewId }
  | { readonly type: "select-quick-view"; readonly id: QuickViewId | null }
  | { readonly type: "clear-quick-view" }
  | { readonly type: "toggle-component"; readonly value: string }
  | { readonly type: "toggle-trace"; readonly traceId: string }
  | { readonly type: "narrow-to-trace"; readonly traceId: string }
  | { readonly type: "clear-all" }
  | { readonly type: "set-draft"; readonly draft: TimelineDraft }
  | { readonly type: "set-filter-field"; readonly field: TextFilterField }
  | { readonly type: "switch-view"; readonly view: ReviewViewMode }
  | { readonly type: "published"; readonly observations: readonly Observation[] }
  | { readonly type: "focus-applied" };

export function createReviewNavigation(): ReviewNavigation {
  return {
    draft: emptyTimelineDraft,
    query: {},
    filterError: null,
    filterField: "type",
    quickView: null,
    view: "diagram",
    selectedId: null,
    feedback: "",
    liveCueId: null,
    focus: null,
    scroll: { kind: "top", epoch: 0, view: "diagram", index: -1 },
    seenSequence: -1,
    published: null,
  };
}

/**
 * One review transition. Intents that move the review position share the reveal
 * path, so a record selected from the Story diagram, from the Story table, from
 * Observation detail, or from an evidence link arrives with the same constraints
 * cleared, the same copy, and the same focus request.
 */
export function transition(state: ReviewNavigation, intent: ReviewIntent, context: ReviewContext): ReviewNavigation {
  switch (intent.type) {
    case "reveal": return revealRecord(state, intent.observationId, context);
    case "select": return selectRecord(state, intent.observationId, context);
    case "toggle-quick-view": {
      const next = state.quickView === intent.id ? null : intent.id;
      return applyQuickView(state, next, context);
    }
    case "select-quick-view": {
      if (intent.id === null) return clearQuickView(state, context);
      if (intent.id === state.quickView) return state;
      const next = state.quickView === intent.id ? null : intent.id;
      return applyQuickView(state, next, context);
    }
    case "clear-quick-view": return clearQuickView(state, context);
    case "toggle-component": {
      const active = state.draft.component.trim() === intent.value && state.draft.componentMode === "exact";
      return applyDraft(state, active ? clearTimelineField(state.draft, "component") : withExactValue(state.draft, "component", intent.value));
    }
    case "toggle-trace": {
      const active = state.draft.traceId.trim() === intent.traceId && state.draft.traceMode === "exact";
      return applyDraft(state, active ? clearTimelineField(state.draft, "traceId") : withExactValue(state.draft, "traceId", intent.traceId));
    }
    case "narrow-to-trace": return narrowToTraceIntent(state, intent.traceId, context);
    case "clear-all": {
      // Cleared through the same path as any draft edit, so an invalid filter
      // left in the drawer is cleared with the rest of the constraints.
      const cleared = applyDraft(state, emptyTimelineDraft);
      return { ...cleared, quickView: null, feedback: `All filters and quick views were cleared. ${context.observations.length} recorded observations are available again.` };
    }
    case "set-draft": return applyDraft(state, intent.draft);
    case "set-filter-field": return { ...state, filterField: intent.field };
    case "switch-view": return state.view === intent.view ? state : { ...state, view: intent.view, scroll: scrollTo(state, "top") };
    case "published": return published(state, intent.observations);
    case "focus-applied": return state.focus === null ? state : { ...state, focus: null };
  }
}

/**
 * The projection the reader sees, computed once from the records and the
 * navigation state. Every consumer reads these values; none recomputes them.
 */
export interface ReviewView {
  /** Records the quick view keeps, in canonical order. */
  readonly scoped: readonly Observation[];
  /** Records every active constraint keeps. */
  readonly filtered: readonly Observation[];
  readonly selected: Observation | undefined;
  readonly selectedTrace: string | undefined;
  readonly selectedIndex: number;
  readonly suggestions: TimelineSuggestions;
  readonly quickCounts: ReturnType<typeof quickViewCounts>;
  readonly componentChips: ReturnType<typeof recordedComponentChips>;
  readonly componentLabels: ReadonlyMap<string, string>;
  readonly chips: readonly ActiveFilterChip[];
  readonly viewChip: QuickViewChip | null;
  readonly filtersActive: boolean;
  readonly quickCopy: string;
  readonly explanation: string;
  readonly milestones: readonly StoryMilestone[];
  /** Story table rows: the milestones, plus the selected record when it is visible and not one. */
  readonly tableRows: readonly StoryTableRow[];
  /** Milestones in the whole history, before any filter or quick view. */
  readonly totalMilestones: number;
  readonly lanes: readonly string[];
  readonly legend: readonly StoryLegendEntry[];
  readonly reduction: string;
  readonly storyCopy: string;
  readonly storyDetailCopy: string;
  readonly storyCount: string;
  /** The selection highlight, or the live cue. Never a playback cursor. */
  readonly emphasis: GraphEmphasis | undefined;
  readonly focus: FocusRequest | null;
  readonly scroll: ScrollRequest;
}

export function derive(state: ReviewNavigation, context: ReviewContext): ReviewView {
  const { observations, edges, componentTitles } = context;
  // The quick view narrows the snapshot first; the canonical fields then narrow that result.
  const scoped = quickViewObservations(observations, state.quickView);
  const filtered = queryTimeline(scoped, state.query);
  const selected = state.selectedId === null ? undefined : observations.find(item => item.id === state.selectedId);
  const selectedTrace = selected?.traceId;
  const selectedIndex = state.selectedId === null ? -1 : filtered.findIndex(item => item.id === state.selectedId);
  const componentLabels = new Map(componentTitles.map(item => [item.id, componentLabel(item.id, componentTitles)]));
  // The graph's node titles are the session's display names (#103); a movement sentence uses them too.
  const names: ComponentNames = new Map(componentTitles.flatMap(item => item.title !== item.id ? [[item.id, item.title] as const] : []));
  const milestones = storyMilestones(filtered);
  const totalMilestones = filtered.length === observations.length ? milestones.length : storyMilestones(observations).length;
  const lanes = storyLanes(milestones);
  const legend = storyLegend(milestones);
  const reduction = storyReduction(milestones, filtered.length);
  const chips = activeFilterChips(state.query, componentTitles);
  const viewChip = state.quickView === null ? null : quickViewChip(state.quickView);
  const filtersActive = !timelineDraftIsBlank(state.draft) || state.filterError !== null || state.quickView !== null;

  let explanation = "";
  if (filtered.length === 0 && observations.length > 0) {
    const reset = state.quickView === null
      ? undefined
      : `Remove the ${quickViewLabel(state.quickView).toLowerCase()} quick view chip or clear all filters to see recorded observations again.`;
    const parts: string[] = [];
    if (state.quickView !== null) parts.push(emptyQuickViewExplanation(state.quickView, observations.length));
    parts.push(emptyFilterExplanation(state.query, scoped, componentTitles, reset));
    explanation = parts.join(" ");
  }

  // A selected record takes the graph highlight back; a live cue never does.
  let liveCue: Movement | null = null;
  if (!selected && state.liveCueId !== null) {
    const cue = observations.find(item => item.id === state.liveCueId);
    if (cue) liveCue = movementOf(cue, names);
  }
  const emphasis = deriveEmphasis(selected, liveCue, edges, names);

  const storyCount = `${reduction} ${observations.length === filtered.length ? "" : `Filters show ${filtered.length} of ${observations.length} observations. `}`
    + (selected !== undefined && !milestones.some(item => item.observation.id === selected.id) && filtered.some(item => item.id === selected.id)
      ? "The Story table also lists the selected record, which is not a teaching milestone." : "");

  return {
    scoped,
    filtered,
    selected,
    selectedTrace,
    selectedIndex,
    suggestions: timelineSuggestions(observations, componentTitles),
    quickCounts: quickViewCounts(observations),
    componentChips: recordedComponentChips(observations, componentTitles),
    componentLabels,
    chips,
    viewChip,
    filtersActive,
    quickCopy: quickViewSummary(state.quickView, filtered.length, observations.length),
    explanation,
    milestones,
    tableRows: storyTableRows(milestones, filtered, state.selectedId),
    totalMilestones,
    lanes,
    legend,
    reduction,
    storyCopy: storySummary(milestones, filtered.length, componentLabels),
    storyDetailCopy: storyDetail(milestones),
    storyCount,
    emphasis,
    focus: state.focus,
    scroll: { ...state.scroll, view: state.view, index: selectedIndex, ...(selected ? { observationId: selected.id } : {}) },
  };
}

// --- transitions that move the review position ---

/**
 * The one reveal path. A record named from anywhere in Recorded history arrives
 * with the Story table showing, with only the constraints that hide it cleared,
 * with the cleared constraints named, and with focus requested on its row. A
 * record that is not a teaching milestone still gets its own table row, so an
 * evidence link always lands on something the reader can see.
 */
function revealRecord(state: ReviewNavigation, observationId: string, context: ReviewContext): ReviewNavigation {
  const observation = context.observations.find(item => item.id === observationId);
  if (!observation) return { ...state, feedback: "That observation is not in this history." };
  const revealed = revealTimelineObservation(state.draft, observation);
  const unhidden = revealQuickView(state.quickView, observation);
  const draft = revealed.changed ? revealed.draft : state.draft;
  const query = revealed.changed ? revealed.query : state.query;
  const filterError = revealed.changed ? null : state.filterError;
  const quickView = unhidden.id === state.quickView ? state.quickView : unhidden.id;
  const cleared = [...revealed.cleared, ...(unhidden.cleared ? [unhidden.cleared] : [])];
  return {
    ...state,
    draft,
    query,
    filterError,
    quickView,
    view: "table",
    selectedId: observation.id,
    feedback: revealMessage(cleared, observation),
    focus: { observationId: observation.id, token: (state.focus?.token ?? 0) + 1 },
    scroll: scrollTo(state, "focus-row"),
  };
}

function selectRecord(state: ReviewNavigation, observationId: string, context: ReviewContext): ReviewNavigation {
  const observation = context.observations.find(item => item.id === observationId);
  return {
    ...state,
    selectedId: observationId,
    feedback: observation ? selectionMessage(observation) : state.feedback,
    scroll: scrollTo(state, "ensure-visible"),
  };
}

function applyQuickView(state: ReviewNavigation, next: QuickViewId | null, context: ReviewContext): ReviewNavigation {
  return {
    ...state,
    quickView: next,
    feedback: quickViewFeedback(next, quickViewObservations(context.observations, next).length, context.observations.length),
    scroll: scrollTo(state, "top"),
  };
}

function clearQuickView(state: ReviewNavigation, context: ReviewContext): ReviewNavigation {
  const total = context.observations.length;
  return { ...state, quickView: null, feedback: quickViewFeedback(null, total, total), scroll: scrollTo(state, "top") };
}

function narrowToTraceIntent(state: ReviewNavigation, traceId: string, context: ReviewContext): ReviewNavigation {
  const change = narrowToTrace(state.draft, traceId);
  const member = context.observations.find(item => item.traceId === traceId);
  const unhidden = member === undefined ? { id: state.quickView, cleared: "" } : revealQuickView(state.quickView, member);
  // Narrowing rewrites the draft, so the result is re-read from it. Keeping the
  // previous query here would leave the draft and the result describing
  // different constraints, and reveal would stop seeing what is filtering.
  const parsed = parseTimelineQuery(change.draft);
  const base: ReviewNavigation = parsed.ok
    ? { ...state, draft: change.draft, query: parsed.query, filterError: null }
    : { ...state, draft: change.draft, filterError: parsed.message };
  return {
    ...base,
    quickView: unhidden.id === state.quickView ? state.quickView : unhidden.id,
    feedback: traceFilterMessage(traceId, {
      changed: change.changed || unhidden.cleared !== "",
      cleared: [...change.cleared, ...(unhidden.cleared ? [unhidden.cleared] : [])],
    }),
    // A focus request already in flight outranks the scroll reset a filter change asks for.
    focus: state.selectedId === null ? state.focus : { observationId: state.selectedId, token: (state.focus?.token ?? 0) + 1 },
    scroll: scrollTo(state, state.selectedId === null ? "top" : "focus-row"),
  };
}

/** Parse the draft. A draft that does not parse keeps the previous result and names the error. */
function applyDraft(state: ReviewNavigation, draft: TimelineDraft): ReviewNavigation {
  const parsed = parseTimelineQuery(draft);
  return parsed.ok
    ? { ...withDraft(state, draft, parsed.query), filterError: null, scroll: scrollTo(state, "top") }
    : { ...state, draft, filterError: parsed.message, scroll: scrollTo(state, "top") };
}

function withDraft(state: ReviewNavigation, draft: TimelineDraft, query: TimelineQuery): ReviewNavigation {
  return { ...state, draft, query };
}

/**
 * Records as published. History either grows or is replaced, and the two are
 * different transitions: a replacement drops the review position and every
 * active constraint, while growth raises a cue for the newest recorded movement.
 */
function published(state: ReviewNavigation, next: readonly Observation[]): ReviewNavigation {
  const previous = state.published;
  if (previous === null) return { ...state, published: next, seenSequence: next.at(-1)?.sequence ?? -1 };
  if (previous === next) return state;
  if (!continuesHistory(previous, next)) {
    return {
      ...state,
      published: next,
      seenSequence: next.at(-1)?.sequence ?? -1,
      selectedId: null,
      feedback: "",
      liveCueId: null,
      draft: emptyTimelineDraft,
      query: {},
      filterError: null,
      quickView: null,
      scroll: scrollTo(state, "top"),
    };
  }
  let newest: string | null = null;
  for (const observation of next) {
    if (observation.sequence <= state.seenSequence) continue;
    if (movementOf(observation)) newest = observation.id;
  }
  return { ...state, published: next, seenSequence: next.at(-1)?.sequence ?? state.seenSequence, liveCueId: newest ?? state.liveCueId };
}

// --- helpers ---

function scrollTo(state: ReviewNavigation, kind: ScrollKind): ScrollRequest {
  return { kind, epoch: state.scroll.epoch + 1, view: state.view, index: -1 };
}

function deriveEmphasis(selected: Observation | undefined, liveCue: Movement | null, edges: readonly MovementEdge[], names: ComponentNames): GraphEmphasis | undefined {
  if (selected) return emphasisFor(selected, edges, names);
  if (!liveCue) return undefined;
  const edge = edgeFor(liveCue, edges);
  return {
    nodeIds: liveCue.to !== undefined ? [liveCue.from, liveCue.to] : [liveCue.from],
    ...(edge !== undefined ? { edgeId: edge.id } : {}),
    kind: liveCue.kind,
    text: liveCue.text,
    pulseId: liveCue.observationId,
    // A live cue flashes by itself; it never takes the graph highlight back from playback.
    origin: "live" as const,
  };
}
