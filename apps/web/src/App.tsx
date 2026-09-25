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
  const graph = useMemo(() => projection && lesson
    ? mapArchitecture(projection.architecture, lesson.architecture, lesson.name) : null, [projection, lesson]);
  const edges = useMemo(() => graph ? movementEdges(graph.edges) : [], [graph]);
  const componentTitles = useMemo(() => graph ? graph.nodes.map(node => ({ id: node.id, title: node.data.title })) : [], [graph]);
  const mark = terminalMark(projection?.simulation.status, snapshot.error);
  const lessonState = loading ? "Loading the checkout lesson…"
    : snapshot.error?.code === "SIMULATION_FAILED" ? "The run failed. Inspect the error, then Reset to try again."
    : snapshot.error ? "The lesson could not be opened. Choose a scenario and load it again."
    : !projection ? "No lesson is loaded. Choose a checkout experiment to begin."
    : projection.simulation.status === "COMPLETED" ? "Run complete. Compare Payments with the processor, then Reset and run again."
    : "Lesson ready. Follow the request from Customer App through Orders, MessageBus, Payments, and the processor.";
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
    <section className="lesson-guide" aria-labelledby="lesson-heading">
      <h2 id="lesson-heading">Checkout lesson</h2>
      <p>Load a checkout, inspect the four component categories and their links, then Run, Pause, or Step through the timeline. Select a row to follow request or message movement and inspect each component’s state.</p>
      <p>For the response-lost experiment, find the processor authorization, the dropped response, and the Payments timeout. What does Payments know, and what does the processor know? Does the timeout prove that payment failed?</p>
      <p>Reset and run again to compare the same virtual-time history.</p>
      <p role="status" aria-label="Lesson state" aria-live="polite">{lessonState}</p>
    </section>
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
        <TimelineView key={`${lesson?.name ?? "none"}:${snapshot.attempt}`} observations={projection.history.observations} edges={edges} componentTitles={componentTitles} onEmphasis={onEmphasis}
          {...(evidenceFocus ? { focusedObservationId: evidenceFocus.id, focusToken: evidenceFocus.token } : {})} />
      </section>
    </> : mark ? <p className="terminal-history" role="status" aria-label="Terminal history">{terminalCopy(mark)}</p> : null}
  </main>;
}
