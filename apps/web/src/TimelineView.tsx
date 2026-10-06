import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Observation } from "@distlab/contracts";
import { QUICK_VIEWS, QUICK_VIEW_HELP } from "./timeline-quick-views.ts";
import { TIMELINE_FILTER_HELP, visibleChoices, withExactValue, clearTimelineField } from "./timeline-query.ts";
import type { ComponentTitle, FilterChoice, TextFilterField, TextMatchMode } from "./timeline-query.ts";
import type { MovementEdge, SpanNode } from "./records.ts";
import { correlation, payloadVisibility, traceView } from "./records.ts";
import { componentLabel } from "./timeline-query.ts";
import { TIMELINE_ROW_HEIGHT, TIMELINE_VIEWPORT, changeEvidence, learningTimeline, payloadCopy, recordLabel } from "./timeline.ts";
import type { GraphEmphasis, LearningTimelineItem } from "./timeline.ts";
import type { StoryLegendEntry, StoryMilestone } from "./story-timeline.ts";
import { createReviewNavigation, derive, transition } from "./review-navigation.ts";
import type { ReviewContext, ReviewIntent, ReviewNavigation } from "./review-navigation.ts";
import { HelpHint } from "./ui-hint.tsx";

const SPAN_PREVIEW = 12;

/**
 * Recorded history presentation. This component renders what review navigation
 * decided and adapts the DOM to it: it measures the scroller, and it applies the
 * scroll and focus requests navigation returns. Where the reader is, which
 * constraints are active, and which record is revealed all live in
 * `review-navigation.ts`; this file decides none of it.
 */
export function TimelineView({ observations, edges, componentTitles = [], onEmphasis, focusedObservationId, focusToken = 0 }: {
  readonly observations: readonly Observation[];
  readonly edges: readonly MovementEdge[];
  readonly componentTitles?: readonly ComponentTitle[];
  readonly onEmphasis: (emphasis: GraphEmphasis | undefined) => void;
  readonly focusedObservationId?: string;
  readonly focusToken?: number;
}) {
  const [navigation, send] = useReducer(reduce, undefined, createReviewNavigation);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowViewport, setRowViewport] = useState(TIMELINE_VIEWPORT);
  const appliedScrollRef = useRef(0);
  const appliedFocusRef = useRef(-1);
  const emphasisRef = useRef<GraphEmphasis | undefined>(undefined);
  const requestedRef = useRef<number>(-1);

  const context: ReviewContext = useMemo(() => ({
    observations,
    edges,
    componentTitles,
    viewport: { scrollTop, height: rowViewport },
  }), [observations, edges, componentTitles, scrollTop, rowViewport]);
  const view = derive(navigation, context);
  const dispatch = (intent: ReviewIntent) => send({ intent, context });

  // History continuity: growth raises a cue for the newest movement, replacement
  // drops the review position and every active constraint.
  useEffect(() => {
    dispatch({ type: "published", observations });
  }, [observations]);

  // A record named from outside Recorded history, such as an evidence link.
  useEffect(() => {
    if (focusedObservationId === undefined) return;
    if (requestedRef.current === focusToken) return;
    requestedRef.current = focusToken;
    dispatch({ type: "reveal", observationId: focusedObservationId });
  }, [focusedObservationId, focusToken]);

  // Derive returns a fresh projection each render, so the graph highlight is
  // compared by value. Comparing by identity would hand the shell a new object
  // on every render and never settle.
  useEffect(() => {
    if (sameEmphasis(emphasisRef.current, view.emphasis)) return;
    emphasisRef.current = view.emphasis;
    onEmphasis(view.emphasis);
  }, [view.emphasis, onEmphasis]);

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

  // Scroll and focus are requests, so each is applied once per change. A
  // `focus-row` request is applied with the focus, below.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || view.scroll.epoch === appliedScrollRef.current) return;
    appliedScrollRef.current = view.scroll.epoch;
    if (view.scroll.kind === "top") {
      node.scrollTop = 0;
      setScrollTop(0);
      return;
    }
    if (view.scroll.kind !== "ensure-visible" || view.scroll.index < 0) return;
    if (view.scroll.view === "raw") {
      // Raw rows have fixed geometry, so the selected row's offset is its index.
      const top = view.scroll.index * TIMELINE_ROW_HEIGHT;
      if (top < node.scrollTop || top + TIMELINE_ROW_HEIGHT > node.scrollTop + node.clientHeight) {
        node.scrollTop = top;
        setScrollTop(top);
      }
      return;
    }
    // Story and Learning rows have variable height; scroll the actual member.
    const scope = view.scroll.view === "story" ? node.querySelector(".story-table") ?? node : node;
    scope.querySelector<HTMLElement>(`[data-observation-id="${CSS.escape(view.scroll.observationId ?? "")}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view.scroll]);

  // Focus stays requested until the DOM reports the row focused.
  useEffect(() => {
    const node = scrollerRef.current;
    const focus = view.focus;
    if (!node || focus === null || appliedFocusRef.current === focus.token) return;
    const row = node.querySelector<HTMLButtonElement>(`[data-observation-id="${CSS.escape(focus.observationId)}"]`);
    if (!row && navigation.view === "raw") {
      // Virtualized Raw rows outside the current window are not in the DOM.
      // Move the window to the selected index so the next render includes it,
      // then retry focusing. This covers evidence navigation that activates the
      // Recorded history tab while it was hidden.
      const top = view.selectedIndex * TIMELINE_ROW_HEIGHT;
      node.scrollTop = top;
      setScrollTop(top);
      return;
    }
    if (!row) return;
    appliedFocusRef.current = focus.token;
    // Learning groups have variable height; scroll the actual member rather than
    // assuming the fixed raw-row geometry used by the virtualized Raw view.
    if (navigation.view === "learning") row.scrollIntoView({ block: "nearest", inline: "nearest" });
    else {
      const top = view.selectedIndex * TIMELINE_ROW_HEIGHT;
      if (top < node.scrollTop || top + TIMELINE_ROW_HEIGHT > node.scrollTop + node.clientHeight) node.scrollTop = top;
    }
    row.focus({ preventScroll: true });
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
    document.getElementById("inspection-panel")?.scrollTo(0, 0);
  }, [view.focus, navigation.view, view.selectedIndex, scrollTop]);

  const {
    boundaryCopy, chips, componentChips, componentLabels, explanation, filtered, filtersActive,
    hiddenLearningRecords, learningItems, legend, lanes, milestones, quickCounts, quickCopy,
    reduction, selected, selectedTrace, storyCopy, storyCount, storyDetailCopy, suggestions, viewChip,
  } = view;

  return <div className="history-layout">
    <section id="timeline-panel" className="timeline-panel" tabIndex={-1} aria-labelledby="timeline-heading">
    <div className="history-heading"><h2 id="timeline-heading">Recorded history</h2>
      <div className="timeline-view-switch" role="group" aria-label="Timeline view">
        <button type="button" aria-pressed={navigation.view === "story"} onClick={() => dispatch({ type: "switch-view", view: "story" })}>Story</button>
        <button type="button" aria-pressed={navigation.view === "learning"} onClick={() => dispatch({ type: "switch-view", view: "learning" })}>Learning</button>
        <button type="button" aria-pressed={navigation.view === "raw"} onClick={() => dispatch({ type: "switch-view", view: "raw" })}>Raw</button>
      </div>
    </div>
    {/* The review position only. Run status and virtual time have one home, the committed-state summary. */}
    <p className={selected ? "timeline-cursor" : "sr-only"} role="status" aria-live="polite">{selected
      ? `Reviewing observation ${selected.sequence} at virtual t=${selected.time}.`
      : "No observation selected."}</p>
    <p id="timeline-quick-count" className={filtersActive ? "timeline-quick-count" : "sr-only"}>{quickCopy}</p>
    <div className="story-filter-bar">
      <label htmlFor="story-quick-view">Show</label>
      <select id="story-quick-view" value={navigation.quickView ?? "all"} onChange={event => {
        const next = QUICK_VIEWS.find(item => item.id === event.target.value);
        dispatch({ type: "select-quick-view", id: next ? next.id : null });
      }}>
        <option value="all">All categories</option>
        {QUICK_VIEWS.map(item => <option key={item.id} value={item.id}>{item.label} ({quickCounts[item.id]})</option>)}
      </select>
      <label htmlFor="story-component">Focus component</label>
      <select id="story-component" value={componentChips.some(chip => chip.value === navigation.draft.component) && navigation.draft.componentMode === "exact" ? navigation.draft.component : ""}
        onChange={event => dispatch({ type: "set-draft",
          draft: event.target.value ? withExactValue(navigation.draft, "component", event.target.value) : clearTimelineField(navigation.draft, "component") })}>
        <option value="">All components</option>
        {componentChips.map(chip => <option key={chip.value} value={chip.value}>{chip.label}</option>)}
      </select>
    </div>
    <details className="history-filter-drawer">
    <summary>Filter history{filtersActive ? ` · ${chips.length + (navigation.quickView ? 1 : 0)} active` : ""}</summary>
    <div className="timeline-tools" tabIndex={0} aria-label="Timeline quick views and advanced filters">
    <div className="timeline-quick-views">
      <p id="timeline-quick-help" className="timeline-help">{QUICK_VIEW_HELP}</p>
      <div className="timeline-quick-row" role="group" aria-label="Quick views" aria-describedby="timeline-quick-help">
      {QUICK_VIEWS.map(item => <button key={item.id} type="button" aria-pressed={navigation.quickView === item.id}
        aria-describedby="timeline-quick-help" onClick={() => dispatch({ type: "toggle-quick-view", id: item.id })}>
        {item.label} <span className="quick-view-count" aria-hidden="true">{quickCounts[item.id]}</span>
        <span className="sr-only">, {quickCounts[item.id]} of {observations.length} recorded observations. It keeps {item.keeps}.</span>
      </button>)}
    </div>
    <div className="timeline-quick-row" role="group" aria-label="Recorded components and selected trace">
      {componentChips.map(chip => <button key={chip.value} type="button" aria-pressed={navigation.draft.component.trim() === chip.value && navigation.draft.componentMode === "exact"}
        onClick={() => dispatch({ type: "toggle-component", value: chip.value })}>{chip.label}<span className="sr-only"> ({chip.value})</span></button>)}
      {selectedTrace !== undefined ? <button type="button" aria-pressed={navigation.draft.traceId.trim() === selectedTrace && navigation.draft.traceMode === "exact"}
        onClick={() => dispatch({ type: "toggle-trace", traceId: selectedTrace })}>Selected trace {selectedTrace}</button> : null}
    </div>
    </div>
    <p id="timeline-boundary" className="timeline-boundary">{boundaryCopy}</p>
    <details className="timeline-filter-disclosure">
    <summary>Advanced filters{chips.length > 0 ? ` (${chips.length} active)` : ""}</summary>
    <HelpHint label="How matching works" bodyId="timeline-filter-help">{TIMELINE_FILTER_HELP}</HelpHint>
    <form className="timeline-filters" aria-label="Timeline filters" aria-describedby="timeline-filter-help" onSubmit={event => event.preventDefault()}>
      <label>Virtual time from<input id="timeline-from" inputMode="numeric" autoComplete="off" aria-invalid={navigation.filterError !== null} aria-describedby={navigation.filterError ? "timeline-filter-error" : undefined} value={navigation.draft.fromTime} onChange={event => dispatch({ type: "set-draft", draft: { ...navigation.draft, fromTime: event.target.value } })} /></label>
      <label>Virtual time to<input id="timeline-to" inputMode="numeric" autoComplete="off" aria-invalid={navigation.filterError !== null} aria-describedby={navigation.filterError ? "timeline-filter-error" : undefined} value={navigation.draft.toTime} onChange={event => dispatch({ type: "set-draft", draft: { ...navigation.draft, toTime: event.target.value } })} /></label>
      <div className="filter-field"><label htmlFor="filter-field-choice">Filter by</label><select id="filter-field-choice" value={navigation.filterField} onChange={event => dispatch({ type: "set-filter-field", field: event.target.value as TextFilterField })}>
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
      ] as const).filter(item => item.field === navigation.filterField).map(item => <SuggestionField key={item.field}
        id={`timeline-${item.id}`} label={item.label} value={navigation.draft[item.field]} mode={navigation.draft[item.mode]} choices={item.choices}
        onValue={value => dispatch({ type: "set-draft", draft: { ...navigation.draft, [item.field]: value } })}
        onMode={mode => dispatch({ type: "set-draft", draft: { ...navigation.draft, [item.mode]: mode } })}
        onChoose={value => dispatch({ type: "set-draft", draft: withExactValue(navigation.draft, item.field, value) })} />)}
      <p className="filter-composer-note">Filters combine. Choose another field to narrow further; remove any condition using its chip below.</p>
    </form>
    {navigation.filterError ? <p id="timeline-filter-error" role="alert">{navigation.filterError}</p> : null}
    </details>
    <HelpHint label="Row order" bodyId="timeline-order" className="timeline-help">Next observation selects a recorded observation; it does not execute an event. Rows follow observation sequence, including observations at equal virtual times.</HelpHint>

    </div>
    </details>
    <p id="timeline-feedback" className="timeline-feedback" role="status" aria-live="polite" aria-atomic="true">{navigation.feedback}</p>
    {/* Active constraints remain visible even when the filter drawer is closed. */}
    <div className="timeline-chip-row" hidden={!filtersActive} tabIndex={0} role="group" aria-label="Active filters and reset">
      {viewChip !== null || chips.length > 0 ? <ul className="timeline-chips" aria-label="Active filters">
        {viewChip !== null ? <li>
          <span>{viewChip.label}</span>
          <button type="button" aria-label={viewChip.removeLabel} onClick={() => dispatch({ type: "clear-quick-view" })}>Remove</button>
        </li> : null}
        {chips.map(chip => <li key={chip.field}>
          <span>{chip.label}</span>
          <button type="button" aria-label={chip.removeLabel} onClick={() => dispatch({ type: "set-draft", draft: clearTimelineField(navigation.draft, chip.field) })}>Remove</button>
        </li>)}</ul> : null}
      <button type="button" disabled={!filtersActive} onClick={() => dispatch({ type: "clear-all" })}>Clear all filters</button>
    </div>
    <p className="timeline-count sr-only">{navigation.view === "story" ? storyCount
      : navigation.view === "learning"
      ? filtered.length === 0 ? `0 of ${observations.length} observations in virtual-time order.`
        : `${filtered.length} of ${observations.length} observations in virtual-time order. Learning view shows ${learningItems.length} items; ${hiddenLearningRecords} records summarized in expandable groups. Select a row to inspect its details.`
      : `${filtered.length} of ${observations.length} observations in virtual-time order.`}</p>
    {navigation.view === "learning" ? <>
      <div className="learning-column-headings" aria-hidden="true"><span>Summary</span><span>Virtual time · sequence</span><span>Component / destination</span></div>
    </> : null}
    <div id="timeline-rows" ref={scrollerRef} className={`timeline-rows${navigation.view === "story" ? " story-stage" : ""}`}  tabIndex={0} aria-describedby="timeline-order"
      aria-label={navigation.view === "story" ? "Story milestone strip and table" : navigation.view === "learning" ? "Learning timeline observations" : "Raw timeline observations"} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={event => {
        // The Story view is read by its own milestone table, so arrow keys stay with that table.
        if (navigation.view === "story") return;
        if (event.key === "ArrowDown") { event.preventDefault(); dispatch({ type: "move", delta: 1 }); }
        else if (event.key === "ArrowUp") { event.preventDefault(); dispatch({ type: "move", delta: -1 }); }
        else if (event.key === "Home") { event.preventDefault(); dispatch({ type: "select-index", index: 0 }); }
        else if (event.key === "End") { event.preventDefault(); dispatch({ type: "select-index", index: filtered.length - 1 }); }
      }}>
      {filtered.length === 0 ? <p className="timeline-empty">{observations.length === 0 ? "No observations have been recorded for this run." : explanation}</p> : null}
      {navigation.view === "story" ? <StoryView milestones={milestones} lanes={lanes} legend={legend} summary={storyCopy} detail={storyDetailCopy}
        reduction={reduction} selectedId={navigation.selectedId} componentLabels={componentLabels} hasRecords={filtered.length > 0} onChoose={id => dispatch({ type: "select", observationId: id })} /> : null}
      {navigation.view === "learning" ? <LearningRows items={learningItems} selectedId={navigation.selectedId} expandedGroups={navigation.expandedGroups}
        onToggle={id => dispatch({ type: "toggle-group", id })} onChoose={id => dispatch({ type: "select", observationId: id })} /> : navigation.view === "raw" ? <div style={{ height: filtered.length * TIMELINE_ROW_HEIGHT, position: "relative" }}>
        {view.rawRows.map(item => <RawRow key={item.observation.id} observation={item.observation} index={item.index} selectedId={navigation.selectedId} onChoose={id => dispatch({ type: "select", observationId: id })} />)}
      </div> : null}
    </div>
    </section>
    {selected ? <details className="story-inspector">
      <summary>Selected event details · #{selected.sequence}</summary>
      <ObservationDetail observation={selected} observations={observations} componentTitles={componentTitles}
        hidden={!filtered.some(item => item.id === selected.id)}
        onSelect={id => dispatch({ type: "reveal", observationId: id })}
        onShowTrace={traceId => dispatch({ type: "narrow-to-trace", traceId })}
        onUseText={(field, value) => dispatch({ type: "set-draft", draft: withExactValue(navigation.draft, field, value) })}
        onUseEntity={(kind, id) => dispatch({ type: "set-draft", draft: withExactValue(withExactValue(navigation.draft, "entityKind", kind), "entityId", id) })} />
    </details> : null}
  </div>;
}

/**
 * The reducer is the only writer of navigation state. It carries the context the
 * transition needs, so no transition reads a stale projection.
 */
function reduce(state: ReviewNavigation, action: { readonly intent: ReviewIntent; readonly context: ReviewContext }): ReviewNavigation {
  return transition(state, action.intent, action.context);
}

/** Value equality for the graph highlight, so an unchanged selection is not republished. */
function sameEmphasis(left: GraphEmphasis | undefined, right: GraphEmphasis | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.edgeId === right.edgeId && left.kind === right.kind && left.text === right.text
    && left.pulseId === right.pulseId && left.origin === right.origin
    && left.nodeIds.length === right.nodeIds.length && left.nodeIds.every((id, index) => id === right.nodeIds[index]);
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
