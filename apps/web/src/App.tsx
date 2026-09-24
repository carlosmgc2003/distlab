import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ArchitectureView } from "./ArchitectureView.tsx";
import { movementEdges, mapArchitecture } from "./architecture-view.ts";
import { ComponentRuntimeFacts, DistributedState } from "./FaultInspectionView.tsx";
import { inspectFaults } from "./fault-inspection.ts";
import { SimulationControls } from "./SimulationControls.tsx";
import { TimelineView } from "./TimelineView.tsx";
import type { PackagedScenario } from "./scenarios.ts";
import type { SimulationHost } from "./host.ts";
import { experimentLabel, packagedMetadata, scenarios } from "./scenarios.ts";
import { terminalCopy, terminalMark } from "./timeline.ts";
import type { GraphEmphasis } from "./timeline.ts";

export function App({ host }: { readonly host: SimulationHost }) {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const { projection, loading, pendingCommands } = snapshot;
  const busy = loading || pendingCommands.length > 0 || projection?.simulation.status === "RUNNING";
  const [selected, setSelected] = useState<string>(scenarios[0].id);
  const [loadedChoice, setLoadedChoice] = useState<PackagedScenario | null>(null);
  const [emphasis, setEmphasis] = useState<GraphEmphasis | undefined>(undefined);
  const [evidenceFocus, setEvidenceFocus] = useState<{ id: string; token: number } | null>(null);
  const onEmphasis = useCallback((value: GraphEmphasis | undefined) => { setEmphasis(value); }, []);
  const lesson = useMemo(() => loadedChoice ? packagedMetadata(loadedChoice) : undefined, [loadedChoice]);
  const report = useMemo(() => projection && lesson ? inspectFaults(projection, lesson) : null, [projection, lesson]);
  const edges = useMemo(() => projection && lesson
    ? movementEdges(mapArchitecture(projection.architecture, lesson.architecture, lesson.name).edges) : [], [projection, lesson]);
  const mark = terminalMark(projection?.simulation.status, snapshot.error);
  const sessionKey = `${loadedChoice?.id ?? ""}:${snapshot.attempt}:${projection?.simulation.runId ?? ""}`;

  useEffect(() => { if (!projection) setEmphasis(undefined); }, [projection]);
  useEffect(() => { setEvidenceFocus(null); }, [sessionKey]);

  const replaceSession = (id: string) => {
    if (busy) return;
    const choice = scenarios.find(item => item.id === id);
    if (!choice) return;
    setSelected(choice.id);
    setLoadedChoice(choice);
    setEvidenceFocus(null);
    // The host publishes structured failures; the event handler owns no simulation state.
    void host.load(choice.scenario).catch(() => {});
  };
  const onScenario = (id: string) => {
    if (busy) return;
    if (projection || snapshot.error) replaceSession(id);
    else setSelected(id);
  };

  return <main>
    <h1>DistLab</h1>
    <div className="scenario-picker">
      <label htmlFor="scenario">Scenario</label>
      <select id="scenario" value={selected} disabled={busy} aria-describedby="scenario-help" onChange={event => onScenario(event.target.value)}>
        {scenarios.map(choice => <option key={choice.id} value={choice.id}>{experimentLabel(choice)}</option>)}
      </select>
      <button disabled={busy} onClick={() => replaceSession(selected)}>Load scenario</button>
    </div>
    <p id="scenario-help" className="scenario-help">Choose the normal checkout or the recorded response-lost rule. Changing the experiment after a session is loaded replaces the worker session and does not edit rules during a run.</p>
    <SimulationControls host={host} snapshot={snapshot} />
    {projection ? <>
      <section aria-labelledby="architecture-heading">
        <h2 id="architecture-heading">Architecture</h2>
        <ArchitectureView architecture={projection.architecture}
          {...(lesson ? { metadata: lesson.architecture, scenarioName: lesson.name } : {})}
          {...(emphasis ? { emphasis, ...(emphasis.text !== undefined ? { movementText: emphasis.text } : {}) } : {})}
          {...(report ? { inspectorFacts: componentId => <ComponentRuntimeFacts report={report} componentId={componentId} /> } : {})} />
      </section>
      <section className="execution" aria-labelledby="execution-heading">
        <h2 id="execution-heading">Execution</h2>
        <dl>
          <dt>Virtual time</dt><dd>{projection.simulation.time}</dd>
          <dt>Pending events</dt><dd>{projection.simulation.pendingEvents}</dd>
          <dt>Processed events (boundary)</dt><dd>{projection.simulation.processedEvents}</dd>
          <dt>Random draws</dt><dd>{projection.simulation.randomDrawCount}</dd>
          <dt>Observations</dt><dd>{projection.history.observations.length}</dd>
        </dl>
        {mark ? <p className="terminal-history" role="status" aria-label="Terminal history">{terminalCopy(mark)}</p> : null}
        {report ? <DistributedState report={report} onShowEvidence={id => setEvidenceFocus(current => ({ id, token: (current?.token ?? 0) + 1 }))} /> : null}
        <h3 id="timeline-heading">Timeline</h3>
        <TimelineView key={`${lesson?.name ?? "none"}:${snapshot.attempt}`} observations={projection.history.observations} edges={edges} onEmphasis={onEmphasis}
          {...(evidenceFocus ? { focusedObservationId: evidenceFocus.id, focusToken: evidenceFocus.token } : {})} />
      </section>
    </> : mark ? <p className="terminal-history" role="status" aria-label="Terminal history">{terminalCopy(mark)}</p> : null}
  </main>;
}
