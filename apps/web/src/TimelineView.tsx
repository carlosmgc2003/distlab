import { useEffect, useMemo, useRef, useState } from "react";
import type { Observation, ObservationFilter } from "@distlab/contracts";
import {
  TIMELINE_ROW_HEIGHT,
  TIMELINE_VIEWPORT,
  changeEvidence,
  continuesHistory,
  correlation,
  emphasisFor,
  filterObservations,
  movementCue,
  parseTimelineFilter,
  payloadCopy,
  payloadVisibility,
  playbackAdvance,
  traceView,
  visibleRowRange,
} from "./timeline.ts";
import type { GraphEmphasis, MovementEdge, SpanNode } from "./timeline.ts";

/** Host interval for the playback cursor only. It never calls the simulation host. */
const PLAYBACK_INTERVAL_MS = 1000;
const SPAN_PREVIEW = 12;

const emptyDraft = {
  fromTime: "", toTime: "", type: "", component: "", traceId: "", eventId: "", entityKind: "", entityId: "",
};

type Draft = typeof emptyDraft;

export function TimelineView({ observations, edges, onEmphasis, focusedObservationId, focusToken = 0 }: {
  readonly observations: readonly Observation[];
  readonly edges: readonly MovementEdge[];
  readonly onEmphasis: (emphasis: GraphEmphasis | undefined) => void;
  readonly focusedObservationId?: string;
  readonly focusToken?: number;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [filter, setFilter] = useState<ObservationFilter>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [liveCueId, setLiveCueId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<readonly Observation[] | null>(null);
  const seenRef = useRef(-1);
  const filtered = useMemo(() => filterObservations(observations, filter), [observations, filter]);
  const filteredRef = useRef(filtered);
  const selectedRef = useRef(selectedId);
  filteredRef.current = filtered;
  selectedRef.current = selectedId;
  const selected = observations.find(item => item.id === selectedId);
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

  useEffect(() => { onEmphasis(emphasis); }, [emphasis, onEmphasis]);

  useEffect(() => {
    if (focusedObservationId === undefined) return;
    setPlaying(false);
    setFilter({});
    setDraft(emptyDraft);
    setFilterError(null);
    setSelectedId(focusedObservationId);
    scrollerRef.current?.scrollIntoView({ block: "nearest" });
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
      setPlaying(false);
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
      const index = list.findIndex(item => item.id === selectedRef.current);
      const step = playbackAdvance(index, list.length);
      const next = list[step.cursor];
      if (!step.playing) setPlaying(false);
      if (next) setSelectedId(next.id);
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  const filterKey = JSON.stringify(filter);
  useEffect(() => {
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

  const applyDraft = (next: Draft) => {
    setDraft(next);
    const parsed = parseTimelineFilter(next);
    if (parsed.ok) { setFilter(parsed.filter); setFilterError(null); }
    else setFilterError(parsed.message);
  };
  const update = (key: keyof Draft, value: string) => applyDraft({ ...draft, [key]: value });
  const choose = (id: string) => { setPlaying(false); setSelectedId(id); };
  const move = (delta: number) => {
    setPlaying(false);
    if (!filtered.length) return;
    const index = filtered.findIndex(item => item.id === selectedId);
    const nextIndex = index < 0 ? (delta < 0 ? filtered.length - 1 : 0) : Math.min(filtered.length - 1, Math.max(0, index + delta));
    const row = filtered[nextIndex];
    if (row) setSelectedId(row.id);
  };
  const play = () => {
    if (playing || filtered.length === 0) return;
    const index = filtered.findIndex(item => item.id === selectedId);
    if (index < 0 || index >= filtered.length - 1) setSelectedId(filtered[0]!.id);
    setPlaying(filtered.length > 1);
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
      <button type="button" onClick={() => applyDraft(emptyDraft)}>Clear filters</button>
    </form>
    {filterError ? <p role="alert">{filterError}</p> : null}
    <p className="timeline-count">{filtered.length} of {observations.length} observations in virtual-time order.</p>
    <div className="control-buttons" role="group" aria-label="Timeline playback">
      <button type="button" aria-pressed={playing} disabled={filtered.length === 0} onClick={play}>Play timeline</button>
      <button type="button" disabled={!playing} onClick={() => setPlaying(false)}>Pause timeline</button>
      <button type="button" disabled={filtered.length === 0} onClick={() => move(-1)}>Previous observation</button>
      <button type="button" disabled={filtered.length === 0} onClick={() => move(1)}>Next observation</button>
    </div>
    <div id="timeline-rows" ref={scrollerRef} className="timeline-rows" tabIndex={0} aria-describedby="timeline-order"
      aria-label="Timeline observations" onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
        else if (event.key === "Home") { event.preventDefault(); setPlaying(false); const first = filtered[0]; if (first) setSelectedId(first.id); }
        else if (event.key === "End") { event.preventDefault(); setPlaying(false); const last = filtered.at(-1); if (last) setSelectedId(last.id); }
      }}>
      {filtered.length === 0 ? <p className="timeline-empty">{observations.length === 0 ? "No observations have been recorded for this run." : "No observations match these filters."}</p> : null}
      <div style={{ height: filtered.length * TIMELINE_ROW_HEIGHT, position: "relative" }}>
        {windowRows.map((observation, offset) => {
          const index = range.start + offset;
          const path = observation.target ? `${observation.source} → ${observation.target}` : observation.source;
          return <button key={observation.id} type="button" aria-pressed={observation.id === selectedId}
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
      onSelect={choose} onShowTrace={traceId => applyDraft({ ...emptyDraft, traceId })} />
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
    {links.cause ? <p><button type="button" onClick={() => onSelect(links.cause!.id)}>Select causing observation {links.cause.type} at virtual time {links.cause.time}</button></p> : null}
    {links.unresolvedCauseId ? <p>Causation {links.unresolvedCauseId} is not in this history.</p> : null}
    {!links.cause && !links.unresolvedCauseId ? <p>No causation reference was stored.</p> : null}
    {links.effects.length > 0 ? <ul>{links.effects.slice(0, SPAN_PREVIEW).map(effect => <li key={effect.id}>
      <button type="button" onClick={() => onSelect(effect.id)}>Select effect {effect.type} at virtual time {effect.time}</button>
    </li>)}{links.effects.length > SPAN_PREVIEW ? <li>{links.effects.length - SPAN_PREVIEW} more effects. Show this trace to read them in order.</li> : null}</ul> : <p>No later observation points at this record.</p>}
    <h4>Trace</h4>
    {observation.traceId ? <p><button type="button" onClick={() => onShowTrace(observation.traceId!)}>Show this trace</button></p> : <p>This observation has no trace.</p>}
    {trace ? <>
      <SpanList nodes={trace.roots} selectedId={observation.id} onSelect={onSelect} />
      {trace.unspanned.length > 0 ? <div>
        <h5>Observations without a span</h5>
        <ul>{trace.unspanned.slice(0, SPAN_PREVIEW).map(item => <li key={item.id}>
          <button type="button" onClick={() => onSelect(item.id)}>{item.type} at virtual time {item.time}</button>
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
        <button type="button" onClick={() => onSelect(item.id)}>{item.type} at virtual time {item.time}</button>
      </li>)}</ul>
      {hidden > 0 ? <p>{hidden} more observations in this span. Show this trace to read them in order.</p> : null}
      <SpanList nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
    </li>;
  })}{nodes.length > shown.length ? <li>{nodes.length - shown.length} more spans. Use the trace filter to inspect their observations in order.</li> : null}</ul>;
}
