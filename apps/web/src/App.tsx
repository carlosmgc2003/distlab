import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CommerceFacts, CommerceState } from "./CommerceLesson.tsx";
import { DocumentDiagnostics, ImportedChecks, ImportedHeader } from "./ImportedScenario.tsx";
import { errorDiagnostics, oversized } from "./scenario-file.ts";
import type { ScenarioFile } from "./scenario-file.ts";
import { starterFile } from "./starter-file.ts";
import { commerceCatalogReference } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import { ArchitectureView } from "./ArchitectureView.tsx";
import type { GraphPick } from "./ArchitectureView.tsx";
import { BreakPanel } from "./BreakPanel.tsx";
import { LessonChooser } from "./LessonChooser.tsx";
import { LessonPanel } from "./LessonPanel.tsx";
import { currentStep } from "./lesson-steps.ts";
import { carryOverlay, designEdits, draftFromOverlay, faultMarks, isEmptyOverlay, overlayFromDraft, sameOverlay } from "./break-faults.ts";
import type { DraftEntry } from "./break-faults.ts";
import { DesignChoicesPanel } from "./DesignChoicesPanel.tsx";
import { describeChoices, isChoiceDiagnostic, placeChoiceDiagnostics, sameChoices } from "./design-choices.ts";
import type { CanonicalValue, LessonOverlayPolicy, ParameterOverride, ScenarioDefinition, ScenarioDiagnostic, ScenarioDocument, SessionOverlay } from "@distlab/contracts";
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
  const [loadedChoice, setLoadedChoice] = useState<PackagedScenario | null>(null);
  const [emphasis, setEmphasis] = useState<GraphEmphasis | undefined>(undefined);
  const [evidenceFocus, setEvidenceFocus] = useState<{ id: string; token: number } | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("architecture");
  const [showHistoryControls, setShowHistoryControls] = useState(false);
  // The Lesson chooser is the one way to choose a packaged lesson (#139). Choosing one loads it.
  const [chooserOpen, setChooserOpen] = useState(false);
  // The Lesson panel's collapsed rail is UI state: it survives tab switches and lesson loads (#140).
  const [lessonCollapsed, setLessonCollapsed] = useState(false);
  const lessonTrigger = useRef<HTMLButtonElement>(null);
  const chooserOpener = useRef<HTMLElement | null>(null);
  // After a choice, focus returns to the trigger once the load settles and the trigger is enabled again.
  const focusTriggerWhenIdle = useRef(false);
  const tabRequest = useRef<{ tab: WorkspaceTab; focusPanel: boolean } | null>(null);
  // The draft overlay is UI state (ADR-004). Only Apply, Load, and Compare send it, inside an ordinary load.
  const [draft, setDraft] = useState<readonly DraftEntry[]>([]);
  const [choiceDraft, setChoiceDraft] = useState<readonly ParameterOverride[]>([]);
  const [submitted, setSubmitted] = useState<SessionOverlay | null>(null);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<{ pick: GraphPick; token: number } | null>(null);
  const [carryNotice, setCarryNotice] = useState("");
  const [breakOpen, setBreakOpen] = useState(false);
  // Collapsed by default, so the architecture keeps its height.
  const [choicesOpen, setChoicesOpen] = useState(false);
  // An imported scenario file stays in UI state until the student chooses another scenario (ADR-006).
  // Its text is sent unparsed; only the worker parses and validates it.
  const [importedFile, setImportedFile] = useState<ScenarioFile | null>(null);
  // The last document the worker validated for that file, so Break stays editable after INVALID_OVERLAY.
  const [importedDocument, setImportedDocument] = useState<ScenarioDocument | null>(null);
  // A file rejected before it was read (ADR-006 step 1). Nothing was sent, so the session is unchanged.
  const [unreadFile, setUnreadFile] = useState<{ readonly name: string; readonly diagnostics: readonly ScenarioDiagnostic[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onGraphPick = useCallback((value: GraphPick) => setPick(current => ({ pick: value, token: (current?.token ?? 0) + 1 })), []);
  const onEmphasis = useCallback((value: GraphEmphasis | undefined) => { setEmphasis(value); }, []);
  useEffect(() => { if (snapshot.document) setImportedDocument(snapshot.document); }, [snapshot.document]);
  const imported = importedFile !== null;
  const importedScenario = imported ? snapshot.document ?? importedDocument : null;
  // An imported session has no packaged copy: its scenario, policy, and family come from the validated document.
  const lesson: ScenarioDefinition | undefined = useMemo(() => imported ? importedScenario?.scenario : loadedChoice ? packagedMetadata(loadedChoice) : undefined, [imported, importedScenario, loadedChoice]);
  const policy: LessonOverlayPolicy | undefined = imported ? importedScenario?.overlayPolicy : loadedChoice?.policy;
  const commerce = imported ? importedScenario?.catalog.id === commerceCatalogReference.id : loadedChoice?.family === "commerce";
  const sessionName = imported ? `imported:${importedFile.name}` : loadedChoice?.id ?? "none";
  const documentError = snapshot.error?.code === "INVALID_DOCUMENT" && importedFile ? { name: importedFile.name, diagnostics: errorDiagnostics(snapshot.error.context) ?? [] } : null;
  // Student fault rules come from the session the worker applied; the report lists them beside the packaged rules.
  const studentRules = snapshot.session?.overlay.faults;
  const report = useMemo(() => projection && lesson && !commerce
    ? inspectFaults(projection, studentRules?.length ? { ...lesson, faults: [...lesson.faults, ...studentRules] } : lesson) : null, [projection, lesson, commerce, studentRules]);
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
  const applied = snapshot.session?.overlay ?? null;
  const appliedEntries = useMemo(() => applied ? draftFromOverlay(applied) : [], [applied]);
  const marks = useMemo(() => appliedEntries.length ? faultMarks(appliedEntries, lesson?.architecture) : undefined, [appliedEntries, lesson]);
  const overlayError = snapshot.error?.code === "INVALID_OVERLAY" ? snapshot.error : null;
  const rejected = useMemo(() => {
    const context = overlayError?.context as { readonly diagnostics?: unknown } | null | undefined;
    const diagnostics = context && typeof context === "object" && Array.isArray(context.diagnostics) ? context.diagnostics as ScenarioDiagnostic[] : null;
    return overlayError && submitted && diagnostics ? { overlay: submitted, diagnostics } : null;
  }, [overlayError, submitted]);
  // Each panel shows the diagnostics that point into its own part of the overlay.
  const rejectedFaults = useMemo(() => rejected ? { ...rejected, diagnostics: rejected.diagnostics.filter(item => !isChoiceDiagnostic(item)) } : null, [rejected]);
  const rejectedChoices = useMemo(() => rejected ? placeChoiceDiagnostics(rejected.diagnostics.filter(isChoiceDiagnostic), rejected.overlay.parameters) : new Map<string, string>(), [rejected]);
  const choicesPending = !sameChoices(choiceDraft, applied?.parameters ?? []);
  const faultsPending = useMemo(() => {
    const faults = overlayFromDraft(draft, applied?.parameters ?? []);
    return applied ? !sameOverlay(faults, applied) : !isEmptyOverlay(faults);
  }, [draft, applied]);
  // The lesson line names the loaded experiment. The run status itself is announced once, by the
  // committed-state summary, so this region never restates it.
  const lessonState = loading ? "Loading the lesson…"
    : snapshot.error?.code === "SIMULATION_FAILED" ? "The run failed. Inspect the error, then Reset to try again."
    : overlayError ? "The changes were not applied. Fix the marked faults or design choices, then apply them again."
    : documentError ? "The scenario file was not loaded. Fix the problems listed below, then open the file again."
    : snapshot.error ? "The lesson could not be opened. Choose a lesson to try again."
    : !projection ? "No lesson is loaded."
    : imported ? `Lesson ready: Imported · ${importedScenario?.presentation.title ?? importedFile.name}.`
    : `Lesson ready: ${loadedChoice ? experimentLabel(loadedChoice) : "checkout"}.`;
  const sessionKey = `${sessionName}:${snapshot.attempt}:${projection?.simulation.runId ?? ""}`;

  useEffect(() => { if (!projection) setEmphasis(undefined); }, [projection]);
  useEffect(() => {
    if (chooserOpen || busy || !focusTriggerWhenIdle.current) return;
    focusTriggerWhenIdle.current = false;
    lessonTrigger.current?.focus();
  }, [chooserOpen, busy]);
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
  /** Resets the draft for a new load and returns the overlay to send, if any. */
  const startDraft = (overlay?: SessionOverlay): SessionOverlay | undefined => {
    setEvidenceFocus(null);
    setPicking(false);
    setUnreadFile(null);
    const sent = overlay && !isEmptyOverlay(overlay) ? overlay : undefined;
    setSubmitted(sent ?? null);
    // Choosing a lesson starts from an empty draft; Apply and Compare keep the overlay they send.
    setDraft(sent ? draftFromOverlay(sent) : []);
    setChoiceDraft(sent?.parameters ?? []);
    if (!overlay) setCarryNotice("");
    return sent;
  };
  /**
   * Every path that changes inputs is one load: an exact packaged document, or the text of an
   * imported scenario file, plus an optional overlay.
   */
  const replaceSession = (id: string, overlay?: SessionOverlay) => {
    if (busy) return;
    const choice = scenarios.find(item => item.id === id);
    if (!choice) return;
    setLoadedChoice(choice);
    // Choosing another scenario discards the imported document (ADR-006).
    setImportedFile(null);
    setImportedDocument(null);
    const sent = startDraft(overlay);
    // The host publishes structured failures; the event handler owns no simulation state.
    void host.load(choice.scenario, sent as unknown as CanonicalValue | undefined).catch(() => {});
  };
  const loadFile = (file: ScenarioFile, overlay?: SessionOverlay) => {
    if (busy) return;
    setImportedFile(file);
    const sent = startDraft(overlay);
    // The text goes to the worker exactly as read: the main thread never parses or validates it.
    void host.loadDocument(file.text, sent as unknown as CanonicalValue | undefined).catch(() => {});
  };
  const openFile = async (file: File | undefined) => {
    if (!file || busy) return;
    // A file larger than the document limit is not read (ADR-006 "Import path", step 1).
    const diagnostics = oversized(file.size);
    if (diagnostics.length) { setUnreadFile({ name: file.name, diagnostics }); return; }
    const text = await file.text();
    setImportedDocument(null);
    loadFile({ name: file.name, text });
  };
  const applyDraft = (overlay: SessionOverlay) => {
    setCarryNotice("");
    if (importedFile) loadFile(importedFile, overlay);
    else if (loadedChoice) replaceSession(loadedChoice.id, overlay);
  };
  const compare = (id: string) => {
    if (!loadedChoice) return;
    const target = scenarios.find(item => item.id === id);
    if (!target) return;
    // Compare carries the applied overlay; the paired lesson's policy may still reject a fault.
    const carried = carryOverlay(applied ?? { version: 1, faults: [], scheduledFaults: [], parameters: [] }, loadedChoice.policy, target.policy);
    const faults = carried.overlay.faults.length + carried.overlay.scheduledFaults.length;
    const edits = designEdits(carried.overlay.architecture);
    const kept = `${carried.overlay.parameters.length ? `, kept ${describeChoices(carried.overlay.parameters)}` : ""}${edits ? `, kept ${edits} design edit${edits === 1 ? "" : "s"}` : ""}`;
    // A dropped design choice is the one the pair compares: the paired lesson's own value applies.
    setCarryNotice(faults || kept || carried.dropped.length
      ? `Compare kept ${faults} student fault${faults === 1 ? "" : "s"}${kept}${carried.dropped.length ? ` and dropped ${carried.dropped.join(", ")}` : ""}.` : "");
    replaceSession(id, carried.overlay);
  };
  /**
   * Downloads the loaded packaged lesson as a starter scenario file (ADR-006). The file is built
   * from data-only modules and handed to the browser as a Blob: no network, no storage, no load.
   */
  const saveStarter = () => {
    if (!loadedChoice) return;
    const file = starterFile(loadedChoice);
    const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
  const openChooser = (opener: HTMLElement) => {
    if (busy) return;
    chooserOpener.current = opener;
    setChooserOpen(true);
  };
  /** Escape and Cancel change nothing; focus returns to the control that opened the chooser. */
  const closeChooser = () => {
    setChooserOpen(false);
    const opener = chooserOpener.current;
    chooserOpener.current = null;
    (opener?.isConnected ? opener : lessonTrigger.current)?.focus();
  };
  /** Choosing a lesson is the whole load: the exact packaged document, without an overlay. */
  const chooseLesson = (id: string) => {
    if (busy) return;
    chooserOpener.current = null;
    focusTriggerWhenIdle.current = true;
    setChooserOpen(false);
    replaceSession(id);
  };
  const triggerLabel = imported ? `Lesson: ${importedScenario?.presentation.title ?? importedFile.name}`
    : loadedChoice ? `Lesson: ${experimentLabel(loadedChoice)}` : "Choose a lesson";

  const editable = !busy && (projection !== null || overlayError !== null);
  // An imported document accepts student changes only when it declares an overlay policy (ADR-006).
  const breakPanel = policy && lesson ? <BreakPanel key={sessionName} policy={policy} architecture={lesson.architecture}
    applied={applied} draft={draft} onDraftChange={setDraft} parameters={choiceDraft} choicesPending={choicesPending} editable={editable}
    rejected={rejectedFaults} onApply={applyDraft} picking={picking} onPickingChange={setPicking} pick={pick} open={breakOpen} onOpenChange={setBreakOpen}
    hidden={projection !== null && tab !== "architecture"} /> : null;
  // Design choices exist only for lessons whose policy declares parameters.
  const choicesPanel = policy && policy.parameters.length ? <DesignChoicesPanel key={sessionName} policy={policy}
    applied={applied?.parameters ?? null} draft={choiceDraft} onDraftChange={setChoiceDraft} editable={editable} rejected={rejectedChoices}
    onApply={() => applyDraft(overlayFromDraft(draft, choiceDraft))} faultsPending={faultsPending} open={choicesOpen} onOpenChange={setChoicesOpen} /> : null;

  // The Lesson panel (#140) holds what the learning prompt bar and the toolbar's lesson drawer held,
  // moved without rewording. Only Advanced diagnostics stays a disclosure.
  const status = projection?.simulation.status;
  const checkoutGuide = !imported && loadedChoice?.family !== "commerce";
  const runOverview = projection && report ? <div className="execution-overview">
    <p><strong>{imported ? importedScenario?.presentation.title : loadedChoice?.id === "response-lost" ? "Lost processor response" : "Normal checkout"}</strong> — {status === "COMPLETED" ? "Execution completed; business outcome is shown from recorded state." : status === "FAILED" ? "Execution failed." : status === "RUNNING" ? "Execution in progress." : "Execution partial or ready."}</p>
    <p>{report.knowledge}</p>
    <p>Recorded delivery attempts: {report.deliveries.length ? report.deliveries.map(item => `${item.destination}: attempt ${item.attempt} (${item.state})`).join("; ") : "Unavailable — no student-visible delivery records."}</p>
    <p>Operation duration: unavailable — this projection does not provide authorized start/end boundaries. Scenario virtual end time is not operation latency; browser playback speed is not simulated performance.</p>
    <div className="evidence-links">{report.evidence.map(item => <button key={item.observationId} type="button" onClick={() => showEvidence(item.observationId)}>{item.label}</button>)}</div>
    {imported ? null : <p>Investigate: Which record proves authorization? What does Payments know after the timeout? A timeout does not prove that authorization was undone.</p>}
  </div> : null;
  const lessonGoal = imported && importedScenario
    ? <ImportedHeader document={importedScenario} origin={snapshot.session?.origin} runId={projection?.simulation.runId} />
    : <>
      <p className="lesson-goal-title"><strong>{loadedChoice ? experimentLabel(loadedChoice) : null}</strong></p>
      {loadedChoice?.family === "commerce" ? null
        : <p className="lesson-goal-question">{loadedChoice?.id === "response-lost" ? "Does a timeout mean the payment failed?" : "How does a checkout travel through a distributed system?"}</p>}
      <p>{loadedChoice?.family === "commerce" ? loadedChoice.description : "Explore the architecture, run the scenario, then follow its recorded story."}</p>
    </>;
  const lessonRun = <>
    <p role="status" aria-label="Lesson state" aria-live="polite">{lessonState}</p>
    <p>Step advances one scheduled event. Pause takes effect at an event boundary. Reset starts the loaded scenario again.</p>
    <p>Reset and run again to compare the same virtual-time history.</p>
  </>;
  // The outcome comes first, then the evidence links, then the lesson's questions.
  const lessonInvestigate = <>
    {runOverview}
    {imported ? <p>Seed: {lesson?.seed}. This scenario was imported from a file, so no packaged lesson copy applies. Run it, check its results below the architecture, then use Recorded history to follow what happened.</p>
      : !checkoutGuide ? <p>Seed: {lesson?.seed}. Observe the service state and lesson checks in Architecture, then use Recorded history to follow database commits, faults, messages, and runtime logs.</p> : <>
      <p>Objective: follow a checkout request and compare the customer-facing result with the processor’s recorded state. Changing the experiment after a session is loaded replaces the worker session and does not edit rules during a run.</p>
      {loadedChoice ? <p>Scenario details: {report?.scenarioName}; seed {report?.seed}; version and fault rule are available in the recorded scenario definition.</p> : null}
      <p>Load a checkout, inspect the four component categories and their links, then Run, Pause, or Step through the timeline. Select a row to follow request or message movement and inspect each component’s state.</p>
      <p>For the response-lost experiment, find the processor authorization, the dropped response, and the Payments timeout. What does Payments know, and what does the processor know? Does the timeout prove that payment failed?</p>
    </>}
  </>;
  const appliedChanges = snapshot.session ? `${snapshot.session.overlay.parameters.length ? ` · ${describeChoices(snapshot.session.overlay.parameters)}` : ""} · ${appliedEntries.length ? `${appliedEntries.length} student fault${appliedEntries.length === 1 ? "" : "s"}` : "packaged faults only"}` : "";
  const lessonExperiment = <>
    {imported ? <>
      {/* Without an overlay policy there is no Break panel; say so where the scenario is described (ADR-006). */}
      {policy ? null : <p className="imported-locked">This scenario accepts no student changes: its file declares no overlay policy.</p>}
      {snapshot.session && (appliedEntries.length || snapshot.session.overlay.parameters.length) ? <p className="run-identity" aria-label="Applied student changes">
        {snapshot.session.overlay.parameters.length ? `${describeChoices(snapshot.session.overlay.parameters)} · ` : ""}{appliedEntries.length} student fault{appliedEntries.length === 1 ? "" : "s"}
      </p> : null}
    </> : <>
      {snapshot.session && projection ? <p className="run-identity" aria-label="Run identity">
        Seed {snapshot.session.seed}{appliedChanges} · run {projection.simulation.runId.replace(/^run:/, "").slice(0, 8)}
      </p> : null}
      {loadedChoice?.family === "commerce" && loadedChoice.compare ? <button type="button" disabled={busy} onClick={() => compare(loadedChoice.compare)}>Compare: {scenarios.find(choice => choice.id === loadedChoice.compare)?.title}</button> : null}
      {carryNotice ? <p role="status">{carryNotice}</p> : null}
    </>}
    {choicesPanel}
    {/* An instructor's authoring aid. It is offered only for a packaged lesson, never for an imported document. */}
    {imported || !loadedChoice ? null : <button type="button" className="save-starter" onClick={saveStarter}>Save as scenario file</button>}
    {/* Engine counters stay here; the committed run summary in the toolbar carries status and virtual time. */}
    {projection && report ? <details className="raw-state advanced-diagnostics">
      <summary>Advanced diagnostics</summary>
      <div className="raw-state-body" tabIndex={0} aria-label="Distributed state details">
        <dl className="diagnostics">
          <dt>Random draws</dt><dd>{projection.simulation.randomDrawCount}</dd>
          <dt>Observations</dt><dd>{projection.history.observations.length}</dd>
        </dl>
        <DistributedState report={report} onShowEvidence={showEvidence} />
      </div>
    </details> : null}
  </>;
  const lessonPanel = <LessonPanel collapsed={lessonCollapsed} onCollapsedChange={setLessonCollapsed}
    step={currentStep(status, projection?.simulation.processedEvents)}
    goal={lessonGoal} run={lessonRun} investigate={lessonInvestigate} experiment={lessonExperiment} />;

  return <main className={`app-shell${tab === "history" && projection && !showHistoryControls ? " history-focus" : ""}`}>
    {tab === "history" && projection && !showHistoryControls ? <h1 className="sr-only">DistLab · Recorded history</h1> : null}
    <header className="command-toolbar">
      <div className="toolbar-row">
        <div className="brand"><h1>DistLab</h1><span>Distributed systems, explained</span></div>
        {/* A scenario file may also be dropped here. Open and drop are available only when Load is. */}
        <div className="scenario-picker"
          onDragOver={event => { if (!busy && event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
          onDrop={event => { event.preventDefault(); void openFile(event.dataTransfer.files[0]); }}>
          <button ref={lessonTrigger} type="button" className="lesson-trigger" disabled={busy} aria-haspopup="dialog" aria-expanded={chooserOpen}
            aria-describedby="scenario-help" title={triggerLabel} onClick={event => openChooser(event.currentTarget)}>
            <span className="lesson-trigger-label">{triggerLabel}</span><span className="lesson-trigger-caret" aria-hidden="true">▾</span>
          </button>
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Open scenario file…</button>
          <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Scenario file" hidden disabled={busy}
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void openFile(file); }} />
          <p id="scenario-help" className="sr-only">Choose a checkout or commerce failure/resilience lesson, or open an instructor’s scenario file. Choosing a lesson after a session is loaded replaces the worker session and does not edit rules during a run.</p>
        </div>
      </div>
      <SimulationControls host={host} snapshot={snapshot} notices={<>
        {mark ? <p className="terminal-history" role="status" aria-label="Terminal history">{terminalCopy(mark)}</p> : null}
      </>}>
        {/* Recorded history navigation shares the command row, kept apart by its own rule and label. */}
        {tab === "architecture" && projection ? <FlightControls playback={playback} /> : null}
      </SimulationControls>
    </header>
    {unreadFile ? <DocumentDiagnostics fileName={unreadFile.name} diagnostics={unreadFile.diagnostics} loaded={projection !== null} /> : null}
    {projection ? <div className="investigation-workspace has-lesson-panel">
      {lessonPanel}
      <div className={`workspace-main${breakOpen && policy && tab === "architecture" ? " break-open" : ""}`}>
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
        {/* Break the system belongs to the Architecture tab: faults target the graph's links and components. */}
        {breakPanel}
        <section id="architecture-panel" className="panel-architecture" role="tabpanel" tabIndex={-1}
          aria-labelledby="tab-architecture" hidden={tab !== "architecture"}>
          <ArchitectureView architecture={projection.architecture} sessionKey={`${sessionName}:${snapshot.attempt}`} playback={playback}
            {...(marks ? { faultMarks: marks } : {})} {...(picking ? { onPick: onGraphPick } : {})}
            {...(lesson ? { metadata: lesson.architecture, scenarioName: lesson.name } : {})}
            {...(emphasis ? { emphasis, ...(emphasis.text !== undefined ? { movementText: emphasis.text } : {}) } : {})}
            {...(commerce ? { inspectorFacts: (componentId: string) => <CommerceFacts projection={projection} componentId={componentId} /> } : report ? { inspectorFacts: (componentId: string) => <ComponentRuntimeFacts report={report} componentId={componentId} /> } : {})} />
          {imported && importedScenario ? <ImportedChecks projection={projection} document={importedScenario} onShowEvidence={showEvidence} /> : null}
          {imported ? commerce ? <CommerceState projection={projection} onShowEvidence={showEvidence} /> : null
            : loadedChoice?.family === "commerce" ? <CommerceState projection={projection} checks={loadedChoice.checks} onShowEvidence={showEvidence} /> : null}
        </section>
        <div id="history-panel" className="panel-history" role="tabpanel" tabIndex={-1}
          aria-labelledby="tab-history" hidden={tab !== "history"}>
          <TimelineView key={`${sessionName}:${snapshot.attempt}`} observations={projection.history.observations} edges={edges} componentTitles={componentTitles} onEmphasis={onEmphasis}
            {...(evidenceFocus ? { focusedObservationId: evidenceFocus.id, focusToken: evidenceFocus.token } : {})} />
        </div>
      </div>
    </div> : overlayError && (loadedChoice || imported) ? <div className="investigation-workspace has-lesson-panel">
      {lessonPanel}
      <div className="workspace-main">{breakPanel}</div>
    </div> : documentError ? <div className="investigation-workspace">
      <DocumentDiagnostics fileName={documentError.name} diagnostics={documentError.diagnostics} loaded={false} />
    </div> : <div className="investigation-workspace">
      <section className="workspace-empty" tabIndex={-1}>
        <p className="eyebrow">A small system. A big question.</p>
        <h2>What happens between checkout and payment?</h2>
        <p>Follow requests between services, discover what each component knows, and compare a successful checkout with a lost response.</p>
        <ol><li><button type="button" className="empty-choose-lesson" disabled={busy} aria-haspopup="dialog" onClick={event => openChooser(event.currentTarget)}>Choose a lesson</button>, or open an instructor’s scenario file.</li><li>Explore the system and run the simulation.</li><li>Read the story, then investigate only what interests you.</li></ol>
      </section>
    </div>}
    <LessonChooser open={chooserOpen} lessons={scenarios} current={imported ? null : loadedChoice?.id ?? null} busy={busy}
      discardsDraft={choicesPending || faultsPending} onChoose={chooseLesson} onClose={closeChooser} />
  </main>;
}
