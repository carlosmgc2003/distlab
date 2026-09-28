import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CommerceFacts, CommerceState } from "./CommerceLesson.tsx";
import { ArchitectureView } from "./ArchitectureView.tsx";
import { movementEdges, mapArchitecture } from "./architecture-view.ts";
import { FlightControls } from "./ArchitecturePlayback.tsx";
import { useFlightPlayback } from "./flight-playback.ts";
import { ComponentRuntimeFacts, DistributedState } from "./FaultInspectionView.tsx";
import { inspectFaults } from "./fault-inspection.ts";
import { SimulationControls } from "./SimulationControls.tsx";
import { TimelineView } from "./TimelineView.tsx";
import type { PackagedScenario } from "./scenarios.ts";
import type { SimulationHost } from "./host.ts";
import { experimentLabel, packagedMetadata, scenarios } from "./scenarios.ts";
import { terminalCopy, terminalMark } from "./timeline.ts";
import type { GraphEmphasis } from "./timeline.ts";

type WorkspaceTab = "architecture" | "history";

const tabs = [
  ["architecture", "Architecture"],
  ["history", "Recorded history"],
] as const satisfies readonly (readonly [WorkspaceTab, string])[];

export function App({ host }: { readonly host: SimulationHost }) {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const { projection, loading, pendingCommands } = snapshot;
  const busy = loading || pendingCommands.length > 0 || projection?.simulation.status === "RUNNING";
  const [selected, setSelected] = useState<string>(scenarios[0].id);
  const [loadedChoice, setLoadedChoice] = useState<PackagedScenario | null>(null);
  const [emphasis, setEmphasis] = useState<GraphEmphasis | undefined>(undefined);
  const [evidenceFocus, setEvidenceFocus] = useState<{ id: string; token: number } | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("architecture");
  const [showHistoryControls, setShowHistoryControls] = useState(false);
  const tabRequest = useRef<{ tab: WorkspaceTab; focusPanel: boolean } | null>(null);
  const onEmphasis = useCallback((value: GraphEmphasis | undefined) => { setEmphasis(value); }, []);
  const lesson = useMemo(() => loadedChoice ? packagedMetadata(loadedChoice) : undefined, [loadedChoice]);
  const commerce = loadedChoice?.family === "commerce";
  const report = useMemo(() => projection && lesson && !commerce ? inspectFaults(projection, lesson) : null, [projection, lesson, commerce]);
  const graph = useMemo(() => projection && lesson
    ? mapArchitecture(projection.architecture, lesson.architecture, lesson.name) : null, [projection, lesson]);
  const edges = useMemo(() => graph ? movementEdges(graph.edges) : [], [graph]);
  const componentTitles = useMemo(() => graph ? graph.nodes.map(node => ({ id: node.id, title: node.data.title })) : [], [graph]);
  // Replay state lives in the shell, so the cursor and the narration survive a tab switch.
  // Choosing a record in Recorded history takes the graph highlight back, so the cursor stands
  // down. A record that travels no link has no pulse id, so its movement text is the fallback
  // identity; a live cue never takes the highlight back.
  const release = emphasis?.origin === "selection" ? emphasis.pulseId ?? emphasis.text : undefined;
  const playback = useFlightPlayback(projection?.history.observations ?? [], edges,
    snapshot.pendingCommands.includes("run") || projection?.simulation.status === "RUNNING", release);
  const mark = terminalMark(projection?.simulation.status, snapshot.error);
  // The lesson line names the loaded experiment. The run status itself is announced once, by the
  // committed-state summary, so this region never restates it.
  const lessonState = loading ? "Loading the lesson…"
    : snapshot.error?.code === "SIMULATION_FAILED" ? "The run failed. Inspect the error, then Reset to try again."
    : snapshot.error ? "The lesson could not be opened. Choose a scenario and load it again."
    : !projection ? "No lesson is loaded."
    : `Lesson ready: ${loadedChoice ? experimentLabel(loadedChoice) : "checkout"}.`;
  const sessionKey = `${loadedChoice?.id ?? ""}:${snapshot.attempt}:${projection?.simulation.runId ?? ""}`;

  useEffect(() => { if (!projection) setEmphasis(undefined); }, [projection]);
  useEffect(() => { setEvidenceFocus(null); }, [sessionKey]);
  useEffect(() => {
    const requested = tabRequest.current;
    if (!requested) return;
    tabRequest.current = null;
    if (!requested.focusPanel) return;
    document.getElementById(requested.tab === "architecture" ? "architecture-panel" : "history-panel")?.focus();
  }, [tab]);

  const showTab = (next: WorkspaceTab, focusPanel = true) => {
    tabRequest.current = { tab: next, focusPanel };
    setTab(next);
  };
  const showEvidence = (id: string) => {
    // Evidence links target a record: activate the Recorded history tab, select the
    // target record, and let the timeline move focus to the selected row.
    tabRequest.current = { tab: "history", focusPanel: false };
    setTab("history");
    setEvidenceFocus(current => ({ id, token: (current?.token ?? 0) + 1 }));
  };
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const order: WorkspaceTab[] = ["architecture", "history"];
    const current = order.indexOf(tab);
    let next: WorkspaceTab = tab;
    if (event.key === "ArrowRight") next = order[(current + 1) % order.length]!;
    else if (event.key === "ArrowLeft") next = order[(current - 1 + order.length) % order.length]!;
    else if (event.key === "Home") next = "architecture";
    else if (event.key === "End") next = "history";
    // Arrow navigation activates the tab but keeps focus on the tab itself;
    // only direct activation moves focus into the panel.
    showTab(next, false);
    document.getElementById(next === "architecture" ? "tab-architecture" : "tab-history")?.focus();
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

  return <main className={`app-shell${tab === "history" && projection && !showHistoryControls ? " history-focus" : ""}`}>
    {tab === "history" && projection && !showHistoryControls ? <h1 className="sr-only">DistLab · Recorded history</h1> : null}
    <header className="command-toolbar">
      <div className="toolbar-row">
        <div className="brand"><h1>DistLab</h1><span>Distributed systems, explained</span></div>
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
        <details className="lesson-drawer">
        <summary>Lesson guide & run insights</summary>
        <div className="shell-notices">
        <section className="lesson-guide" aria-labelledby="lesson-heading">
          <h2 id="lesson-heading" className="sr-only">{commerce ? "Commerce lesson" : "Checkout lesson"}</h2>
          <p id="scenario-help" className="sr-only">Choose a checkout or commerce failure/resilience lesson. Changing the experiment after a session is loaded replaces the worker session and does not edit rules during a run.</p>
          <p role="status" aria-label="Lesson state" aria-live="polite">{lessonState}</p>
          {projection && report ? <details className="execution-overview">
            <summary>Run overview</summary>
            <div className="execution-overview-body">
            <p><strong>{loadedChoice?.id === "response-lost" ? "Lost processor response" : "Normal checkout"}</strong> — {projection.simulation.status === "COMPLETED" ? "Execution completed; business outcome is shown from recorded state." : projection.simulation.status === "FAILED" ? "Execution failed." : projection.simulation.status === "RUNNING" ? "Execution in progress." : "Execution partial or ready."}</p>
            <p>{report.knowledge}</p>
            <p>Recorded delivery attempts: {report.deliveries.length ? report.deliveries.map(item => `${item.destination}: attempt ${item.attempt} (${item.state})`).join("; ") : "Unavailable — no student-visible delivery records."}</p>
            <p>Operation duration: unavailable — this projection does not provide authorized start/end boundaries. Scenario virtual end time is not operation latency; browser playback speed is not simulated performance.</p>
            <div className="evidence-links">{report.evidence.map(item => <button key={item.observationId} type="button" onClick={() => showEvidence(item.observationId)}>{item.label}</button>)}</div>
            <p>Investigate: Which record proves authorization? What does Payments know after the timeout? A timeout does not prove that authorization was undone.</p>
            </div>
          </details> : null}
          <details>
            <summary>Lesson guide</summary>
            {commerce ? <><p>{loadedChoice.description}</p><p>Seed: {lesson?.seed}. Observe the service state and lesson checks in Architecture, then use Recorded history to follow database commits, faults, messages, and runtime logs.</p></> : <>
            <p>Objective: follow a checkout request and compare the customer-facing result with the processor’s recorded state. Changing the experiment after a session is loaded replaces the worker session and does not edit rules during a run.</p>
            {loadedChoice ? <p>Scenario details: {report?.scenarioName}; seed {report?.seed}; version and fault rule are available in the recorded scenario definition.</p> : null}
            <p>Load a checkout, inspect the four component categories and their links, then Run, Pause, or Step through the timeline. Select a row to follow request or message movement and inspect each component’s state.</p>
            <p>For the response-lost experiment, find the processor authorization, the dropped response, and the Payments timeout. What does Payments know, and what does the processor know? Does the timeout prove that payment failed?</p>
            </>}
            <p>Reset and run again to compare the same virtual-time history.</p>
            <p>Step advances one scheduled event. Pause takes effect at an event boundary. Reset starts the loaded scenario again.</p>
          </details>
        </section>
        {/* Engine counters stay here; the committed run summary above carries status and virtual time. */}
        {projection && report ? <details className="raw-state">
          <summary>Advanced diagnostics</summary>
          <div className="raw-state-body" tabIndex={0} aria-label="Distributed state details">
            <dl className="diagnostics">
              <dt>Random draws</dt><dd>{projection.simulation.randomDrawCount}</dd>
              <dt>Observations</dt><dd>{projection.history.observations.length}</dd>
            </dl>
            <DistributedState report={report} onShowEvidence={showEvidence} />
          </div>
        </details> : null}
        </div>
        </details>
      </>}>
        {/* Recorded history navigation shares the command row, kept apart by its own rule and label. */}
        {tab === "architecture" && projection ? <FlightControls playback={playback} /> : null}
      </SimulationControls>
    </header>
    {projection ? <div className="investigation-workspace">
      <aside className="learning-prompt" aria-label="Learning objective">
        <strong>{commerce ? loadedChoice.title : loadedChoice?.id === "response-lost" ? "Does a timeout mean the payment failed?" : "How does a checkout travel through a distributed system?"}</strong>
        <span>{commerce ? loadedChoice.description : "Explore the architecture, run the scenario, then follow its recorded story."}</span>
        {commerce && loadedChoice.compare ? <button type="button" disabled={busy} onClick={() => replaceSession(loadedChoice.compare)}>Compare: {scenarios.find(choice => choice.id === loadedChoice.compare)?.title}</button> : null}
      </aside>
      <div className="workspace-navigation">
      <div className="workspace-tabs" role="tablist" aria-label="Investigation workspace" onKeyDown={onTabKeyDown}>
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab"
          id={id === "architecture" ? "tab-architecture" : "tab-history"}
          aria-selected={tab === id} aria-controls={id === "architecture" ? "architecture-panel" : "history-panel"}
          tabIndex={tab === id ? 0 : -1}
          className={tab === id ? "is-active" : undefined}
          onClick={() => showTab(id)}>{label}</button>)}
      </div>
      {tab === "history" ? <button type="button" className="history-controls-toggle" aria-expanded={showHistoryControls}
        onClick={() => setShowHistoryControls(current => !current)}>{showHistoryControls ? "Hide simulation controls" : "Show simulation controls"}</button> : null}
      </div>
      <section id="architecture-panel" className="panel-architecture" role="tabpanel" tabIndex={-1}
        aria-labelledby="tab-architecture" hidden={tab !== "architecture"}>
        <ArchitectureView architecture={projection.architecture} sessionKey={`${loadedChoice?.id ?? "none"}:${snapshot.attempt}`} playback={playback}
          {...(lesson ? { metadata: lesson.architecture, scenarioName: lesson.name } : {})}
          {...(emphasis ? { emphasis, ...(emphasis.text !== undefined ? { movementText: emphasis.text } : {}) } : {})}
          {...(commerce ? { inspectorFacts: (componentId: string) => <CommerceFacts projection={projection} componentId={componentId} /> } : report ? { inspectorFacts: (componentId: string) => <ComponentRuntimeFacts report={report} componentId={componentId} /> } : {})} />
        {commerce ? <CommerceState projection={projection} /> : null}
      </section>
      <div id="history-panel" className="panel-history" role="tabpanel" tabIndex={-1}
        aria-labelledby="tab-history" hidden={tab !== "history"}>
        <TimelineView key={`${loadedChoice?.id ?? "none"}:${snapshot.attempt}`} observations={projection.history.observations} edges={edges} componentTitles={componentTitles} onEmphasis={onEmphasis}
          {...(evidenceFocus ? { focusedObservationId: evidenceFocus.id, focusToken: evidenceFocus.token } : {})} />
      </div>
    </div> : <div className="investigation-workspace">
      <section className="workspace-empty" tabIndex={-1}>
        <p className="eyebrow">A small system. A big question.</p>
        <h2>What happens between checkout and payment?</h2>
        <p>Follow requests between services, discover what each component knows, and compare a successful checkout with a lost response.</p>
        <ol><li>Choose and load a scenario above.</li><li>Explore the system and run the simulation.</li><li>Read the story, then investigate only what interests you.</li></ol>
      </section>
    </div>}
  </main>;
}
