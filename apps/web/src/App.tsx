import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { HelpHint } from "./ui-hint.tsx";
import { CommerceFacts, EXPECTATIONS_HELP, INVARIANTS_HELP, LessonChecks, ServiceStateGrid, commerceLessonChecks } from "./CommerceLesson.tsx";
import { DocumentDiagnostics, ImportedChecks, ImportedHeader } from "./ImportedScenario.tsx";
import { errorDiagnostics, oversized } from "./scenario-file.ts";
import type { ScenarioFile } from "./scenario-file.ts";
import { starterFile } from "./starter-file.ts";
import { commerceCatalogReference } from "../../../packages/catalogs/src/commerce/scenarios.ts";
import { ArchitectureView } from "./ArchitectureView.tsx";
import type { GraphPick } from "./ArchitectureView.tsx";
import { ExperimentDrawer } from "./ExperimentDrawer.tsx";
import { ServiceStateDialog } from "./ServiceStateDialog.tsx";
import { FaultsHelp, FaultsSection } from "./FaultsSection.tsx";
import { LessonChooser } from "./LessonChooser.tsx";
import { lessonTopics, type TopicFilter } from "./lesson-topics.ts";
import { LessonPanel } from "./LessonPanel.tsx";
import { currentStep } from "./lesson-steps.ts";
import { endsRun, outcomeSummary, runOutcome } from "./lesson-outcome.ts";
import { carryOverlay, designEdits, draftFromOverlay, faultMarks, isEmptyOverlay, overlayFromDraft, sameOverlay } from "./break-faults.ts";
import type { DraftEntry } from "./break-faults.ts";
import { DESIGN_CHOICES_HELP, DesignChoicesSection } from "./DesignChoicesSection.tsx";
import { describeChoices, isChoiceDiagnostic, placeChoiceDiagnostics, sameChoices } from "./design-choices.ts";
import type { CanonicalValue, LessonOverlayPolicy, ParameterOverride, ScenarioDefinition, ScenarioDiagnostic, ScenarioDocument, SessionOverlay } from "@distlab/contracts";
import { movementEdges, mapArchitecture } from "./architecture-view.ts";
import { FlightControls } from "./ArchitecturePlayback.tsx";
import { useFlightPlayback } from "./flight-playback.ts";
import { ComponentRuntimeFacts, DistributedState } from "./FaultInspectionView.tsx";
import { inspectFaults } from "./fault-inspection.ts";
import { SimulationAlert, SimulationControls } from "./SimulationControls.tsx";
import { ThemeSelector } from "./ThemeSelector.tsx";
import { TimelineView } from "./TimelineView.tsx";
import type { PackagedAssessment, PackagedScenario } from "./scenarios.ts";
import { AssessmentExperiment, AssessmentGoal, AssessmentInvestigate, AssessmentMatrix, AssessmentRun, useAssessmentSuite } from "./AssessmentView.tsx";
import type { SimulationHost } from "./host.ts";
import { assessments, experimentLabel, packagedMetadata, scenarios } from "./scenarios.ts";
import { DESIGN_STEP_NOTICE, designStepUnavailable } from "./design-step.ts";
import { terminalCopy, terminalMark } from "./timeline.ts";
import type { GraphEmphasis } from "./timeline.ts";

type WorkspaceTab = "assessment" | "architecture" | "history";

const tabs = [
  ["architecture", "Architecture"],
  ["history", "Recorded history"],
] as const satisfies readonly (readonly [WorkspaceTab, string])[];
// An open assessment (#97, D-7) puts its results first; the system and its history stay one tab away.
const assessmentTabs = [["assessment", "Assessment results"], ...tabs] as const satisfies readonly (readonly [WorkspaceTab, string])[];

export function App({ host }: { readonly host: SimulationHost }) {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const { projection, loading, pendingCommands } = snapshot;
  const commandBusy = loading || pendingCommands.length > 0 || projection?.simulation.status === "RUNNING";
  const [loadedChoice, setLoadedChoice] = useState<PackagedScenario | null>(null);
  // An open assessment replaces the loaded lesson; its suite state is UI state (docs/spec/assessment.md).
  const [assessment, setAssessment] = useState<PackagedAssessment | null>(null);
  // Evidence of a reloaded row is shown once that row's session has settled (ASSESS-AC-6).
  const [pendingEvidence, setPendingEvidence] = useState<string | null>(null);
  const suite = useAssessmentSuite(host, assessment, commandBusy, useCallback((id: string) => setPendingEvidence(id), []));
  const suiteActive = suite.running || suite.reopening !== null;
  const busy = commandBusy || suiteActive;
  const [emphasis, setEmphasis] = useState<GraphEmphasis | undefined>(undefined);
  const [evidenceFocus, setEvidenceFocus] = useState<{ id: string; token: number } | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("architecture");
  // The Lesson chooser is the one way to choose a packaged lesson (#139). Choosing one loads it.
  const [chooserOpen, setChooserOpen] = useState(false);
  /** Each opening remounts the chooser, so its filters start from the opener's topic (or all topics). */
  const [chooserOpening, setChooserOpening] = useState<{ readonly count: number; readonly topic: TopicFilter }>({ count: 0, topic: "all" });
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
  // The Experiment drawer (#143) is UI state: it stays open across Apply and lesson loads, and Close keeps the draft.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The Service state dialog (#142) is UI state; Escape and Close return focus to its opener.
  const [serviceStateOpen, setServiceStateOpen] = useState(false);
  const serviceStateOpener = useRef<HTMLButtonElement>(null);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  // A design-choice field holding text that is not a value withholds Apply; Discard clears that text.
  const [choicesInvalid, setChoicesInvalid] = useState(false);
  const [choicesReset, setChoicesReset] = useState(0);
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
  const lesson: ScenarioDefinition | undefined = useMemo(() => imported ? importedScenario?.scenario
    : assessment ? assessment.scenario as unknown as ScenarioDefinition : loadedChoice ? packagedMetadata(loadedChoice) : undefined, [imported, importedScenario, assessment, loadedChoice]);
  // An assessment takes no Experiment drawer: its rows are the faults, and its design form is in the Lesson panel.
  const policy: LessonOverlayPolicy | undefined = imported ? importedScenario?.overlayPolicy : assessment ? undefined : loadedChoice?.policy;
  const commerce = imported ? importedScenario?.catalog.id === commerceCatalogReference.id : assessment ? true : loadedChoice?.family === "commerce";
  // Every suite row is its own run, so an assessment's session name follows the loaded row.
  const sessionName = imported ? `imported:${importedFile.name}` : assessment ? `assessment:${assessment.id}:${projection?.simulation.runId ?? ""}` : loadedChoice?.id ?? "none";
  const documentError = snapshot.error?.code === "INVALID_DOCUMENT" && importedFile ? { name: importedFile.name, diagnostics: errorDiagnostics(snapshot.error.context) ?? [] } : null;
  // Student fault rules come from the session the worker applied; the report lists them beside the packaged rules.
  const studentRules = snapshot.session?.overlay.faults;
  const report = useMemo(() => projection && lesson && !commerce
    ? inspectFaults(projection, studentRules?.length ? { ...lesson, faults: [...lesson.faults, ...studentRules] } : lesson) : null, [projection, lesson, commerce, studentRules]);
  const graph = useMemo(() => projection && lesson
    ? mapArchitecture(projection.architecture, lesson.architecture, lesson.name) : null, [projection, lesson]);
  const edges = useMemo(() => graph ? movementEdges(graph.edges) : [], [graph]);
  const componentTitles = useMemo(() => graph ? graph.nodes.map(node => ({ id: node.id, title: node.data.title })) : [], [graph]);
  // The session's check labels by assertion ID: the packaged lesson's classification, or the imported document's own labels.
  const checkLabels = useMemo((): Readonly<Record<string, string>> => imported ? importedScenario?.presentation.assertions ?? {}
    : assessment ? Object.fromEntries(assessment.checks.map(check => [check.id, check.label]))
    : loadedChoice?.family === "commerce" ? Object.fromEntries(loadedChoice.checks.map(check => [check.id, check.label])) : {}, [imported, importedScenario, assessment, loadedChoice]);
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
  // Reset keeps a projection but remounts Recorded history, whose new instance starts with no
  // emphasis and so never reports the change (#189). The highlight belongs to the history it was
  // raised from, so it is cleared during render, before the new instance's effects can raise one.
  const timelineKey = `${sessionName}:${snapshot.attempt}`;
  const [emphasisKey, setEmphasisKey] = useState(timelineKey);
  if (emphasisKey !== timelineKey) {
    setEmphasisKey(timelineKey);
    setEmphasis(undefined);
  }
  useEffect(() => {
    if (chooserOpen || busy || !focusTriggerWhenIdle.current) return;
    focusTriggerWhenIdle.current = false;
    lessonTrigger.current?.focus();
  }, [chooserOpen, busy]);
  useEffect(() => { setEvidenceFocus(null); }, [sessionKey]);
  // After the session-key reset above, so a reloaded row's evidence survives its own reload.
  useEffect(() => {
    if (!pendingEvidence || busy || !projection) return;
    setPendingEvidence(null);
    showEvidence(pendingEvidence);
  });
  useEffect(() => {
    const requested = tabRequest.current;
    if (!requested) return;
    tabRequest.current = null;
    if (!requested.focusPanel) return;
    document.getElementById(`${requested.tab}-panel`)?.focus();
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
    const order: WorkspaceTab[] = workspaceTabs.map(([id]) => id);
    const current = order.indexOf(tab);
    let next: WorkspaceTab = tab;
    if (event.key === "ArrowRight") next = order[(current + 1) % order.length]!;
    else if (event.key === "ArrowLeft") next = order[(current - 1 + order.length) % order.length]!;
    else if (event.key === "Home") next = order[0]!;
    else if (event.key === "End") next = order.at(-1)!;
    // Arrow navigation activates the tab but keeps focus on the tab itself;
    // only direct activation moves focus into the panel.
    showTab(next, false);
    document.getElementById(`tab-${next}`)?.focus();
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
  /** Choosing a lesson or a file closes an open assessment; its results are UI state and are dropped. */
  const leaveAssessment = () => {
    if (!assessment) return;
    setAssessment(null);
    suite.reset();
    if (tab === "assessment") setTab("architecture");
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
    leaveAssessment();
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
    leaveAssessment();
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
  const openChooser = (opener: HTMLElement, topic: TopicFilter = "all") => {
    if (busy) return;
    chooserOpener.current = opener;
    setChooserOpening(previous => ({ count: previous.count + 1, topic }));
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
  /**
   * Opening an assessment loads its base lesson without an overlay, so its architecture is on view
   * before the first run. Each suite row is then an ordinary load of the same document (D-7).
   */
  const chooseAssessment = (id: string) => {
    if (busy) return;
    const choice = assessments.find(item => item.id === id);
    if (!choice) return;
    chooserOpener.current = null;
    focusTriggerWhenIdle.current = true;
    setChooserOpen(false);
    setAssessment(choice);
    suite.reset();
    setLoadedChoice(null);
    setImportedFile(null);
    setImportedDocument(null);
    startDraft();
    setTab("assessment");
    void host.load(choice.scenario).catch(() => {});
  };
  const triggerLabel = assessment ? `Lesson: ${assessment.title} assessment` : imported ? `Lesson: ${importedScenario?.presentation.title ?? importedFile.name}`
    : loadedChoice ? `Lesson: ${experimentLabel(loadedChoice)}` : "Choose a lesson";

  const editable = !busy && (projection !== null || overlayError !== null);
  const experimentPending = choicesPending || faultsPending;
  // A rejected overlay opens the drawer, where each section shows the diagnostics that point into it.
  useEffect(() => { if (rejected) setDrawerOpen(true); }, [rejected]);
  const closeDrawer = () => {
    setDrawerOpen(false);
    setPicking(false);
    drawerTrigger.current?.focus();
  };
  const discardDraft = () => {
    setDraft(applied ? draftFromOverlay(applied) : []);
    setChoiceDraft(applied?.parameters ?? []);
    setChoicesReset(token => token + 1);
  };
  // Picking happens on the graph, so starting it shows the Architecture tab.
  const changePicking = useCallback((next: boolean) => {
    setPicking(next);
    if (next) setTab("architecture");
  }, []);
  // An imported document accepts student changes only when it declares an overlay policy (ADR-006).
  const experimentDrawer = policy && lesson ? <ExperimentDrawer key={sessionName} open={drawerOpen} onClose={closeDrawer}
    pending={experimentPending} invalid={choicesInvalid} editable={editable}
    onApply={() => applyDraft(overlayFromDraft(draft, choiceDraft))} onDiscard={discardDraft}
    // Design choices exist only for lessons whose policy declares parameters.
    designChoices={policy.parameters.length ? <DesignChoicesSection policy={policy} draft={choiceDraft}
      onDraftChange={setChoiceDraft} editable={editable} rejected={rejectedChoices} onInvalidChange={setChoicesInvalid} resetToken={choicesReset} /> : null}
    faults={<FaultsSection policy={policy} architecture={lesson.architecture} applied={applied} draft={draft} onDraftChange={setDraft}
      pending={faultsPending} editable={editable} rejected={rejectedFaults} picking={picking} onPickingChange={changePicking} pick={pick} />}
    // The drawer's one hint holds both sections' reasoning (#147).
    help={<>{policy.parameters.length ? <p>{DESIGN_CHOICES_HELP}</p> : null}<FaultsHelp policy={policy} /></>} /> : null;

  // The Lesson panel (#140) holds what the learning prompt bar and the toolbar's lesson drawer held,
  // moved without rewording. Only Advanced diagnostics stays a disclosure.
  const status = projection?.simulation.status;
  const checkoutGuide = !imported && loadedChoice?.family !== "commerce";
  // The packaged commerce lesson's checks; an imported session lists its own with ImportedChecks.
  const checkView = useMemo(() => projection && !imported && loadedChoice?.family === "commerce"
    ? commerceLessonChecks(projection, loadedChoice.checks) : null, [projection, imported, loadedChoice]);
  // The one-line outcome (#141): the invariants' summary for commerce, the Run overview's sentence for checkout.
  const summary = checkView ? outcomeSummary(checkView) : projection && report ? runOutcome(status) : null;
  // ③ Investigate's one hint (#147): what the checks mean, or why the Run overview states no duration.
  const investigateHelp = checkView || (projection && report) ? <HelpHint label="About these results" bodyId="investigate-help">
    {checkView ? <p>{INVARIANTS_HELP}</p> : null}
    {checkView?.reproduced ? <p>{EXPECTATIONS_HELP}</p> : null}
    {projection && report ? <p>Operation duration: unavailable — this projection does not provide authorized start/end boundaries. Scenario virtual end time is not operation latency; browser playback speed is not simulated performance.</p> : null}
  </HelpHint> : null;
  const runOverview = projection && report ? <div className="execution-overview">
    <p><strong>{imported ? importedScenario?.presentation.title : loadedChoice?.id === "response-lost" ? "Lost processor response" : "Normal checkout"}</strong> — {summary}</p>
    {investigateHelp}
    <div className="evidence-links">{report.evidence.map(item => <button key={item.observationId} type="button" onClick={() => showEvidence(item.observationId)}>{item.label}</button>)}</div>
    <p>{report.knowledge}</p>
    <p>Recorded delivery attempts: {report.deliveries.length ? report.deliveries.map(item => `${item.destination}: attempt ${item.attempt} (${item.state})`).join("; ") : "Unavailable — no student-visible delivery records."}</p>
    {imported ? null : <p>Investigate: Which record proves authorization? What does Payments know after the timeout? A timeout does not prove that authorization was undone.</p>}
  </div> : null;
  const lessonGoal = imported && importedScenario
    ? <ImportedHeader document={importedScenario} origin={snapshot.session?.origin} runId={projection?.simulation.runId} />
    : <>
      <p className="lesson-goal-title"><strong>{loadedChoice ? experimentLabel(loadedChoice) : null}</strong></p>
      {loadedChoice?.family === "commerce" ? null
        : <p className="lesson-goal-question">{loadedChoice?.id === "response-lost" ? "Does a timeout mean the payment failed?" : "How does a checkout travel through a distributed system?"}</p>}
      <p>{loadedChoice?.family === "commerce" ? loadedChoice.description : "Explore the architecture, run the scenario, then follow its recorded story."}</p>
      {loadedChoice && designStepUnavailable(loadedChoice.policy) ? <p className="design-step-notice" role="note">{DESIGN_STEP_NOTICE}</p> : null}
    </>;
  const lessonRun = <>
    <p role="status" aria-label="Lesson state" aria-live="polite">{lessonState}</p>
    <p>Step advances one scheduled event. Pause takes effect at an event boundary. Reset starts the loaded scenario again.</p>
    <p>Reset and run again to compare the same virtual-time history.</p>
  </>;
  // The outcome comes first, then the verdicts or the evidence links, then the lesson's questions.
  // Commerce shows every student component's facts; checkout shows Distributed state, whose evidence
  // buttons close the dialog before Recorded history takes focus.
  const closeServiceState = () => {
    setServiceStateOpen(false);
    serviceStateOpener.current?.focus();
  };
  const serviceState = projection ? commerce ? <ServiceStateGrid projection={projection} />
    : report ? <DistributedState report={report} onShowEvidence={id => { setServiceStateOpen(false); showEvidence(id); }} /> : null : null;
  const lessonInvestigate = <>
    {/* An imported document's checks lead ③ Investigate, as a packaged lesson's do (#160); the Architecture tab holds only the graph. */}
    {imported && importedScenario && projection ? <ImportedChecks projection={projection} document={importedScenario} onShowEvidence={showEvidence} /> : null}
    {checkView ? <>
      <p className="lesson-outcome"><strong>{summary}</strong></p>
      {investigateHelp}
      <LessonChecks view={checkView} onShowEvidence={showEvidence} />
    </> : null}
    {runOverview}
    {imported ? <p>Seed: {lesson?.seed}. This scenario was imported from a file, so no packaged lesson copy applies. Run it, read its checks above, then use Recorded history to follow what happened.</p>
      : !checkoutGuide ? <p>Seed: {lesson?.seed}. Observe the service state, then use Recorded history to follow database commits, faults, messages, and runtime logs.</p> : <>
      <p>Objective: follow a checkout request and compare the customer-facing result with the processor’s recorded state. Changing the experiment after a session is loaded replaces the worker session and does not edit rules during a run.</p>
      {loadedChoice ? <p>Scenario details: {report?.scenarioName}; seed {report?.seed}; version and fault rule are available in the recorded scenario definition.</p> : null}
      <p>Load a checkout, inspect the four component categories and their links, then Run, Pause, or Step through the timeline. Select a row to follow request or message movement and inspect each component’s state.</p>
      <p>For the response-lost experiment, find the processor authorization, the dropped response, and the Payments timeout. What does Payments know, and what does the processor know? Does the timeout prove that payment failed?</p>
    </>}
    {/* What each service knows right now, in one dialog for both families (#142). */}
    {serviceState ? <button ref={serviceStateOpener} type="button" className="show-service-state" aria-haspopup="dialog" aria-expanded={serviceStateOpen}
      disabled={!projection} onClick={() => setServiceStateOpen(true)}>Show service state</button> : null}
  </>;
  const appliedChanges = snapshot.session ? `${snapshot.session.overlay.parameters.length ? ` · ${describeChoices(snapshot.session.overlay.parameters)}` : ""} · ${appliedEntries.length ? `${appliedEntries.length} student fault${appliedEntries.length === 1 ? "" : "s"}` : "packaged faults only"}` : "";
  const lessonExperiment = <>
    {imported ? <>
      {/* Without an overlay policy there is no Experiment drawer; say so where the scenario is described (ADR-006). */}
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
    {/* The one way to change a session: the Experiment drawer (#143). */}
    {experimentDrawer ? <button ref={drawerTrigger} type="button" className="experiment-trigger" aria-expanded={drawerOpen} aria-controls="experiment-drawer"
      onClick={() => drawerOpen ? closeDrawer() : setDrawerOpen(true)}>
      Change the experiment…{experimentPending || choicesInvalid ? <span className="experiment-badge"> unapplied changes</span> : null}
    </button> : null}
    {/* An instructor's authoring aid. It is offered only for a packaged lesson, never for an imported document. */}
    {imported || !loadedChoice ? null : <button type="button" className="save-starter" onClick={saveStarter}>Save as scenario file</button>}
    {/* Engine counters stay here; Distributed state moved to the Service state dialog (#142). */}
    {projection && report ? <details className="raw-state advanced-diagnostics">
      <summary>Advanced diagnostics</summary>
      <dl className="diagnostics" aria-label="Engine counters">
        <dt>Random draws</dt><dd>{projection.simulation.randomDrawCount}</dd>
        <dt>Observations</dt><dd>{projection.history.observations.length}</dd>
      </dl>
    </details> : null}
  </>;
  // When a run ends, ③ Investigate is revealed and its summary announced once (#141). Focus does not
  // move. Leaving the ended state (Reset, a new load) clears the region silently, so the next run's
  // identical summary is announced again.
  const [announcement, setAnnouncement] = useState("");
  const [revealToken, setRevealToken] = useState(0);
  const previousStatus = useRef(status);
  useEffect(() => {
    const before = previousStatus.current;
    previousStatus.current = status;
    if (endsRun(status) && !endsRun(before)) {
      setAnnouncement(summary ?? "");
      setRevealToken(token => token + 1);
    } else if (!endsRun(status)) setAnnouncement("");
  }, [status, summary]);
  const lessonPanel = assessment ? <LessonPanel collapsed={lessonCollapsed} onCollapsedChange={setLessonCollapsed}
    step={suite.results.length && !suiteActive ? "investigate" : "run"}
    goal={<AssessmentGoal choice={assessment} />} run={<AssessmentRun choice={assessment} suite={suite} busy={commandBusy} />}
    investigate={<AssessmentInvestigate choice={assessment} suite={suite} onShowResults={() => showTab("assessment")} />}
    experiment={<AssessmentExperiment />} />
    : <LessonPanel collapsed={lessonCollapsed} onCollapsedChange={setLessonCollapsed}
    step={currentStep(status, projection?.simulation.processedEvents)}
    goal={lessonGoal} run={lessonRun} investigate={lessonInvestigate} experiment={lessonExperiment} revealInvestigate={revealToken} />;
  const workspaceTabs = assessment ? assessmentTabs : tabs;

  // The top bar (#144) is one row and identical on both tabs: name, lesson trigger, Simulation
  // execution, and the run summary. Errors get their own row under it, only while one exists.
  return <main className="app-shell">
    <header className="command-toolbar top-bar">
      <div className="brand"><h1>DistLab</h1></div>
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
        <p id="scenario-help" className="sr-only">Choose a distributed-systems lesson by topic, or open an instructor’s scenario file. Choosing a lesson after a session is loaded replaces the worker session and does not edit rules during a run.</p>
      </div>
      <SimulationControls host={host} snapshot={snapshot} locked={suiteActive} />
      <ThemeSelector />
    </header>
    <SimulationAlert snapshot={snapshot} notices={mark ? <p className="terminal-history" role="status" aria-label="Terminal history">{terminalCopy(mark)}</p> : null} />
    {unreadFile ? <DocumentDiagnostics fileName={unreadFile.name} diagnostics={unreadFile.diagnostics} loaded={projection !== null} /> : null}
    {projection || assessment ? <div className="investigation-workspace has-lesson-panel">
      {lessonPanel}
      <div className={`workspace-main${drawerOpen && experimentDrawer ? " experiment-open" : ""}`}>
        <div className="workspace-navigation">
        <div className="workspace-tabs" role="tablist" aria-label="Investigation workspace" onKeyDown={onTabKeyDown}>
          {workspaceTabs.map(([id, label]) => <button key={id} type="button" role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id} aria-controls={`${id}-panel`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "is-active" : undefined}
            onClick={() => showTab(id)}>{label}</button>)}
        </div>
        </div>
        {/* Docked beside both tab panels and non-modal, so Pick on graph keeps working. */}
        {experimentDrawer}
        {assessment ? <section id="assessment-panel" className="panel-assessment" role="tabpanel" tabIndex={-1}
          aria-labelledby="tab-assessment" hidden={tab !== "assessment"}>
          <AssessmentMatrix choice={assessment} suite={suite} busy={busy} />
        </section> : null}
        {projection ? <>
        <section id="architecture-panel" className="panel-architecture" role="tabpanel" tabIndex={-1}
          aria-labelledby="tab-architecture" hidden={tab !== "architecture"}>
          {/* Replay lives where the graph is (#144): a one-row toolbar above it. */}
          <FlightControls playback={playback} />
          <ArchitectureView architecture={projection.architecture} sessionKey={`${sessionName}:${snapshot.attempt}`} playback={playback}
            {...(marks ? { faultMarks: marks } : {})} {...(picking ? { onPick: onGraphPick } : {})}
            {...(lesson ? { metadata: lesson.architecture, scenarioName: lesson.name } : {})}
            {...(emphasis ? { emphasis, ...(emphasis.text !== undefined ? { movementText: emphasis.text } : {}) } : {})}
            {...(commerce ? { inspectorFacts: (componentId: string) => <CommerceFacts projection={projection} componentId={componentId} /> } : report ? { inspectorFacts: (componentId: string) => <ComponentRuntimeFacts report={report} componentId={componentId} /> } : {})} />
        </section>
        <div id="history-panel" className="panel-history" role="tabpanel" tabIndex={-1}
          aria-labelledby="tab-history" hidden={tab !== "history"}>
          <TimelineView key={timelineKey} observations={projection.history.observations} edges={edges} componentTitles={componentTitles} checkLabels={checkLabels} onEmphasis={onEmphasis}
            {...(evidenceFocus ? { focusedObservationId: evidenceFocus.id, focusToken: evidenceFocus.token } : {})} />
        </div>
        </> : <section className="panel-loading" role="tabpanel" aria-labelledby={`tab-${tab}`} hidden={tab === "assessment"}>
          {/* Between two assessment rows the worker holds no session yet. */}
          <p>Loading the next run…</p>
        </section>}
      </div>
    </div> : overlayError && (loadedChoice || imported) ? <div className="investigation-workspace has-lesson-panel">
      {lessonPanel}
      <div className={`workspace-main${drawerOpen && experimentDrawer ? " experiment-open" : ""}`}>{experimentDrawer}</div>
    </div> : documentError ? <div className="investigation-workspace">
      <DocumentDiagnostics fileName={documentError.name} diagnostics={documentError.diagnostics} loaded={false} />
    </div> : <div className="investigation-workspace">
      <section className="workspace-empty" tabIndex={-1}>
        <p className="eyebrow">A deterministic laboratory for distributed systems</p>
        <h2>What can one component know about the others?</h2>
        <p>Distributed systems fail partially: a response is lost, a copy falls behind, two writers race, a slow dependency drags its callers down. Each lesson runs a small system of services on a virtual clock with a fixed seed, so every run replays exactly. Most lessons pair a flawed design with its correction under the same faults.</p>
        <h3 className="empty-topics-title">Topics</h3>
        <ul className="empty-topics">
          {lessonTopics.map(topic => <li key={topic.id}>
            <button type="button" disabled={busy} aria-haspopup="dialog" aria-describedby={`empty-topic-${topic.id}`}
              onClick={event => openChooser(event.currentTarget, topic.id)}>{topic.title}</button>
            <span id={`empty-topic-${topic.id}`}>{topic.summary}</span>
          </li>)}
        </ul>
        <h3 className="empty-topics-title">How to work through a lesson</h3>
        <ol><li><button type="button" className="empty-choose-lesson" disabled={busy} aria-haspopup="dialog" onClick={event => openChooser(event.currentTarget)}>Choose a lesson</button>, or open an instructor’s scenario file.</li><li>Predict the outcome, then run the simulation and follow each message between components.</li><li>Explain the result from the recorded history, then compare it with the paired design.</li></ol>
      </section>
    </div>}
    <p className="sr-only" role="status" aria-live="polite" aria-label="Lesson outcome">{announcement}</p>
    <ServiceStateDialog open={serviceStateOpen && serviceState !== null} time={projection?.simulation.time} onClose={closeServiceState}>{serviceState}</ServiceStateDialog>
    <LessonChooser key={chooserOpening.count} initialTopic={chooserOpening.topic} open={chooserOpen} lessons={scenarios} assessments={assessments}
      current={assessment ? `assessment:${assessment.id}` : imported ? null : loadedChoice?.id ?? null} busy={busy}
      discardsDraft={choicesPending || faultsPending} onChoose={chooseLesson} onChooseAssessment={chooseAssessment} onClose={closeChooser} />
  </main>;
}
