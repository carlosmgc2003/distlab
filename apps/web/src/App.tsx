import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

type PanelId = "architecture" | "timeline" | "inspection";

const panels = [
  ["architecture", "Architecture"],
  ["timeline", "Timeline"],
  ["inspection", "Inspection"],
] as const satisfies readonly (readonly [PanelId, string])[];

function useNarrowViewport(): boolean {
  const query = "(max-width: 959px)";
  return useSyncExternalStore(
    onStoreChange => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function App({ host }: { readonly host: SimulationHost }) {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const { projection, loading, pendingCommands } = snapshot;
  const busy = loading || pendingCommands.length > 0 || projection?.simulation.status === "RUNNING";
  const [selected, setSelected] = useState<string>(scenarios[0].id);
  const [loadedChoice, setLoadedChoice] = useState<PackagedScenario | null>(null);
  const [emphasis, setEmphasis] = useState<GraphEmphasis | undefined>(undefined);
  const [evidenceFocus, setEvidenceFocus] = useState<{ id: string; token: number } | null>(null);
  const [panel, setPanel] = useState<PanelId>("architecture");
  const panelRequest = useRef<PanelId | null>(null);
  const narrow = useNarrowViewport();
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
    : !projection ? "No lesson is loaded."
    : projection.simulation.status === "COMPLETED" ? "Run complete."
    : "Lesson ready.";
  const sessionKey = `${loadedChoice?.id ?? ""}:${snapshot.attempt}:${projection?.simulation.runId ?? ""}`;

  useEffect(() => { if (!projection) setEmphasis(undefined); }, [projection]);
  useEffect(() => { setEvidenceFocus(null); }, [sessionKey]);
  useEffect(() => {
    const requested = panelRequest.current;
    if (!requested) return;
    panelRequest.current = null;
    document.getElementById(`${requested}-panel`)?.focus();
  }, [panel]);

  const showPanel = (next: PanelId) => {
    panelRequest.current = next;
    setPanel(next);
  };
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

  return <main className="app-shell">
    <header className="command-toolbar">
      <div className="toolbar-row">
        <h1>DistLab</h1>
        <div className="scenario-picker">
          <label htmlFor="scenario">Scenario</label>
          <select id="scenario" value={selected} disabled={busy} aria-describedby="scenario-help" onChange={event => onScenario(event.target.value)}>
            {scenarios.map(choice => <option key={choice.id} value={choice.id}>{experimentLabel(choice)}</option>)}
          </select>
          <button disabled={busy} onClick={() => replaceSession(selected)}>Load scenario</button>
        </div>
      </div>
      <SimulationControls host={host} snapshot={snapshot} notices={<>
        {mark ? <p className="terminal-history" role="status" aria-label="Terminal history">{terminalCopy(mark)}</p> : null}
        <section className="lesson-guide" aria-labelledby="lesson-heading">
          <h2 id="lesson-heading" className="sr-only">Checkout lesson</h2>
          <p id="scenario-help" className="sr-only">Choose the normal checkout or the recorded response-lost rule. Changing the experiment after a session is loaded replaces the worker session and does not edit rules during a run.</p>
          <p role="status" aria-label="Lesson state" aria-live="polite">{lessonState}</p>
          <details>
            <summary>Lesson guide</summary>
            <p>Choose the normal checkout or the recorded response-lost rule. Changing the experiment after a session is loaded replaces the worker session and does not edit rules during a run.</p>
            <p>Load a checkout, inspect the four component categories and their links, then Run, Pause, or Step through the timeline. Select a row to follow request or message movement and inspect each component’s state.</p>
            <p>For the response-lost experiment, find the processor authorization, the dropped response, and the Payments timeout. What does Payments know, and what does the processor know? Does the timeout prove that payment failed?</p>
            <p>Reset and run again to compare the same virtual-time history.</p>
            <p>Step advances one scheduled event. Pause takes effect at an event boundary. Reset starts the loaded scenario again.</p>
          </details>
        </section>
        {projection && report ? <details className="raw-state">
          <summary>Raw state</summary>
          <div className="raw-state-body" tabIndex={0} aria-label="Distributed state details">
            <section className="execution" aria-labelledby="execution-heading">
              <h2 id="execution-heading" className="sr-only">Execution</h2>
              <dl>
                <dt>Virtual time</dt><dd>{projection.simulation.time}</dd>
                <dt>Pending events</dt><dd>{projection.simulation.pendingEvents}</dd>
                <dt>Processed events (boundary)</dt><dd>{projection.simulation.processedEvents}</dd>
                <dt>Random draws</dt><dd>{projection.simulation.randomDrawCount}</dd>
                <dt>Observations</dt><dd>{projection.history.observations.length}</dd>
              </dl>
              <DistributedState report={report} onShowEvidence={id => setEvidenceFocus(current => ({ id, token: (current?.token ?? 0) + 1 }))} />
            </section>
          </div>
        </details> : null}
      </>}>
        <p className="virtual-time">Virtual time {projection ? projection.simulation.time : "—"}</p>
        <nav className="panel-nav" aria-label="Investigation panels">
          {panels.map(([id, label]) => <button key={id} type="button" {...(projection ? { "aria-controls": `${id}-panel` } : {})}
            {...(narrow ? { "aria-pressed": panel === id } : {})} onClick={() => showPanel(id)}>{label}</button>)}
        </nav>
      </SimulationControls>
    </header>
    {projection ? <div className="investigation-workspace" data-panel={panel}>
      <section id="architecture-panel" className="panel-architecture" tabIndex={-1} aria-labelledby="architecture-heading">
        <h2 id="architecture-heading">Architecture</h2>
        <ArchitectureView architecture={projection.architecture}
          {...(lesson ? { metadata: lesson.architecture, scenarioName: lesson.name } : {})}
          {...(emphasis ? { emphasis, ...(emphasis.text !== undefined ? { movementText: emphasis.text } : {}) } : {})}
          {...(report ? { inspectorFacts: componentId => <ComponentRuntimeFacts report={report} componentId={componentId} /> } : {})} />
      </section>
      <div className="timeline-layout">
        <TimelineView key={`${loadedChoice?.id ?? "none"}:${snapshot.attempt}`} observations={projection.history.observations} edges={edges} componentTitles={componentTitles} onEmphasis={onEmphasis}
          {...(evidenceFocus ? { focusedObservationId: evidenceFocus.id, focusToken: evidenceFocus.token } : {})} />
      </div>
    </div> : <div className="investigation-workspace" data-panel={panel}>
      <p id="architecture-panel" className="workspace-empty" tabIndex={-1}>Load a checkout scenario to inspect the architecture and timeline.</p>
    </div>}
  </main>;
}
