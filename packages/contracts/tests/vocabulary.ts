/**
 * Compile-time lock that spec public names are exported. This file is
 * typechecked, not executed.
 */
import type {
  ArchitectureEdits,
  AssessmentCell,
  AssessmentConfiguration,
  AssessmentDefinition,
  AssessmentResult,
  AssessmentRow,
  AssessmentRowResult,
  AssessmentVerdict,
  BindingEdit,
  BusMessage,
  CatalogReference,
  ComponentId,
  Duration,
  LessonArchitectureAllowance,
  LessonOverlayPolicy,
  ModelDescriptor,
  ModelWorkloadCall,
  NetworkRequest,
  ResourceEdit,
  Observation,
  ScenarioDefinition,
  ScenarioDocument,
  ScenarioDocumentPresentation,
  ScheduledEvent,
  ServiceDefinition,
  SessionIdentity,
  SessionOrigin,
  SessionOverlay,
  Simulation,
  SimulationTime,
  SlotEdit,
  SubscriptionEdit,
  VirtualClock,
  WorkerCommand,
  WorkerEvent,
} from "../src/index.ts";

type Vocabulary = {
  SimulationTime: SimulationTime;
  ComponentId: ComponentId;
  ScheduledEvent: ScheduledEvent;
  Observation: Observation;
  Simulation: Simulation;
  VirtualClock: VirtualClock;
  BusMessage: BusMessage;
  NetworkRequest: NetworkRequest;
  ServiceDefinition: ServiceDefinition;
  ScenarioDefinition: ScenarioDefinition;
  SessionOverlay: SessionOverlay;
  SessionIdentity: SessionIdentity;
  LessonOverlayPolicy: LessonOverlayPolicy;
  CatalogReference: CatalogReference;
  ScenarioDocumentPresentation: ScenarioDocumentPresentation;
  ScenarioDocument: ScenarioDocument;
  SessionOrigin: SessionOrigin;
  ModelDescriptor: ModelDescriptor;
  ModelWorkloadCall: ModelWorkloadCall;
  SlotEdit: SlotEdit;
  BindingEdit: BindingEdit;
  ResourceEdit: ResourceEdit;
  SubscriptionEdit: SubscriptionEdit;
  ArchitectureEdits: ArchitectureEdits;
  LessonArchitectureAllowance: LessonArchitectureAllowance;
  AssessmentDefinition: AssessmentDefinition;
  AssessmentRow: AssessmentRow;
  AssessmentConfiguration: AssessmentConfiguration;
  AssessmentVerdict: AssessmentVerdict;
  AssessmentCell: AssessmentCell;
  AssessmentRowResult: AssessmentRowResult;
  AssessmentResult: AssessmentResult;
};

declare const vocabulary: Vocabulary;
void vocabulary;

/** ADR-006: a `load` carries exactly one of `scenario` and `document`. */
const overlay = { version: 1, faults: [], scheduledFaults: [], parameters: [] } as const;
const packagedLoad: WorkerCommand = { version: 1, requestId: "r1", type: "load", scenario: {} };
const documentLoad: WorkerCommand = { version: 1, requestId: "r2", type: "load", document: "{}", overlay: {} };
// @ts-expect-error A load must not carry both a packaged scenario and a document.
const bothLoad: WorkerCommand = { version: 1, requestId: "r3", type: "load", scenario: {}, document: "{}" };
// @ts-expect-error A load must carry a packaged scenario or a document.
const neitherLoad: WorkerCommand = { version: 1, requestId: "r4", type: "load" };
// @ts-expect-error An imported document is sent as raw text, never as a parsed value.
const parsedLoad: WorkerCommand = { version: 1, requestId: "r5", type: "load", document: {} };
void [packagedLoad, documentLoad, bothLoad, neitherLoad, parsedLoad];

/** ADR-005: architecture edits are optional, so every ADR-004 overlay and policy keeps its shape. */
const adr004Overlay: SessionOverlay = overlay;
const designed: SessionOverlay = {
  ...overlay,
  architecture: {
    slots: [{ component: "notifications", model: "commerce.inbox-notifications", version: "1", options: [] }],
    bindings: [{ component: "orders", peer: "processor", target: "gateway" }],
    resources: [{ owner: "orders", resource: "database", change: "attach" }],
    subscriptions: [{ consumer: "orders", destination: "OrderCreated", change: "unsubscribe" }],
  },
};
// @ts-expect-error A resource edit is an attach or a detach.
const renamed: ResourceEdit = { owner: "orders", resource: "database", change: "rename" };
void [adr004Overlay, designed, renamed];

/** ADR-006: every session states its origin; packaged sessions report `{ kind: "packaged" }`. */
const packagedSession: SessionIdentity = { lesson: "checkout-normal@1", seed: "mvp-normal-001", overlay, origin: { kind: "packaged" } };
const importedSession: SessionIdentity = {
  lesson: "processor-response-lost@1", seed: "processor-response-lost-1", overlay,
  origin: { kind: "imported", digest: "0".repeat(64), catalog: { id: "mvp.checkout", version: "1.0.0" } },
};
// @ts-expect-error SessionIdentity.origin is required.
const originless: SessionIdentity = { lesson: "checkout-normal@1", seed: "mvp-normal-001", overlay };
// @ts-expect-error An imported origin names its digest and catalog.
const bareImport: SessionOrigin = { kind: "imported" };
void [packagedSession, importedSession, originless, bareImport];

/** `loaded.document` is optional, so packaged `loaded` events stay valid. */
declare const projection: Extract<WorkerEvent, { type: "loaded" }>["projection"];
declare const document: ScenarioDocument;
const packagedLoaded: WorkerEvent = { version: 1, requestId: "r1", type: "loaded", projection, session: packagedSession };
const importedLoaded: WorkerEvent = { version: 1, requestId: "r2", type: "loaded", projection, session: importedSession, document };
void [packagedLoaded, importedLoaded];

/** docs/spec/assessment.md: a row reuses overlay fault shapes; a result carries no wall-clock time. */
const row: AssessmentRow = {
  id: "processor-response-lost", label: "Processor response lost",
  faults: [{ id: "student-row-lost-response", point: "network.response", source: "payment-processor", target: "payments",
    name: "POST /authorize", from: 0 as SimulationTime, probability: 1, maxApplications: 1, effect: { kind: "drop" } }],
  scheduledFaults: [{ id: "student-row-crash", at: 5 as SimulationTime, kind: "fault",
    fault: { id: "student-row-crash-fault", kind: "crash", target: "orders" }, restart: { after: 10 as Duration } }],
};
const assessment: AssessmentDefinition = {
  version: 1, id: "reliable-checkout-assessment@1", title: "Reliable Checkout", requirements: ["Charge a customer at most once."],
  base: "reliable-checkout@1", rows: [row], invariants: [{ id: "order-final", label: "Every order reaches a final state" }],
};
const incomplete: AssessmentCell = { invariant: "order-final", verdict: "INCOMPLETE", time: 40 as SimulationTime, evidence: null };
const result: AssessmentResult = {
  format: "distlab.assessment-result", formatVersion: 1, assessment: assessment.id, base: assessment.base, seed: "seed-1",
  configuration: { parameters: [{ key: "idempotency", value: true }] },
  rows: [{ row: row.id, runId: "run-1", status: "FAILED", cells: [incomplete] }],
};
// @ts-expect-error A verdict is HOLDS, VIOLATED, or INCOMPLETE; students never see a bare PASS.
const bare: AssessmentVerdict = "PASS";
// @ts-expect-error A row adds faults only; the configuration carries the parameters.
const parameterRow: AssessmentRow = { ...row, parameters: [] };
void [assessment, result, bare, parameterRow];

/** ADR-005 amendment (#122): `lessonData` is optional, so every existing descriptor keeps its shape. */
const plainDescriptor: ModelDescriptor = {
  model: "commerce.cache-orders", version: "1.0.0", kind: "service", actions: [], endpoints: ["POST /checkout"], consumers: [],
  operations: [], publishes: [], peers: [], storage: {}, options: [],
};
const withLessonData: ModelDescriptor = { ...plainDescriptor, model: "commerce.saga-resource", lessonData: ["compensated", "forward"] };
// @ts-expect-error Lesson data names configuration fields; it does not carry their values.
const lessonValues: ModelDescriptor = { ...plainDescriptor, lessonData: { forward: { reserved: true } } };
void [plainDescriptor, withLessonData, lessonValues];
