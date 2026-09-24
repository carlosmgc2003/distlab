import { useEffect, useMemo, useRef, useState } from "react";
import type { Observation, ObservationFilter } from "@distlab/contracts";
import {
  TIMELINE_ROW_HEIGHT,
  TIMELINE_VIEWPORT,
  boundaryCopy,
  changeEvidence,
  continuesHistory,
  correlation,
  emphasisFor,
  emptyTimelineDraft,
  filterObservations,
  movementCue,
  movementMessage,
  parseTimelineFilter,
  payloadCopy,
  payloadVisibility,
  playbackAdvance,
  playbackControl,
  playbackStatus,
  revealMessage,
  revealObservation,
  selectionAvailability,
  selectionMessage,
  selectionStep,
  showTraceFilter,
  timelineDraftIsBlank,
  traceFilterMessage,
  traceView,
  visibleRowRange,
} from "./timeline.ts";
import type { GraphEmphasis, MovementEdge, PlaybackPhase, SpanNode, TimelineFilterDraft } from "./timeline.ts";

/** Host interval for the playback cursor only. It never calls the simulation host. */
const PLAYBACK_INTERVAL_MS = 1000;
const SPAN_PREVIEW = 12;

export function TimelineView({ observations, edges, onEmphasis, focusedObservationId, focusToken = 0 }: {
  readonly observations: readonly Observation[];
  readonly edges: readonly MovementEdge[];
  readonly onEmphasis: (emphasis: GraphEmphasis | undefined) => void;
  readonly focusedObservationId?: string;
  readonly focusToken?: number;
}) {
  const [draft, setDraft] = useState<TimelineFilterDraft>(emptyTimelineDraft);
  const [filter, setFilter] = useState<ObservationFilter>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<PlaybackPhase>("idle");
  const [feedback, setFeedback] = useState("");
  const [liveCueId, setLiveCueId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const pauseButtonRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef<readonly Observation[] | null>(null);
  const seenRef = useRef(-1);
  const pendingFocusId = useRef<string | null>(null);
  const playHadFocus = useRef(false);
  const returnFocusToPlay = useRef(false);
  const filtered = useMemo(() => filterObservations(observations, filter), [observations, filter]);
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
    if (focusedObservationId === undefined) return;
    const observation = observationsRef.current.find(item => item.id === focusedObservationId);
    setPhase(current => current === "idle" ? "idle" : "paused");
    if (!observation) {
      setFeedback("That observation is not in this history.");
      return;
    }
    const revealed = revealObservation(draftRef.current, observation);
    if (revealed.changed) {
      setDraft(revealed.draft);
      setFilter(revealed.filter);
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

  const filterKey = JSON.stringify(filter);
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
    const top = index * TIMELINE_ROW_HEIGHT;
    if (top < node.scrollTop || top + TIMELINE_ROW_HEIGHT > node.scrollTop + node.clientHeight) node.scrollTop = top;
    const row = node.querySelector<HTMLButtonElement>(`[data-observation-id="${CSS.escape(id)}"]`);
    if (!row) return;
    pendingFocusId.current = null;
    row.focus({ preventScroll: true });
    node.scrollIntoView({ block: "start", inline: "nearest" });
  }, [filtered, focusNonce, scrollTop]);

  const applyDraft = (next: TimelineFilterDraft) => {
    setDraft(next);
    const parsed = parseTimelineFilter(next);
    if (parsed.ok) { setFilter(parsed.filter); setFilterError(null); }
    else setFilterError(parsed.message);
  };
  const update = (key: keyof TimelineFilterDraft, value: string) => applyDraft({ ...draft, [key]: value });
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
    const revealed = revealObservation(draft, observation);
    if (revealed.changed) {
      setDraft(revealed.draft);
      setFilter(revealed.filter);
      setFilterError(null);
    }
    setSelectedId(observation.id);
    setFeedback(revealMessage(revealed.cleared, observation));
    requestFocus(observation.id);
  };
  const showTrace = (traceId: string) => {
    const change = showTraceFilter(draft, traceId);
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
  const range = visibleRowRange(filtered.length, scrollTop, TIMELINE_VIEWPORT, TIMELINE_ROW_HEIGHT);
  const windowRows = filtered.slice(range.start, range.end);

  return <>
    <p id="timeline-order">Rows follow observation sequence. Virtual time is the simulation clock, not wall-clock time. Equal virtual times keep that sequence.</p>
    <form className="timeline-filters" aria-label="Timeline filters" onSubmit={event => event.preventDefault()}>
      <label>Virtual time from<input inputMode="numeric" value={draft.fromTime} onChange={event => update("fromTime", event.target.value)} /></label>
      <label>Virtual time to<input inputMode="numeric" value={draft.toTime} onChange={event => update("toTime", event.target.value)} /></label>
      <label>Type<input value={draft.type} onChange={event => update("type", event.target.value)} /></label>
      <label>Component<input value={draft.component} onChange={event => update("component", event.target.value)} /></label>
      <label>Trace<input value={draft.traceId} onChange={event => update("traceId", event.target.value)} /></label>
      <label>Event<input value={draft.eventId} onChange={event => update("eventId", event.target.value)} /></label>
      <label>Entity kind<input value={draft.entityKind} onChange={event => update("entityKind", event.target.value)} /></label>
      <label>Entity id<input value={draft.entityId} onChange={event => update("entityId", event.target.value)} /></label>
      <button type="button" disabled={timelineDraftIsBlank(draft)} onClick={() => applyDraft(emptyTimelineDraft)}>Clear filters</button>
    </form>
    {filterError ? <p role="alert">{filterError}</p> : null}
    <p className="timeline-count">{filtered.length} of {observations.length} observations in virtual-time order.</p>
    <p id="timeline-boundary" className="timeline-boundary">{boundaryCopy(selectedIndex, filtered.length)}</p>
    <div className="control-buttons timeline-transport" role="group" aria-label="Timeline playback">
      <button ref={playButtonRef} type="button" aria-pressed={playing} disabled={transport.action === "unavailable"} aria-describedby="timeline-playback" onClick={play}>{transport.label}</button>
      <button ref={pauseButtonRef} type="button" disabled={!playing} aria-describedby="timeline-playback" onClick={pause}>Pause timeline</button>
      <button type="button" disabled={!availability.previous} aria-describedby="timeline-boundary" onClick={() => move(-1)}>Previous observation</button>
      <button type="button" disabled={!availability.next} aria-describedby="timeline-boundary" onClick={() => move(1)}>Next observation</button>
    </div>
    <p id="timeline-playback" className="timeline-playback">{playbackStatus(phase, transport)}</p>
    <p id="timeline-feedback" className="timeline-feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
    <div id="timeline-rows" ref={scrollerRef} className="timeline-rows" tabIndex={0} aria-describedby="timeline-order"
      aria-label="Timeline observations" onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
        else if (event.key === "Home") {
          event.preventDefault();
          if (filtered.length === 0) setFeedback(boundaryCopy(-1, 0));
          else if (selectedIndex === 0) setFeedback(boundaryCopy(0, filtered.length));
          else selectIndex(0);
        } else if (event.key === "End") {
          event.preventDefault();
          const last = filtered.length - 1;
          if (last < 0) setFeedback(boundaryCopy(-1, 0));
          else if (selectedIndex === last) setFeedback(boundaryCopy(last, filtered.length));
          else selectIndex(last);
        }
      }}>
      {filtered.length === 0 ? <p className="timeline-empty">{observations.length === 0 ? "No observations have been recorded for this run." : "No observations match these filters."}</p> : null}
      <div style={{ height: filtered.length * TIMELINE_ROW_HEIGHT, position: "relative" }}>
        {windowRows.map((observation, offset) => {
          const index = range.start + offset;
          const path = observation.target ? `${observation.source} → ${observation.target}` : observation.source;
          return <button key={observation.id} type="button" data-observation-id={observation.id} aria-pressed={observation.id === selectedId}
            style={{ position: "absolute", top: index * TIMELINE_ROW_HEIGHT, height: TIMELINE_ROW_HEIGHT, left: 0, right: 0 }}
            onClick={() => choose(observation.id)}>
            <span>t={observation.time}</span>
            <span>#{observation.sequence}</span>
            <span>{observation.type}</span>
            <span>{path}</span>
          </button>;
        })}
      </div>
    </div>
    <ObservationDetail observation={selected} observations={observations} hidden={selected !== undefined && !filtered.some(item => item.id === selected.id)}
      onSelect={reveal} onShowTrace={showTrace} />
  </>;
}

function ObservationDetail({ observation, observations, hidden, onSelect, onShowTrace }: {
  readonly observation: Observation | undefined;
  readonly observations: readonly Observation[];
  readonly hidden: boolean;
  readonly onSelect: (id: string) => void;
  readonly onShowTrace: (traceId: string) => void;
}) {
  return <section className="timeline-detail" aria-labelledby="observation-detail-heading">
    <h3 id="observation-detail-heading">Observation detail</h3>
    {!observation ? <p>Select an observation to inspect its trace, causation, and stored data.</p> : <DetailBody
      observation={observation} observations={observations} hidden={hidden} onSelect={onSelect} onShowTrace={onShowTrace} />}
  </section>;
}

function DetailBody({ observation, observations, hidden, onSelect, onShowTrace }: {
  readonly observation: Observation;
  readonly observations: readonly Observation[];
  readonly hidden: boolean;
  readonly onSelect: (id: string) => void;
  readonly onShowTrace: (traceId: string) => void;
}) {
  const links = correlation(observations, observation);
  const evidence = changeEvidence(observation);
  const visibility = payloadVisibility(observation);
  const trace = observation.traceId !== undefined ? traceView(observations, observation.traceId) : undefined;
  return <>
    {hidden ? <p>This observation is hidden by the current filters.</p> : null}
    <dl>
      <dt>Virtual time</dt><dd>{observation.time}</dd>
      <dt>Sequence</dt><dd>{observation.sequence}</dd>
      <dt>Type</dt><dd>{observation.type}</dd>
      <dt>Source</dt><dd>{observation.source}</dd>
      {observation.target !== undefined ? <><dt>Target</dt><dd>{observation.target}</dd></> : null}
      {observation.traceId !== undefined ? <><dt>Trace</dt><dd>{observation.traceId}</dd></> : null}
      {observation.spanId !== undefined ? <><dt>Span</dt><dd>{observation.spanId}</dd></> : null}
      {observation.parentSpanId !== undefined ? <><dt>Parent span</dt><dd>{observation.parentSpanId}</dd></> : null}
      {observation.causationId !== undefined ? <><dt>Causation</dt><dd>{observation.causationId}</dd></> : null}
      {observation.eventId !== undefined ? <><dt>Event</dt><dd>{observation.eventId}</dd></> : null}
    </dl>
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
    {observation.traceId ? <p><button type="button" aria-controls="timeline-rows" onClick={() => onShowTrace(observation.traceId!)}>Show this trace</button></p> : <p>This observation has no trace.</p>}
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
