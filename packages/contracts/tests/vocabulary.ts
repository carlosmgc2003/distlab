/**
 * Compile-time lock that spec public names are exported. This file is
 * typechecked, not executed.
 */
import type {
  BusMessage,
  CatalogReference,
  ComponentId,
  LessonOverlayPolicy,
  NetworkRequest,
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
