import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Observation } from "@distlab/contracts";
import {
  TIMELINE_FILTER_HELP,
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
  visibleChoices,
  withExactValue,
} from "./timeline-query.ts";
import type { ComponentTitle, FilterChoice, TextFilterField, TextMatchMode, TimelineDraft, TimelineQuery } from "./timeline-query.ts";
import {
  QUICK_VIEWS,
  QUICK_VIEW_HELP,
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
import { continuesHistory, correlation, edgeFor, movementOf, payloadVisibility, traceView } from "./records.ts";
import type { MovementEdge, SpanNode } from "./records.ts";
import {
  TIMELINE_ROW_HEIGHT,
  TIMELINE_VIEWPORT,
  boundaryCopy,
  changeEvidence,
  emphasisFor,
  learningTimeline,
  movementMessage,
  payloadCopy,
  recordLabel,
  revealMessage,
  selectionMessage,
  selectionStep,
  traceFilterMessage,
  visibleRowRange,
} from "./timeline.ts";
import type { GraphEmphasis } from "./timeline.ts";
import { storyDetail, storyLanes, storyLegend, storyMilestones, storyReduction, storySummary } from "./story-timeline.ts";
import type { StoryLegendEntry, StoryMilestone } from "./story-timeline.ts";
import { HelpHint } from "./ui-hint.tsx";

const SPAN_PREVIEW = 12;

export function TimelineView({ observations, edges, componentTitles = [], onEmphasis, focusedObservationId, focusToken = 0 }: {
  readonly observations: readonly Observation[];
  readonly edges: readonly MovementEdge[];
  readonly componentTitles?: readonly ComponentTitle[];
  readonly onEmphasis: (emphasis: GraphEmphasis | undefined) => void;
  readonly focusedObservationId?: string;
  readonly focusToken?: number;
}) {
  const [draft, setDraft] = useState<TimelineDraft>(emptyTimelineDraft);
  const [filterField, setFilterField] = useState<TextFilterField>("type");
  const [query, setQuery] = useState<TimelineQuery>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const [quickView, setQuickView] = useState<QuickViewId | null>(null);
  const [view, setView] = useState<"story" | "learning" | "raw">("story");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [liveCueId, setLiveCueId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowViewport, setRowViewport] = useState(TIMELINE_VIEWPORT);
  const [focusNonce, setFocusNonce] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<readonly Observation[] | null>(null);
  const seenRef = useRef(-1);
  const pendingFocusId = useRef<string | null>(null);
  const suggestions = useMemo(() => timelineSuggestions(observations, componentTitles), [observations, componentTitles]);
  // The quick view narrows the snapshot first; the canonical fields then narrow that result.
  const scoped = useMemo(() => quickViewObservations(observations, quickView), [observations, quickView]);
  const filtered = useMemo(() => queryTimeline(scoped, query), [scoped, query]);
  const quickCounts = useMemo(() => quickViewCounts(observations), [observations]);
  const componentChips = useMemo(() => recordedComponentChips(observations, componentTitles), [observations, componentTitles]);
  const learningItems = useMemo(() => learningTimeline(filtered), [filtered]);
  const hiddenLearningRecords = filtered.length - learningItems.length;
  const milestones = useMemo(() => storyMilestones(filtered), [filtered]);
  const lanes = useMemo(() => storyLanes(milestones), [milestones]);
  const legend = useMemo(() => storyLegend(milestones), [milestones]);
  const reduction = storyReduction(milestones, filtered.length);
  const componentLabels = useMemo(
    () => new Map(componentTitles.map(item => [item.id, componentLabel(item.id, componentTitles)])),
    [componentTitles],
  );
  const storyCopy = useMemo(() => storySummary(milestones, filtered.length, componentLabels), [milestones, filtered.length, componentLabels]);
  const storyDetailCopy = useMemo(() => storyDetail(milestones), [milestones]);
  const chips = useMemo(() => activeFilterChips(query, componentTitles), [query, componentTitles]);
  const viewChip: QuickViewChip | null = quickView === null ? null : quickViewChip(quickView);
  const quickCopy = quickViewSummary(quickView, filtered.length, observations.length);
  const explanation = useMemo(() => {
    if (filtered.length > 0 || observations.length === 0) return "";
    const reset = quickView === null
      ? undefined
      : `Remove the ${quickViewLabel(quickView).toLowerCase()} quick view chip or clear all filters to see recorded observations again.`;
    const parts: string[] = [];
    if (quickView !== null) parts.push(emptyQuickViewExplanation(quickView, observations.length));
    parts.push(emptyFilterExplanation(query, scoped, componentTitles, reset));
    return parts.join(" ");
  }, [filtered.length, observations.length, quickView, query, scoped, componentTitles]);
  const draftRef = useRef(draft);
  const quickViewRef = useRef(quickView);
  const observationsRef = useRef(observations);
  draftRef.current = draft;
  quickViewRef.current = quickView;
  observationsRef.current = observations;
  const selected = observations.find(item => item.id === selectedId);
  const selectedTrace = selected?.traceId;
  const selectedIndex = filtered.findIndex(item => item.id === selectedId);
  const liveCue = useMemo(() => {
    if (selected || liveCueId === null) return null;
    const observation = observations.find(item => item.id === liveCueId);
    return observation ? movementOf(observation) : null;
  }, [selected, liveCueId, observations]);
  const emphasis = useMemo(() => {
    if (selected) return emphasisFor(selected, edges);
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
  }, [selected, edges, liveCue]);

  const requestFocus = (id: string) => {
    pendingFocusId.current = id;
    setFocusNonce(value => value + 1);
  };
  useEffect(() => { onEmphasis(emphasis); }, [emphasis, onEmphasis]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    // The row window follows the panel height so a shorter workspace still virtualizes the visible rows.
    const measure = () => {
      const height = node.clientHeight;
      if (height > 0) setRowViewport(current => current === height ? current : height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (focusedObservationId === undefined) return;
    const observation = observationsRef.current.find(item => item.id === focusedObservationId);
    if (!observation) {
      setFeedback("That observation is not in this history.");
      return;
    }
    setView("raw");
    const revealed = revealTimelineObservation(draftRef.current, observation);
    if (revealed.changed) {
      setDraft(revealed.draft);
      setQuery(revealed.query);
      setFilterError(null);
    }
    const unhidden = revealQuickView(quickViewRef.current, observation);
    if (unhidden.id !== quickViewRef.current) setQuickView(unhidden.id);
    setSelectedId(observation.id);
    setFeedback(revealMessage([...revealed.cleared, ...(unhidden.cleared ? [unhidden.cleared] : [])], observation));
    requestFocus(observation.id);
  }, [focusedObservationId, focusToken]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = observations;
    if (previous === null) {
      seenRef.current = observations.at(-1)?.sequence ?? -1;
      return;
    }
    if (!continuesHistory(previous, observations)) {
      setSelectedId(null);
      setFeedback("");
      setLiveCueId(null);
      setScrollTop(0);
      setDraft(emptyTimelineDraft);
      setQuery({});
      setFilterError(null);
      setQuickView(null);
      setFeedback("");
      seenRef.current = observations.at(-1)?.sequence ?? -1;
      return;
    }
    let newest: string | null = null;
    for (const observation of observations) {
      if (observation.sequence <= seenRef.current) continue;
      if (movementOf(observation)) newest = observation.id;
    }
    seenRef.current = observations.at(-1)?.sequence ?? seenRef.current;
    if (newest) setLiveCueId(newest);
  }, [observations, edges]);

  useEffect(() => {
    if (!liveCueId || selectedId) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => {
      setLiveCueId(current => current === liveCueId ? null : current);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [liveCueId, selectedId]);

  const filterKey = JSON.stringify([query, quickView]);
  useEffect(() => {
    if (pendingFocusId.current) return;
    const node = scrollerRef.current;
    if (node) node.scrollTop = 0;
    setScrollTop(0);
  }, [filterKey]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || selectedId === null) return;
    const index = filtered.findIndex(item => item.id === selectedId);
    if (index < 0) return;
    if (view === "raw") {
      const top = index * TIMELINE_ROW_HEIGHT;
      if (top < node.scrollTop || top + TIMELINE_ROW_HEIGHT > node.scrollTop + node.clientHeight) node.scrollTop = top;
      return;
    }
    // Story and Learning rows have variable height; scroll the actual member.
    const scope = view === "story" ? node.querySelector(".story-table") ?? node : node;
    const row = scope.querySelector<HTMLElement>(`[data-observation-id="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId, filtered, view]);

  useEffect(() => {
    const id = pendingFocusId.current;
    const node = scrollerRef.current;
    if (!id || !node) return;
    const index = filtered.findIndex(item => item.id === id);
    if (index < 0) return;
    const row = node.querySelector<HTMLButtonElement>(`[data-observation-id="${CSS.escape(id)}"]`);
    if (!row && view === "raw") {
      // Virtualized Raw rows outside the current window are not in the DOM.
      // Move the window to the selected index so the next render includes it,
      // then retry focusing. This covers evidence navigation that activates
      // the Recorded history tab while it was hidden.
      const top = index * TIMELINE_ROW_HEIGHT;
      node.scrollTop = top;
      setScrollTop(top);
      return;
    }
    if (!row) return;
    // Learning groups have variable height; scroll the actual member rather than
    // assuming the fixed raw-row geometry used by the virtualized Raw view.
    if (view === "learning") row.scrollIntoView({ block: "nearest", inline: "nearest" });
    else {
      const top = index * TIMELINE_ROW_HEIGHT;
      if (top < node.scrollTop || top + TIMELINE_ROW_HEIGHT > node.scrollTop + node.clientHeight) node.scrollTop = top;
    }
    pendingFocusId.current = null;
    row.focus({ preventScroll: true });
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
    document.getElementById("inspection-panel")?.scrollTo(0, 0);
  }, [filtered, focusNonce, scrollTop, view]);

  useEffect(() => {
    // Switching views replaces the scroller content; a stale offset would open on empty space.
    const node = scrollerRef.current;
    if (node) node.scrollTop = 0;
    setScrollTop(0);
  }, [view]);

  const applyDraft = (next: TimelineDraft) => {
    setDraft(next);
    const parsed = parseTimelineQuery(next);
    if (parsed.ok) { setQuery(parsed.query); setFilterError(null); }
    else setFilterError(parsed.message);
  };
  const choose = (id: string) => {
    setSelectedId(id);
    const observation = observations.find(item => item.id === id);
    if (observation) setFeedback(selectionMessage(observation));
  };
  const reveal = (id: string) => {
    const observation = observations.find(item => item.id === id);
    if (!observation) {
      setFeedback("That observation is not in this history.");
      return;
    }
    setView("raw");
    const revealed = revealTimelineObservation(draft, observation);
    if (revealed.changed) {
      setDraft(revealed.draft);
      setQuery(revealed.query);
      setFilterError(null);
    }
    const unhidden = revealQuickView(quickView, observation);
    if (unhidden.id !== quickView) setQuickView(unhidden.id);
    setSelectedId(observation.id);
    setFeedback(revealMessage([...revealed.cleared, ...(unhidden.cleared ? [unhidden.cleared] : [])], observation));
    requestFocus(observation.id);
  };
  const toggleQuickView = (id: QuickViewId) => {
    const next = quickView === id ? null : id;
    setQuickView(next);
    setFeedback(quickViewFeedback(next, quickViewObservations(observations, next).length, observations.length));
  };
  const toggleComponentChip = (value: string) => {
    const active = draft.component.trim() === value && draft.componentMode === "exact";
    applyDraft(active ? clearTimelineField(draft, "component") : withExactValue(draft, "component", value));
    setFeedback(active
      ? `Component filter for ${componentLabel(value, componentTitles)} was removed.`
      : `Component filter is now ${componentLabel(value, componentTitles)}. It narrows the display and changes nothing in the run.`);
  };
  const toggleTraceChip = (traceId: string) => {
    const active = draft.traceId.trim() === traceId && draft.traceMode === "exact";
    applyDraft(active ? clearTimelineField(draft, "traceId") : withExactValue(draft, "traceId", traceId));
    setFeedback(active
      ? `Trace filter for ${traceId} was removed.`
      : `Trace filter is now ${traceId}. It narrows the display and changes nothing in the run.`);
  };
  const clearAllFilters = () => {
    applyDraft(emptyTimelineDraft);
    setQuickView(null);
    setFeedback(`All filters and quick views were cleared. ${observations.length} recorded observations are available again.`);
  };
  const showTrace = (traceId: string) => {
    const change = narrowToTrace(draft, traceId);
    applyDraft(change.draft);
    const member = observations.find(item => item.traceId === traceId);
    const unhidden = member === undefined ? { id: quickView, cleared: "" } : revealQuickView(quickView, member);
    if (unhidden.id !== quickView) setQuickView(unhidden.id);
    setFeedback(traceFilterMessage(traceId, {
      changed: change.changed || unhidden.cleared !== "",
      cleared: [...change.cleared, ...(unhidden.cleared ? [unhidden.cleared] : [])],
    }));
    if (selectedId) requestFocus(selectedId);
  };
  const selectIndex = (index: number) => {
    const row = filtered[index];
    if (!row) return;
    setView("raw");
    setSelectedId(row.id);
    setFeedback(movementMessage(row, index, filtered.length));
    requestFocus(row.id);
  };
  const move = (delta: -1 | 1) => {
    const next = selectionStep(selectedIndex, filtered.length, delta);
    if (next === null) {
      setFeedback(boundaryCopy(selectedIndex, filtered.length));
      return;
    }
    selectIndex(next);
  };
  const useText = (field: TextFilterField, value: string) => applyDraft(withExactValue(draft, field, value));
  const useEntity = (kind: string, id: string) => applyDraft(withExactValue(withExactValue(draft, "entityKind", kind), "entityId", id));
  const range = visibleRowRange(filtered.length, scrollTop, rowViewport, TIMELINE_ROW_HEIGHT);
  const windowRows = filtered.slice(range.start, range.end);
  // The selected Raw row stays in the DOM even when virtualized out, so evidence
  // navigation that activates the tab always has a focus target and a pressed state.
  // It is merged in index order so DOM order still follows observation sequence.
  const rawRows = (() => {
    if (selectedId === null || view !== "raw") return windowRows.map((observation, offset) => ({ observation, index: range.start + offset }));
    const selectedIdx = filtered.findIndex(item => item.id === selectedId);
    const rows = windowRows.map((observation, offset) => ({ observation, index: range.start + offset }));
    if (selectedIdx < 0 || (selectedIdx >= range.start && selectedIdx < range.end)) return rows;
    const observation = filtered[selectedIdx];
    if (observation === undefined) return rows;
    return [...rows, { observation, index: selectedIdx }].sort((a, b) => a.index - b.index);
  })();
  const filtersActive = !timelineDraftIsBlank(draft) || filterError !== null || quickView !== null;
  const otherRecords = filtered.length - milestones.length;
  const storyCount = `${reduction} ${observations.length === filtered.length ? "" : `Filters show ${filtered.length} of ${observations.length} observations; `}`
    + `${otherRecords === 0
      ? filtered.length === 0 ? "No visible records to reduce. " : "Every visible record is a milestone. "
      : `${otherRecords} visible records are not teaching milestones; Learning and Raw keep all of them. `}`;
  return <div className="history-layout">
    <section id="timeline-panel" className="timeline-panel" tabIndex={-1} aria-labelledby="timeline-heading">
    <div className="history-heading"><h2 id="timeline-heading">Recorded history</h2>
      <div className="timeline-view-switch" role="group" aria-label="Timeline view">
        <button type="button" aria-pressed={view === "story"} onClick={() => setView("story")}>Story</button>
        <button type="button" aria-pressed={view === "learning"} onClick={() => setView("learning")}>Learning</button>
        <button type="button" aria-pressed={view === "raw"} onClick={() => setView("raw")}>Raw</button>
      </div>
    </div>
    {/* The review position only. Run status and virtual time have one home, the committed-state summary. */}
    <p className={selected ? "timeline-cursor" : "sr-only"} role="status" aria-live="polite">{selected
      ? `Reviewing observation ${selected.sequence} at virtual t=${selected.time}.`
      : "No observation selected."}</p>
    <p id="timeline-quick-count" className={filtersActive ? "timeline-quick-count" : "sr-only"}>{quickCopy}</p>
    <div className="story-filter-bar">
      <label htmlFor="story-quick-view">Show</label>
      <select id="story-quick-view" value={quickView ?? "all"} onChange={event => {
        const next = QUICK_VIEWS.find(item => item.id === event.target.value);
        if (next) { if (next.id !== quickView) toggleQuickView(next.id); }
        else setQuickView(null);
      }}>
        <option value="all">All categories</option>
        {QUICK_VIEWS.map(item => <option key={item.id} value={item.id}>{item.label} ({quickCounts[item.id]})</option>)}
      </select>
      <label htmlFor="story-component">Focus component</label>
      <select id="story-component" value={componentChips.some(chip => chip.value === draft.component) && draft.componentMode === "exact" ? draft.component : ""}
        onChange={event => applyDraft(event.target.value ? withExactValue(draft, "component", event.target.value) : clearTimelineField(draft, "component"))}>
        <option value="">All components</option>
        {componentChips.map(chip => <option key={chip.value} value={chip.value}>{chip.label}</option>)}
      </select>
    </div>
    <details className="history-filter-drawer">
    <summary>Filter history{filtersActive ? ` · ${chips.length + (quickView ? 1 : 0)} active` : ""}</summary>
    <div className="timeline-tools" tabIndex={0} aria-label="Timeline quick views and advanced filters">
    <div className="timeline-quick-views">
    <p id="timeline-quick-help" className="timeline-help">{QUICK_VIEW_HELP}</p>
    <div className="timeline-quick-row" role="group" aria-label="Quick views" aria-describedby="timeline-quick-help">
      {QUICK_VIEWS.map(item => <button key={item.id} type="button" aria-pressed={quickView === item.id}
        aria-describedby="timeline-quick-help" onClick={() => toggleQuickView(item.id)}>
        {item.label} <span className="quick-view-count" aria-hidden="true">{quickCounts[item.id]}</span>
        <span className="sr-only">, {quickCounts[item.id]} of {observations.length} recorded observations. It keeps {item.keeps}.</span>
      </button>)}
    </div>
    <div className="timeline-quick-row" role="group" aria-label="Recorded components and selected trace">
      {componentChips.map(chip => <button key={chip.value} type="button" aria-pressed={draft.component.trim() === chip.value && draft.componentMode === "exact"}
        onClick={() => toggleComponentChip(chip.value)}>{chip.label}<span className="sr-only"> ({chip.value})</span></button>)}
      {selectedTrace !== undefined ? <button type="button" aria-pressed={draft.traceId.trim() === selectedTrace && draft.traceMode === "exact"}
        onClick={() => toggleTraceChip(selectedTrace)}>Selected trace {selectedTrace}</button> : null}
    </div>
    </div>
    <p id="timeline-boundary" className="timeline-boundary">{boundaryCopy(selectedIndex, filtered.length)}</p>
    <details className="timeline-filter-disclosure">
    <summary>Advanced filters{chips.length > 0 ? ` (${chips.length} active)` : ""}</summary>
    <HelpHint label="How matching works" bodyId="timeline-filter-help">{TIMELINE_FILTER_HELP}</HelpHint>
    <form className="timeline-filters" aria-label="Timeline filters" aria-describedby="timeline-filter-help" onSubmit={event => event.preventDefault()}>
      <label>Virtual time from<input id="timeline-from" inputMode="numeric" autoComplete="off" aria-invalid={filterError !== null} aria-describedby={filterError ? "timeline-filter-error" : undefined} value={draft.fromTime} onChange={event => applyDraft({ ...draft, fromTime: event.target.value })} /></label>
      <label>Virtual time to<input id="timeline-to" inputMode="numeric" autoComplete="off" aria-invalid={filterError !== null} aria-describedby={filterError ? "timeline-filter-error" : undefined} value={draft.toTime} onChange={event => applyDraft({ ...draft, toTime: event.target.value })} /></label>
      <div className="filter-field"><label htmlFor="filter-field-choice">Filter by</label><select id="filter-field-choice" value={filterField} onChange={event => setFilterField(event.target.value as TextFilterField)}>
        <option value="type">Type</option><option value="component">Component</option>
        <option value="traceId">Trace</option><option value="eventId">Event</option>
        <option value="entityKind">Entity kind</option><option value="entityId">Entity id</option>
      </select></div>
      {([
        { field: "type", label: "Type", id: "type", mode: "typeMode", choices: suggestions.types },
        { field: "component", label: "Component", id: "component", mode: "componentMode", choices: suggestions.components },
        { field: "traceId", label: "Trace", id: "trace", mode: "traceMode", choices: suggestions.traces },
        { field: "eventId", label: "Event", id: "event", mode: "eventMode", choices: suggestions.events },
        { field: "entityKind", label: "Entity kind", id: "entity-kind", mode: "entityKindMode", choices: suggestions.entityKinds },
        { field: "entityId", label: "Entity id", id: "entity-id", mode: "entityIdMode", choices: suggestions.entityIds },
      ] as const).filter(item => item.field === filterField).map(item => <SuggestionField key={item.field}
        id={`timeline-${item.id}`} label={item.label} value={draft[item.field]} mode={draft[item.mode]} choices={item.choices}
        onValue={value => applyDraft({ ...draft, [item.field]: value })}
        onMode={mode => applyDraft({ ...draft, [item.mode]: mode })}
        onChoose={value => applyDraft(withExactValue(draft, item.field, value))} />)}
      <p className="filter-composer-note">Filters combine. Choose another field to narrow further; remove any condition using its chip below.</p>
    </form>
    {filterError ? <p id="timeline-filter-error" role="alert">{filterError}</p> : null}
    </details>
    <HelpHint label="Row order" bodyId="timeline-order" className="timeline-help">Next observation selects a recorded observation; it does not execute an event. Rows follow observation sequence, including observations at equal virtual times.</HelpHint>

    </div>
    </details>
    <p id="timeline-feedback" className="timeline-feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
    {/* Active constraints remain visible even when the filter drawer is closed. */}
    <div className="timeline-chip-row" hidden={!filtersActive} tabIndex={0} role="group" aria-label="Active filters and reset">
      {viewChip !== null || chips.length > 0 ? <ul className="timeline-chips" aria-label="Active filters">
        {viewChip !== null ? <li>
          <span>{viewChip.label}</span>
          <button type="button" aria-label={viewChip.removeLabel} onClick={() => {
            setQuickView(null);
            setFeedback(quickViewFeedback(null, observations.length, observations.length));
          }}>Remove</button>
        </li> : null}
        {chips.map(chip => <li key={chip.field}>
          <span>{chip.label}</span>
          <button type="button" aria-label={chip.removeLabel} onClick={() => applyDraft(clearTimelineField(draft, chip.field))}>Remove</button>
        </li>)}</ul> : null}
      <button type="button" disabled={!filtersActive} onClick={clearAllFilters}>Clear all filters</button>
    </div>
    <p className="timeline-count sr-only">{view === "story" ? storyCount
      : view === "learning"
      ? filtered.length === 0 ? `0 of ${observations.length} observations in virtual-time order.`
        : `${filtered.length} of ${observations.length} observations in virtual-time order. Learning view shows ${learningItems.length} items; ${hiddenLearningRecords} records summarized in expandable groups. Select a row to inspect its details.`
      : `${filtered.length} of ${observations.length} observations in virtual-time order.`}</p>
    {view === "learning" ? <>
      <div className="learning-column-headings" aria-hidden="true"><span>Summary</span><span>Virtual time · sequence</span><span>Component / destination</span></div>
    </> : null}
    <div id="timeline-rows" ref={scrollerRef} className={`timeline-rows${view === "story" ? " story-stage" : ""}`}  tabIndex={0} aria-describedby="timeline-order"
      aria-label={view === "story" ? "Story milestone strip and table" : view === "learning" ? "Learning timeline observations" : "Raw timeline observations"} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={event => {
        // The Story view is read by its own milestone table, so arrow keys stay with that table.
        if (view === "story") return;
        if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
        else if (event.key === "Home") { event.preventDefault(); if (filtered.length === 0) setFeedback(boundaryCopy(-1, 0)); else selectIndex(0); }
        else if (event.key === "End") { event.preventDefault(); const last = filtered.length - 1; if (last < 0) setFeedback(boundaryCopy(-1, 0)); else selectIndex(last); }
      }}>
      {filtered.length === 0 ? <p className="timeline-empty">{observations.length === 0 ? "No observations have been recorded for this run." : explanation}</p> : null}
      {view === "story" ? <StoryView milestones={milestones} lanes={lanes} legend={legend} summary={storyCopy} detail={storyDetailCopy}
        reduction={reduction} selectedId={selectedId} componentLabels={componentLabels} hasRecords={filtered.length > 0} onChoose={choose} /> : null}
      {view === "learning" ? <LearningRows items={learningItems} selectedId={selectedId} expandedGroups={expandedGroups}
        onToggle={id => setExpandedGroups(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onChoose={choose} /> : view === "raw" ? <div style={{ height: filtered.length * TIMELINE_ROW_HEIGHT, position: "relative" }}>
        {rawRows.map(item => <RawRow key={item.observation.id} observation={item.observation} index={item.index} selectedId={selectedId} onChoose={choose} />)}
      </div> : null}
    </div>
    </section>
    {selected ? <details className="story-inspector">
      <summary>Selected event details · #{selected.sequence}</summary>
      <ObservationDetail observation={selected} observations={observations} componentTitles={componentTitles}
        hidden={!filtered.some(item => item.id === selected.id)}
        onSelect={reveal} onShowTrace={showTrace} onUseText={useText} onUseEntity={useEntity} />
    </details> : null}
  </div>;
}

function StoryView({ milestones, lanes, legend, summary, detail, reduction, selectedId, componentLabels, hasRecords, onChoose }: {
  readonly milestones: readonly StoryMilestone[];
  readonly lanes: readonly string[];
  readonly legend: readonly StoryLegendEntry[];
  readonly summary: string;
  readonly detail: string;
  readonly reduction: string;
  readonly selectedId: string | null;
  readonly componentLabels: ReadonlyMap<string, string>;
  readonly hasRecords: boolean;
  readonly onChoose: (id: string) => void;
}) {
  const [presentation, setPresentation] = useState<"diagram" | "table">("diagram");
  const cells = new Map(milestones.map(milestone => [`${milestone.lane}:${milestone.column}`, milestone]));
  const columns = milestones.length;
  const gridColumns = `10rem repeat(${Math.max(columns, 1)}, minmax(6rem, 1fr))`;
  return <div className="story-view">
    <div className="story-view-toolbar">
      <div role="group" aria-label="Story presentation">
        <button type="button" aria-pressed={presentation === "diagram"} onClick={() => setPresentation("diagram")}>Diagram</button>
        <button type="button" aria-pressed={presentation === "table"} onClick={() => setPresentation("table")}>Table</button>
      </div>
      <HelpHint label="Reading the story" className="story-summary" bodyId="story-summary">{summary} Columns follow recorded sequence, not elapsed duration. Select a milestone for details.</HelpHint>
    </div>
    <p className="sr-only">{detail}</p>
    {milestones.length === 0 ? hasRecords
      ? <p className="story-empty">None of the visible records is a teaching milestone. Use Learning or Raw to read them.</p>
      : null : <>
      <ul className="story-legend" aria-label="Milestone categories, shapes, and counts">
        {legend.map(entry => <li key={entry.kind}>
          <span className={`story-shape story-shape-${entry.kind}`} aria-hidden="true">{entry.shape}</span>
          <span>{entry.label}</span>
          <span className="story-legend-count">{entry.count}</span>
        </li>)}
      </ul>
      {presentation === "diagram" ? <div className="story-strip" role="region" aria-label="Story diagram" tabIndex={0}>
        <div className="story-grid" style={{ gridTemplateColumns: gridColumns, gridTemplateRows: `auto repeat(${lanes.length}, minmax(5rem, 1fr))` }}>
          <div className="story-corner">Component</div>
          {milestones.map(milestone => <div key={`time-${milestone.observation.id}`} className="story-time"
            data-boundary={milestone.timeBoundary ? "true" : "false"}>
            {milestone.timeBoundary ? `t=${milestone.observation.time}` : ""}
          </div>)}
          {lanes.map(lane => <Fragment key={lane}>
            <div className="story-lane-label">{componentLabels.get(lane) ?? lane}</div>
            {milestones.map(milestone => {
              const cell = cells.get(`${lane}:${milestone.column}`);
              return <div key={cell?.observation.id ?? `empty-${milestone.column}`} className="story-cell"
                data-boundary={milestone.timeBoundary ? "true" : "false"}>
                {cell ? <button type="button" className={`story-milestone story-milestone-${cell.kind}`}
                  data-observation-id={cell.observation.id}
                  aria-label={`${cell.label}, ${componentLabels.get(lane) ?? lane}, virtual time ${cell.observation.time}, sequence ${cell.observation.sequence}`}
                  aria-pressed={cell.observation.id === selectedId}
                  data-selected={cell.observation.id === selectedId ? "true" : "false"}
                  onClick={() => onChoose(cell.observation.id)}>
                  <span className={`story-shape story-shape-${cell.kind}`}>{cell.shape}</span>
                  <span className="story-milestone-label">{cell.label}</span>
                </button> : null}
              </div>;
            })}
          </Fragment>)}
        </div>
      </div> : <div className="story-table-scroll">
      <table className="story-table">
        <caption>{reduction} Each row selects the same recorded observation as the strip.</caption>
        <thead>
          <tr>
            <th scope="col">Milestone</th>
            <th scope="col">Category</th>
            <th scope="col">Virtual time</th>
            <th scope="col">Sequence</th>
            <th scope="col">Component / destination</th>
          </tr>
        </thead>
        <tbody>
          {milestones.map(milestone => {
            const observation = milestone.observation;
            const where = observation.target !== undefined ? `${observation.source} → ${observation.target}` : observation.source;
            const category = legend.find(entry => entry.kind === milestone.kind);
            return <tr key={observation.id} data-selected={observation.id === selectedId ? "true" : "false"}>
              <th scope="row">
                <button type="button" data-observation-id={observation.id} aria-pressed={observation.id === selectedId}
                  onClick={() => onChoose(observation.id)}>{milestone.label}</button>
              </th>
              <td><span className={`story-shape story-shape-${milestone.kind}`} aria-hidden="true">{milestone.shape}</span>{category?.label ?? milestone.kind}</td>
              <td>t={observation.time}{milestone.timeBoundary ? "" : " (unchanged)"}</td>
              <td>#{observation.sequence}</td>
              <td>{where}</td>
            </tr>;
          })}
        </tbody>
      </table>
      </div>}
    </>}
  </div>;
}

function RawRow({ observation, index, selectedId, onChoose }: {
  readonly observation: Observation;
  readonly index: number;
  readonly selectedId: string | null;
  readonly onChoose: (id: string) => void;
}) {
  const path = observation.target ? `${observation.source} → ${observation.target}` : observation.source;
  const type = observation.type.toLowerCase();
  const semantic = type.includes("timeout") ? "is-warning" : type.includes("fault") || type.includes("failed") || type.includes("rejected") ? "is-error" : "";
  return <button type="button" data-observation-id={observation.id} aria-pressed={observation.id === selectedId}
    style={{ position: "absolute", top: index * TIMELINE_ROW_HEIGHT, height: TIMELINE_ROW_HEIGHT, left: 0, right: 0 }} onClick={() => onChoose(observation.id)}>
    <span>t={observation.time}</span><span>#{observation.sequence}</span><span className={semantic}>{observation.type}</span><span>{path}</span>
  </button>;
}

function LearningRows({ items, selectedId, expandedGroups, onToggle, onChoose }: {
  readonly items: ReturnType<typeof learningTimeline>;
  readonly selectedId: string | null;
  readonly expandedGroups: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onChoose: (id: string) => void;
}) {
  return <div className="learning-rows">{items.map(item => {
    if (item.kind === "observation") return <button key={item.observation.id} type="button" data-observation-id={item.observation.id}
      aria-pressed={item.observation.id === selectedId} onClick={() => onChoose(item.observation.id)}>
      <span className="learning-summary" title={`${item.summary} — ${item.observation.type}`}>{item.summary}{item.summary !== item.observation.type ? <small>{item.observation.type}</small> : null}</span><span>t={item.observation.time} · #{item.observation.sequence}</span><span className="learning-component" title={`${item.observation.source}${item.observation.target ? ` → ${item.observation.target}` : ""}`}>{item.observation.source}{item.observation.target ? ` → ${item.observation.target}` : ""}</span>
    </button>;
    const open = expandedGroups.has(item.id) || item.observations.some(observation => observation.id === selectedId);
    const first = item.observations[0]!;
    const last = item.observations.at(-1)!;
    return <details key={item.id} className="learning-group" open={open} onToggle={event => {
      if (event.currentTarget.open !== open) onToggle(item.id);
    }}>
      <summary>{open ? "Hide" : "Show"} {item.observations.length} records: {item.summary} (#{first.sequence}–#{last.sequence}, t={first.time}–{last.time})</summary>
      <ul id={`${item.id}-members`} className="learning-members">{item.observations.map(observation => <li key={observation.id}>
        <button type="button" data-observation-id={observation.id} aria-label="Open raw observation" aria-pressed={observation.id === selectedId} onClick={() => onChoose(observation.id)}>
          <span>#{observation.sequence}</span><span>t={observation.time}</span><span>{observation.type}</span><span className="sr-only">{observation.id}</span>
        </button>
      </li>)}</ul>
    </details>;
  })}</div>;
}

function suggestionBox(anchor: HTMLElement, count: number): { top: number; left: number; width: number } {
  const rect = anchor.getBoundingClientRect();
  const width = rect.width;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const estimated = Math.min(280, count * 36 + 28);
  const spaceBelow = window.innerHeight - rect.bottom;
  const top = spaceBelow < estimated && rect.top > spaceBelow
    ? Math.max(8, rect.top - estimated - 4)
    : rect.bottom + 4;
  return { top, left, width };
}

function SuggestionField({ id, label, value, mode, choices, onValue, onMode, onChoose }: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly mode: TextMatchMode;
  readonly choices: readonly FilterChoice[];
  readonly onValue: (value: string) => void;
  readonly onMode: (mode: TextMatchMode) => void;
  readonly onChoose: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const anchorRef = useRef<HTMLInputElement>(null);
  const listId = `${id}-list`;
  const noteId = `${id}-note`;
  const { shown, hidden } = visibleChoices(choices, value);
  const index = activeIndex >= 0 && activeIndex < shown.length ? activeIndex : -1;
  const active = index >= 0 ? shown[index] : undefined;
  const trimmed = value.trim();
  const note = shown.length === 0
    ? `No recorded values contain "${trimmed}".`
    : hidden > 0 ? `${hidden} more. Keep typing to narrow this list.` : "";
  const choose = (next: string) => {
    onChoose(next);
    setOpen(false);
    setActiveIndex(-1);
  };
  useEffect(() => {
    if (!open) return;
    // Same dismissal as HelpHint: the popup is removed on pointerdown, so a click
    // that lands on a control it covers still reaches that control.
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".filter-field") !== null) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return;
    const place = () => setBox(suggestionBox(anchor, Math.max(shown.length, 1)));
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, shown.length, value]);
  return <div className="filter-field">
    <label htmlFor={id}>{label}</label>
    <input ref={anchorRef} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      aria-controls={open && shown.length > 0 ? listId : undefined} aria-activedescendant={open && active ? `${id}-option-${index}` : undefined}
      aria-describedby={open && note ? noteId : undefined} value={value}
      onFocus={() => setOpen(true)}
      onBlur={() => { setOpen(false); setActiveIndex(-1); }}
      onChange={event => { setOpen(true); setActiveIndex(-1); onValue(event.target.value); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setOpen(true);
          setActiveIndex(current => shown.length === 0 ? -1 : Math.min(shown.length - 1, (current < 0 ? -1 : current) + 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          setActiveIndex(current => current <= 0 ? -1 : current - 1);
        } else if (event.key === "Escape") {
          if (open) { event.preventDefault(); setOpen(false); setActiveIndex(-1); }
        } else if (event.key === "Enter") {
          event.preventDefault();
          const exact = shown.filter(choice => choice.value === trimmed);
          const picked = active ?? (exact.length === 1 ? exact[0] : undefined);
          if (open && picked) choose(picked.value);
          else setOpen(false);
        }
      }} />
    <label htmlFor={`${id}-mode`}>{label} match</label>
    <select id={`${id}-mode`} value={mode} onChange={event => {
      const next = event.target.value;
      if (next === "exact" || next === "prefix" || next === "contains") onMode(next);
    }}>
      <option value="exact">Exact</option>
      <option value="prefix">Prefix</option>
      <option value="contains">Contains</option>
    </select>
    {open && box ? <div className="suggestion-popover" style={{ top: box.top, left: box.left, width: box.width }}>
      {shown.length > 0 ? <ul id={listId} role="listbox" aria-label={`${label} choices`}>{shown.map((choice, optionIndex) => <li key={choice.value}
        id={`${id}-option-${optionIndex}`} role="option" aria-selected={mode === "exact" && choice.value === trimmed}
        className={optionIndex === index ? "is-active" : undefined}
        onPointerDown={event => event.preventDefault()}
        onClick={() => choose(choice.value)}>{choice.label}</li>)}</ul> : null}
      {note ? <p id={noteId} className="suggestion-note">{note}</p> : null}
    </div> : null}
  </div>;
}

function ObservationDetail({ observation, observations, componentTitles, hidden, onSelect, onShowTrace, onUseText, onUseEntity }: {
  readonly observation: Observation | undefined;
  readonly observations: readonly Observation[];
  readonly componentTitles: readonly ComponentTitle[];
  readonly hidden: boolean;
  readonly onSelect: (id: string) => void;
  readonly onShowTrace: (traceId: string) => void;
  readonly onUseText: (field: TextFilterField, value: string) => void;
  readonly onUseEntity: (kind: string, id: string) => void;
}) {
  return <section id="inspection-panel" className="timeline-detail observation-panel" tabIndex={0} aria-labelledby="observation-detail-heading">
    <h2 id="observation-detail-heading">Observation detail</h2>
    {!observation ? <p>Select a milestone to see what happened and which components were involved. Technical details are available when you need them.</p> : <DetailBody
      observation={observation} observations={observations} componentTitles={componentTitles} hidden={hidden}
      onSelect={onSelect} onShowTrace={onShowTrace} onUseText={onUseText} onUseEntity={onUseEntity} />}
  </section>;
}

function DetailBody({ observation, observations, componentTitles, hidden, onSelect, onShowTrace, onUseText, onUseEntity }: {
  readonly observation: Observation;
  readonly observations: readonly Observation[];
  readonly componentTitles: readonly ComponentTitle[];
  readonly hidden: boolean;
  readonly onSelect: (id: string) => void;
  readonly onShowTrace: (traceId: string) => void;
  readonly onUseText: (field: TextFilterField, value: string) => void;
  readonly onUseEntity: (kind: string, id: string) => void;
}) {
  const links = correlation(observations, observation);
  const evidence = changeEvidence(observation);
  const visibility = payloadVisibility(observation);
  const trace = observation.traceId !== undefined ? traceView(observations, observation.traceId) : undefined;
  const eventId = observation.eventId;
  const traceId = observation.traceId;
  const target = observation.target;
  const entities = observation.entityRefs ?? [];
  const heading = recordLabel(observation);
  return <>
    {hidden ? <p>This observation is hidden by the current filters.</p> : null}
    <h3>{heading}</h3>
    <p className="event-path">{componentLabel(observation.source, componentTitles)}{target ? ` → ${componentLabel(target, componentTitles)}` : ""}</p>
    <p className="event-time">Virtual time {observation.time} · Step #{observation.sequence}</p>
    <details className="detail-disclosure">
    <summary>Record fields & filter shortcuts</summary>
    <dl>
      <dt>Sequence</dt><dd>#{observation.sequence}</dd>
      <dt>Virtual time</dt><dd>t={observation.time}</dd>
      <dt>Source</dt><dd>
        <span>{componentLabel(observation.source, componentTitles)}</span>
        <button type="button" onClick={() => onUseText("component", observation.source)}>Use source as component filter</button>
        <CopyButton label="Copy source id" value={observation.source} />
      </dd>
      {target !== undefined ? <><dt>Target</dt><dd>
        <span>{componentLabel(target, componentTitles)}</span>
        <button type="button" onClick={() => onUseText("component", target)}>Use target as component filter</button>
        <CopyButton label="Copy target id" value={target} />
      </dd></> : null}
      <dt>Payload</dt><dd>{payloadCopy(observation)}</dd>
    </dl>
    </details>
    <h3>Effect and evidence</h3>
    {evidence.length === 0 ? <p>No before or after values were stored.</p> : <ul className="change-evidence">
      {evidence.map((item, index) => <li key={`${item.label}:${index}`}>
        <p>{item.label}</p>
        {Object.hasOwn(item, "before") ? <><h4>Before</h4><pre>{JSON.stringify(item.before, null, 2)}</pre></> : <p>Before was not stored.</p>}
        {Object.hasOwn(item, "after") ? <><h4>After</h4><pre>{JSON.stringify(item.after, null, 2)}</pre></> : <p>After was not stored.</p>}
      </li>)}
    </ul>}
    <details className="detail-disclosure">
    <summary>Related evidence</summary>
    <h4>Causation</h4>
    {links.cause ? <p><button type="button" aria-controls="timeline-rows" onClick={() => onSelect(links.cause!.id)}>Select causing observation {links.cause.type} at virtual time {links.cause.time}</button></p> : null}
    {links.unresolvedCauseId ? <p>Causation {links.unresolvedCauseId} is not in this history.</p> : null}
    {!links.cause && !links.unresolvedCauseId ? <p>No causation reference was stored.</p> : null}
    {links.effects.length > 0 ? <ul>{links.effects.slice(0, SPAN_PREVIEW).map(effect => <li key={effect.id}>
      <button type="button" aria-controls="timeline-rows" onClick={() => onSelect(effect.id)}>Select effect {effect.type} at virtual time {effect.time}</button>
    </li>)}{links.effects.length > SPAN_PREVIEW ? <li>{links.effects.length - SPAN_PREVIEW} more effects. Show this trace to read them in order.</li> : null}</ul> : <p>No later observation points at this record.</p>}
    <h4>Trace</h4>
    {traceId !== undefined ? <p><button type="button" aria-controls="timeline-rows" onClick={() => onShowTrace(traceId)}>Show this trace</button></p> : <p>This observation has no trace.</p>}
    {eventId !== undefined || entities.length > 0 ? <div className="timeline-actions" role="group" aria-label="Filter from this observation">
      {eventId !== undefined ? <button type="button" onClick={() => onUseText("eventId", eventId)}>Use this event</button> : null}
      {entities.map((entity, index) => <button key={`${entity.kind}:${entity.id}:${index}`} type="button" onClick={() => onUseEntity(entity.kind, entity.id)}>Use entity {entity.kind} {entity.id}</button>)}
    </div> : null}
    </details>
    <details className="detail-disclosure">
    <summary>Technical record</summary>
    <dl>
      <dt>Observation</dt><dd><span>{observation.id}</span><CopyButton label="Copy observation id" value={observation.id} /></dd>
      <dt>Type</dt><dd>{observation.type}</dd>
      {traceId !== undefined ? <><dt>Trace</dt><dd><span>{traceId}</span><CopyButton label="Copy trace id" value={traceId} /></dd></> : null}
      {observation.spanId !== undefined ? <><dt>Span</dt><dd>{observation.spanId}</dd></> : null}
      {observation.parentSpanId !== undefined ? <><dt>Parent span</dt><dd>{observation.parentSpanId}</dd></> : null}
      {observation.causationId !== undefined ? <><dt>Causation</dt><dd>{observation.causationId}</dd></> : null}
      {eventId !== undefined ? <><dt>Event</dt><dd><span>{eventId}</span><CopyButton label="Copy event id" value={eventId} /></dd></> : null}
      {entities.length > 0 ? <><dt>Entities</dt><dd>{entities.map(entity => `${entity.kind} ${entity.id}`).join(", ")}</dd></> : null}
    </dl>
    <h4>Stored data</h4>
    <p>{payloadCopy(observation)}</p>
    {visibility === "redacted" ? <pre>{JSON.stringify(observation.data, null, 2)}</pre> : null}
    {visibility === "visible" ? <pre>{JSON.stringify(observation.data, null, 2)}</pre> : null}
    {trace ? <>
      <SpanList nodes={trace.roots} selectedId={observation.id} onSelect={onSelect} />
      {trace.unspanned.length > 0 ? <div>
        <h4>Observations without a span</h4>
        <ul>{trace.unspanned.slice(0, SPAN_PREVIEW).map(item => <li key={item.id}>
          <button type="button" aria-controls="timeline-rows" onClick={() => onSelect(item.id)}>{item.type} at virtual time {item.time}</button>
        </li>)}{trace.unspanned.length > SPAN_PREVIEW ? <li>{trace.unspanned.length - SPAN_PREVIEW} more observations have no span.</li> : null}</ul>
      </div> : null}
      {trace.causation.some(item => !item.causeFound) ? <ul>{trace.causation.filter(item => !item.causeFound).map(item =>
        <li key={item.effectId}>Causation {item.causeId} is not in this history.</li>)}</ul> : null}
    </> : null}
    </details>
  </>;
}

function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = window.setTimeout(() => setState("idle"), 4000);
    return () => window.clearTimeout(timer);
  }, [state]);
  return <span className="copy-control">
    <button type="button" onClick={() => {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) { setState("manual"); return; }
      void clipboard.writeText(value).then(() => setState("copied"), () => setState("manual"));
    }}>{state === "copied" ? `Copied ${label.replace(/^Copy /, "")}` : label}</button>
    {state === "manual" ? <input readOnly value={value} aria-label={`${label.replace(/^Copy /, "")} to copy`} onFocus={event => event.currentTarget.select()} /> : null}
  </span>;
}

function SpanList({ nodes, selectedId, onSelect, depth = 0 }: {
  readonly nodes: readonly SpanNode[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly depth?: number;
}) {
  if (!nodes.length) return null;
  if (depth >= SPAN_PREVIEW) return <p>{nodes.length} nested spans. Use the trace filter to inspect their observations in order.</p>;
  const shown = nodes.slice(0, SPAN_PREVIEW);
  return <ul className="timeline-tree">{shown.map(node => {
    const preview = node.observations.length <= SPAN_PREVIEW ? node.observations
      : [...node.observations.slice(0, SPAN_PREVIEW - 1), ...(node.observations.slice(0, SPAN_PREVIEW - 1).some(item => item.id === selectedId)
        ? [] : node.observations.filter(item => item.id === selectedId))];
    const hidden = node.observations.length - preview.length;
    return <li key={node.spanId}>
      <p>Span {node.spanId}{node.parentSpanId ? `, parent ${node.parentSpanId}` : ""}. {node.observations.length} observations.</p>
      <ul>{preview.map(item => <li key={item.id}>
        <button type="button" aria-controls="timeline-rows" onClick={() => onSelect(item.id)}>{item.type} at virtual time {item.time}</button>
      </li>)}</ul>
      {hidden > 0 ? <p>{hidden} more observations in this span. Show this trace to read them in order.</p> : null}
      <SpanList nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
    </li>;
  })}{nodes.length > shown.length ? <li>{nodes.length - shown.length} more spans. Use the trace filter to inspect their observations in order.</li> : null}</ul>;
}
