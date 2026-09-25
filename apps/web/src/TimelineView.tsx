import { useEffect, useMemo, useRef, useState } from "react";
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
  TIMELINE_ROW_HEIGHT,
  TIMELINE_VIEWPORT,
  boundaryCopy,
  changeEvidence,
  continuesHistory,
  correlation,
  emphasisFor,
  learningTimeline,
  movementCue,
  movementMessage,
  payloadCopy,
  payloadVisibility,
  playbackAdvance,
  playbackControl,
  playbackStatus,
  revealMessage,
  selectionAvailability,
  selectionMessage,
  selectionStep,
  traceFilterMessage,
  traceView,
  visibleRowRange,
} from "./timeline.ts";
import type { GraphEmphasis, MovementEdge, PlaybackPhase, SpanNode } from "./timeline.ts";

/** Host interval for the playback cursor only. It never calls the simulation host. */
const PLAYBACK_INTERVAL_MS = 1000;
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
  const [query, setQuery] = useState<TimelineQuery>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const [view, setView] = useState<"learning" | "raw">("learning");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<PlaybackPhase>("idle");
  const [feedback, setFeedback] = useState("");
  const [liveCueId, setLiveCueId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowViewport, setRowViewport] = useState(TIMELINE_VIEWPORT);
  const [focusNonce, setFocusNonce] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const pauseButtonRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef<readonly Observation[] | null>(null);
  const seenRef = useRef(-1);
  const pendingFocusId = useRef<string | null>(null);
  const playHadFocus = useRef(false);
  const returnFocusToPlay = useRef(false);
  const suggestions = useMemo(() => timelineSuggestions(observations, componentTitles), [observations, componentTitles]);
  const filtered = useMemo(() => queryTimeline(observations, query), [observations, query]);
  const chips = useMemo(() => activeFilterChips(query, componentTitles), [query, componentTitles]);
  const learningItems = useMemo(() => learningTimeline(filtered), [filtered]);
  const hiddenLearningRecords = filtered.length - learningItems.length;
  const explanation = useMemo(
    () => filtered.length === 0 && observations.length > 0 ? emptyFilterExplanation(query, observations, componentTitles) : "",
    [filtered.length, observations, query, componentTitles],
  );
  const filteredRef = useRef(filtered);
  const selectedRef = useRef(selectedId);
  const draftRef = useRef(draft);
  const observationsRef = useRef(observations);
  filteredRef.current = filtered;
  selectedRef.current = selectedId;
  draftRef.current = draft;
  observationsRef.current = observations;
  const selected = observations.find(item => item.id === selectedId);
  const selectedIndex = filtered.findIndex(item => item.id === selectedId);
  const playing = phase === "playing";
  const transport = playbackControl(selectedIndex, filtered.length, playing);
  const availability = selectionAvailability(selectedIndex, filtered.length);
  const liveCue = useMemo(() => {
    if (selected || liveCueId === null) return null;
    const observation = observations.find(item => item.id === liveCueId);
    return observation ? movementCue(observation, edges) : null;
  }, [selected, liveCueId, observations, edges]);
  const emphasis = useMemo(() => {
    if (selected) return emphasisFor(selected, edges);
    if (!liveCue) return undefined;
    return {
      nodeIds: liveCue.nodeIds,
      ...(liveCue.edgeId !== undefined ? { edgeId: liveCue.edgeId } : {}),
      kind: liveCue.kind,
      text: liveCue.text,
      pulseId: liveCue.observationId,
    };
  }, [selected, edges, liveCue]);

  const requestFocus = (id: string) => {
    pendingFocusId.current = id;
    setFocusNonce(value => value + 1);
  };
  const haltPlayback = () => { setPhase(current => current === "idle" ? "idle" : "paused"); };

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
    setPhase(current => current === "idle" ? "idle" : "paused");
    if (!observation) {
      setFeedback("That observation is not in this history.");
      return;
    }
    const revealed = revealTimelineObservation(draftRef.current, observation);
    if (revealed.changed) {
      setDraft(revealed.draft);
      setQuery(revealed.query);
      setFilterError(null);
    }
    setSelectedId(observation.id);
    setFeedback(revealMessage(revealed.cleared, observation));
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
      setPhase("idle");
      setFeedback("");
      setLiveCueId(null);
      setScrollTop(0);
      setDraft(emptyTimelineDraft);
      setQuery({});
      setFilterError(null);
      seenRef.current = observations.at(-1)?.sequence ?? -1;
      return;
    }
    let newest: string | null = null;
    for (const observation of observations) {
      if (observation.sequence <= seenRef.current) continue;
      if (movementCue(observation, edges)) newest = observation.id;
    }
    seenRef.current = observations.at(-1)?.sequence ?? seenRef.current;
    if (newest) setLiveCueId(newest);
  }, [observations, edges]);

  useEffect(() => {
    if (!liveCueId || playing || selectedId) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => {
      setLiveCueId(current => current === liveCueId ? null : current);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [liveCueId, playing, selectedId]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const list = filteredRef.current;
      if (list.length <= 1) {
        setPhase("paused");
        setFeedback(list.length === 0 ? "No visible observations to play." : "Only one visible observation. Playback cannot advance.");
        return;
      }
      const index = list.findIndex(item => item.id === selectedRef.current);
      const step = playbackAdvance(index, list.length);
      const next = list[step.cursor];
      const reachedEnd = !step.playing || step.cursor >= list.length - 1;
      if (next) setSelectedId(next.id);
      if (reachedEnd) {
        if (document.activeElement === pauseButtonRef.current) returnFocusToPlay.current = true;
        setPhase("ended");
        setFeedback("Playback reached the end of the visible results. Restart timeline plays from the first visible observation.");
      }
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    if (playing && playHadFocus.current) {
      playHadFocus.current = false;
      pauseButtonRef.current?.focus();
    }
  }, [playing]);

  useEffect(() => {
    if (phase === "ended" && returnFocusToPlay.current) {
      returnFocusToPlay.current = false;
      playButtonRef.current?.focus();
    }
  }, [phase]);

  const filterKey = JSON.stringify(query);
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
    const top = index * TIMELINE_ROW_HEIGHT;
    if (top < node.scrollTop || top + TIMELINE_ROW_HEIGHT > node.scrollTop + node.clientHeight) node.scrollTop = top;
  }, [selectedId, filtered]);

  useEffect(() => {
    const id = pendingFocusId.current;
    const node = scrollerRef.current;
    if (!id || !node) return;
    const index = filtered.findIndex(item => item.id === id);
    if (index < 0) return;
    const row = node.querySelector<HTMLButtonElement>(`[data-observation-id="${CSS.escape(id)}"]`);
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

  const applyDraft = (next: TimelineDraft) => {
    setDraft(next);
    const parsed = parseTimelineQuery(next);
    if (parsed.ok) { setQuery(parsed.query); setFilterError(null); }
    else setFilterError(parsed.message);
  };
  const choose = (id: string) => {
    haltPlayback();
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
    haltPlayback();
    const revealed = revealTimelineObservation(draft, observation);
    if (revealed.changed) {
      setDraft(revealed.draft);
      setQuery(revealed.query);
      setFilterError(null);
    }
    setSelectedId(observation.id);
    setFeedback(revealMessage(revealed.cleared, observation));
    requestFocus(observation.id);
  };
  const showTrace = (traceId: string) => {
    const change = narrowToTrace(draft, traceId);
    haltPlayback();
    applyDraft(change.draft);
    setFeedback(traceFilterMessage(traceId, change));
    if (selectedId) requestFocus(selectedId);
  };
  const selectIndex = (index: number) => {
    const row = filtered[index];
    if (!row) return;
    haltPlayback();
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
  const play = () => {
    if (transport.action === "unavailable") return;
    const start = transport.action === "restart" || selectedIndex < 0 ? 0 : selectedIndex;
    const row = filtered[start];
    if (!row) return;
    playHadFocus.current = document.activeElement === playButtonRef.current;
    setSelectedId(row.id);
    setPhase("playing");
    setFeedback(transport.action === "restart"
      ? "Restarting the visible timeline from the first observation. Virtual time does not change."
      : "Playing the visible timeline. Pause stops the cursor. Virtual time does not change.");
  };
  const pause = () => {
    if (!playing) return;
    setPhase("paused");
    setFeedback("Playback is paused.");
  };
  const useText = (field: TextFilterField, value: string) => applyDraft(withExactValue(draft, field, value));
  const useEntity = (kind: string, id: string) => applyDraft(withExactValue(withExactValue(draft, "entityKind", kind), "entityId", id));
  const range = visibleRowRange(filtered.length, scrollTop, rowViewport, TIMELINE_ROW_HEIGHT);
  const windowRows = filtered.slice(range.start, range.end);
  const filtersActive = !timelineDraftIsBlank(draft) || filterError !== null;

  return <>
    <section id="timeline-panel" className="timeline-panel" tabIndex={-1} aria-labelledby="timeline-heading">
    <h3 id="timeline-heading">Timeline</h3>
    <div className="timeline-tools" tabIndex={0} aria-label="Timeline filters and playback">
    <p id="timeline-order">Rows follow observation sequence. Virtual time is the simulation clock, not wall-clock time. Equal virtual times keep that sequence.</p>
    <p id="timeline-filter-help" className="timeline-help">{TIMELINE_FILTER_HELP}</p>
    <form className="timeline-filters" aria-label="Timeline filters" aria-describedby="timeline-filter-help" onSubmit={event => event.preventDefault()}>
      <label>Virtual time from<input id="timeline-from" inputMode="numeric" autoComplete="off" aria-invalid={filterError !== null} aria-describedby={filterError ? "timeline-filter-error" : undefined} value={draft.fromTime} onChange={event => applyDraft({ ...draft, fromTime: event.target.value })} /></label>
      <label>Virtual time to<input id="timeline-to" inputMode="numeric" autoComplete="off" aria-invalid={filterError !== null} aria-describedby={filterError ? "timeline-filter-error" : undefined} value={draft.toTime} onChange={event => applyDraft({ ...draft, toTime: event.target.value })} /></label>
      <SuggestionField id="timeline-type" label="Type" value={draft.type} mode={draft.typeMode} choices={suggestions.types}
        onValue={value => applyDraft({ ...draft, type: value })} onMode={typeMode => applyDraft({ ...draft, typeMode })}
        onChoose={value => applyDraft({ ...draft, type: value, typeMode: "exact" })} />
      <SuggestionField id="timeline-component" label="Component" value={draft.component} mode={draft.componentMode} choices={suggestions.components}
        onValue={value => applyDraft({ ...draft, component: value })} onMode={componentMode => applyDraft({ ...draft, componentMode })}
        onChoose={value => applyDraft({ ...draft, component: value, componentMode: "exact" })} />
      <SuggestionField id="timeline-trace" label="Trace" value={draft.traceId} mode={draft.traceMode} choices={suggestions.traces}
        onValue={value => applyDraft({ ...draft, traceId: value })} onMode={traceMode => applyDraft({ ...draft, traceMode })}
        onChoose={value => applyDraft({ ...draft, traceId: value, traceMode: "exact" })} />
      <SuggestionField id="timeline-event" label="Event" value={draft.eventId} mode={draft.eventMode} choices={suggestions.events}
        onValue={value => applyDraft({ ...draft, eventId: value })} onMode={eventMode => applyDraft({ ...draft, eventMode })}
        onChoose={value => applyDraft({ ...draft, eventId: value, eventMode: "exact" })} />
      <SuggestionField id="timeline-entity-kind" label="Entity kind" value={draft.entityKind} mode={draft.entityKindMode} choices={suggestions.entityKinds}
        onValue={value => applyDraft({ ...draft, entityKind: value })} onMode={entityKindMode => applyDraft({ ...draft, entityKindMode })}
        onChoose={value => applyDraft({ ...draft, entityKind: value, entityKindMode: "exact" })} />
      <SuggestionField id="timeline-entity-id" label="Entity id" value={draft.entityId} mode={draft.entityIdMode} choices={suggestions.entityIds}
        onValue={value => applyDraft({ ...draft, entityId: value })} onMode={entityIdMode => applyDraft({ ...draft, entityIdMode })}
        onChoose={value => applyDraft({ ...draft, entityId: value, entityIdMode: "exact" })} />
      <div className="timeline-chip-row">
        {chips.length > 0 ? <ul className="timeline-chips" aria-label="Active filters">{chips.map(chip => <li key={chip.field}>
          <span>{chip.label}</span>
          <button type="button" aria-label={chip.removeLabel} onClick={() => applyDraft(clearTimelineField(draft, chip.field))}>Remove</button>
        </li>)}</ul> : null}
        <button type="button" disabled={!filtersActive} onClick={() => applyDraft(emptyTimelineDraft)}>Clear all filters</button>
      </div>
    </form>
    {filterError ? <p id="timeline-filter-error" role="alert">{filterError}</p> : null}
    <p id="timeline-boundary" className="timeline-boundary">{boundaryCopy(selectedIndex, filtered.length)}</p>
    <div className="control-buttons timeline-transport" role="group" aria-label="Timeline playback">
      <button ref={playButtonRef} type="button" aria-pressed={playing} disabled={transport.action === "unavailable"} aria-describedby="timeline-playback" onClick={play}>{transport.label}</button>
      <button ref={pauseButtonRef} type="button" disabled={!playing} aria-describedby="timeline-playback" onClick={pause}>Pause timeline</button>
      <button type="button" disabled={!availability.previous} aria-describedby="timeline-boundary" onClick={() => move(-1)}>Previous observation</button>
      <button type="button" disabled={!availability.next} aria-describedby="timeline-boundary" onClick={() => move(1)}>Next observation</button>
    </div>
    <p id="timeline-playback" className="timeline-playback">{playbackStatus(phase, transport)}</p>
    <p id="timeline-feedback" className="timeline-feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
    </div>
    <div className="timeline-view-switch" role="group" aria-label="Timeline view">
      <button type="button" aria-pressed={view === "learning"} onClick={() => setView("learning")}>Learning view</button>
      <button type="button" aria-pressed={view === "raw"} onClick={() => setView("raw")}>Raw view</button>
    </div>
    <p className="timeline-count">{view === "learning"
      ? filtered.length === 0 ? `0 of ${observations.length} observations in virtual-time order.`
        : `${filtered.length} of ${observations.length} observations in virtual-time order. Learning view shows ${learningItems.length} items; ${hiddenLearningRecords} records are inside expandable groups.`
      : `${filtered.length} of ${observations.length} observations in virtual-time order.`}</p>
    <div id="timeline-rows" ref={scrollerRef} className="timeline-rows" tabIndex={0} aria-describedby="timeline-order"
      aria-label={view === "learning" ? "Learning timeline observations" : "Raw timeline observations"} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
        else if (event.key === "Home") { event.preventDefault(); if (filtered.length === 0) setFeedback(boundaryCopy(-1, 0)); else selectIndex(0); }
        else if (event.key === "End") { event.preventDefault(); const last = filtered.length - 1; if (last < 0) setFeedback(boundaryCopy(-1, 0)); else selectIndex(last); }
      }}>
      {filtered.length === 0 ? <p className="timeline-empty">{observations.length === 0 ? "No observations have been recorded for this run." : explanation}</p> : null}
      {view === "learning" ? <LearningRows items={learningItems} selectedId={selectedId} expandedGroups={expandedGroups}
        onToggle={id => setExpandedGroups(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onChoose={choose} /> : <div style={{ height: filtered.length * TIMELINE_ROW_HEIGHT, position: "relative" }}>
        {windowRows.map((observation, offset) => <RawRow key={observation.id} observation={observation} index={range.start + offset} selectedId={selectedId} onChoose={choose} />)}
      </div>}
    </div>
    </section>
    <ObservationDetail observation={selected} observations={observations} componentTitles={componentTitles}
      hidden={selected !== undefined && !filtered.some(item => item.id === selected.id)}
      onSelect={reveal} onShowTrace={showTrace} onUseText={useText} onUseEntity={useEntity} />
  </>;
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
      <span>{item.summary} <small>{item.observation.type}</small></span><span>t={item.observation.time} · #{item.observation.sequence}</span><span>{item.observation.source}{item.observation.target ? ` → ${item.observation.target}` : ""}</span>
    </button>;
    const open = expandedGroups.has(item.id) || item.observations.some(observation => observation.id === selectedId);
    const first = item.observations[0]!;
    const last = item.observations.at(-1)!;
    return <div key={item.id} className="learning-group">
      <button type="button" aria-expanded={open} aria-controls={`${item.id}-members`} onClick={() => onToggle(item.id)}>
        {open ? "Hide" : "Show"} {item.observations.length} records: {item.summary} (#{first.sequence}–#{last.sequence}, t={first.time}–{last.time})
      </button>
      {open ? <div id={`${item.id}-members`} className="learning-members">{item.observations.map(observation => <button key={observation.id} type="button"
        data-observation-id={observation.id} aria-pressed={observation.id === selectedId} onClick={() => onChoose(observation.id)}>
        <span>#{observation.sequence}</span><span>t={observation.time}</span><span>{observation.type}</span><span>{observation.id}</span>
      </button>)}</div> : null}
    </div>;
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
    <h3 id="observation-detail-heading">Observation detail</h3>
    {!observation ? <p>Select an observation to inspect its trace, causation, and stored data.</p> : <DetailBody
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
  return <>
    {hidden ? <p>This observation is hidden by the current filters.</p> : null}
    <dl>
      <dt>Observation</dt><dd><span>{observation.id}</span><CopyButton label="Copy observation id" value={observation.id} /></dd>
      <dt>Virtual time</dt><dd>{observation.time}</dd>
      <dt>Sequence</dt><dd>{observation.sequence}</dd>
      <dt>Type</dt><dd>{observation.type}</dd>
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
      {traceId !== undefined ? <><dt>Trace</dt><dd><span>{traceId}</span><CopyButton label="Copy trace id" value={traceId} /></dd></> : null}
      {observation.spanId !== undefined ? <><dt>Span</dt><dd>{observation.spanId}</dd></> : null}
      {observation.parentSpanId !== undefined ? <><dt>Parent span</dt><dd>{observation.parentSpanId}</dd></> : null}
      {observation.causationId !== undefined ? <><dt>Causation</dt><dd>{observation.causationId}</dd></> : null}
      {eventId !== undefined ? <><dt>Event</dt><dd><span>{eventId}</span><CopyButton label="Copy event id" value={eventId} /></dd></> : null}
      {entities.length > 0 ? <><dt>Entities</dt><dd>{entities.map(entity => `${entity.kind} ${entity.id}`).join(", ")}</dd></> : null}
    </dl>
    {eventId !== undefined || entities.length > 0 ? <div className="timeline-actions" role="group" aria-label="Filter from this observation">
      {eventId !== undefined ? <button type="button" onClick={() => onUseText("eventId", eventId)}>Use this event</button> : null}
      {entities.map((entity, index) => <button key={`${entity.kind}:${entity.id}:${index}`} type="button" onClick={() => onUseEntity(entity.kind, entity.id)}>Use entity {entity.kind} {entity.id}</button>)}
    </div> : null}
    <h4>Stored data</h4>
    <p>{payloadCopy(observation)}</p>
    {visibility === "redacted" ? <pre>{JSON.stringify(observation.data, null, 2)}</pre> : null}
    {visibility === "visible" ? <pre>{JSON.stringify(observation.data, null, 2)}</pre> : null}
    <h4>Before and after</h4>
    {evidence.length === 0 ? <p>No before or after values were stored.</p> : <ul className="change-evidence">
      {evidence.map((item, index) => <li key={`${item.label}:${index}`}>
        <p>{item.label}</p>
        {Object.hasOwn(item, "before") ? <><h5>Before</h5><pre>{JSON.stringify(item.before, null, 2)}</pre></> : <p>Before was not stored.</p>}
        {Object.hasOwn(item, "after") ? <><h5>After</h5><pre>{JSON.stringify(item.after, null, 2)}</pre></> : <p>After was not stored.</p>}
      </li>)}
    </ul>}
    <h4>Causation</h4>
    {links.cause ? <p><button type="button" aria-controls="timeline-rows" onClick={() => onSelect(links.cause!.id)}>Select causing observation {links.cause.type} at virtual time {links.cause.time}</button></p> : null}
    {links.unresolvedCauseId ? <p>Causation {links.unresolvedCauseId} is not in this history.</p> : null}
    {!links.cause && !links.unresolvedCauseId ? <p>No causation reference was stored.</p> : null}
    {links.effects.length > 0 ? <ul>{links.effects.slice(0, SPAN_PREVIEW).map(effect => <li key={effect.id}>
      <button type="button" aria-controls="timeline-rows" onClick={() => onSelect(effect.id)}>Select effect {effect.type} at virtual time {effect.time}</button>
    </li>)}{links.effects.length > SPAN_PREVIEW ? <li>{links.effects.length - SPAN_PREVIEW} more effects. Show this trace to read them in order.</li> : null}</ul> : <p>No later observation points at this record.</p>}
    <h4>Trace</h4>
    {traceId !== undefined ? <p><button type="button" aria-controls="timeline-rows" onClick={() => onShowTrace(traceId)}>Show this trace</button></p> : <p>This observation has no trace.</p>}
    {trace ? <>
      <SpanList nodes={trace.roots} selectedId={observation.id} onSelect={onSelect} />
      {trace.unspanned.length > 0 ? <div>
        <h5>Observations without a span</h5>
        <ul>{trace.unspanned.slice(0, SPAN_PREVIEW).map(item => <li key={item.id}>
          <button type="button" aria-controls="timeline-rows" onClick={() => onSelect(item.id)}>{item.type} at virtual time {item.time}</button>
        </li>)}{trace.unspanned.length > SPAN_PREVIEW ? <li>{trace.unspanned.length - SPAN_PREVIEW} more observations have no span.</li> : null}</ul>
      </div> : null}
      {trace.causation.some(item => !item.causeFound) ? <ul>{trace.causation.filter(item => !item.causeFound).map(item =>
        <li key={item.effectId}>Causation {item.causeId} is not in this history.</li>)}</ul> : null}
    </> : null}
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
