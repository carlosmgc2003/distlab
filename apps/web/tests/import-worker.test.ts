import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CanonicalValue, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { ScenarioDocumentLimits } from "@distlab/contracts";
import { checkoutCatalogReference, checkoutOverlayPolicy, commerceCatalogReference, commerceOverlayPolicy, commerceScenario, hostedCatalogs } from "@distlab/catalogs";
import { DeterministicScenarioEngine, validateScenarioDocument } from "@distlab/scenario";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { isWorkerEvent } from "../src/protocol.ts";
import { inspectFaults } from "../src/fault-inspection.ts";
import { messages } from "../src/i18n/catalog.ts";

// ADR-006 browser import, worker part: APP-AC-8, APP-AC-9 (replay), DOC-AC-3, DOC-AC-6,
// and the architecture-driven checkout projection.

const fixtureText = readFileSync(new URL("../../../examples/scenarios/processor-response-lost.json", import.meta.url), "utf8");
type Doc = Record<string, unknown>;
const fixture = () => JSON.parse(fixtureText) as Doc;
const text = (value: unknown) => JSON.stringify(value);

function harness() {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => { assert.ok(isWorkerEvent(event), JSON.stringify(event).slice(0, 300)); events.push(event); });
  let sequence = 0;
  const send = async (body: Record<string, unknown>) => {
    const requestId = `r${++sequence}`;
    await adapter.receive({ version: 1, requestId, ...body });
    return events.filter(event => event.requestId === requestId && event.type !== "accepted");
  };
  const latest = (): RuntimeProjectionSet => {
    const event = events.filter(item => item.type === "loaded" || item.type === "projection.updated").at(-1);
    assert.ok(event && "projection" in event);
    return event.projection;
  };
  const load = async (document: string, overlay?: unknown) => {
    const [event] = await send({ type: "load", document, ...(overlay === undefined ? {} : { overlay }) });
    return event!;
  };
  return { events, send, latest, load };
}

function student(projection: RuntimeProjectionSet, id: string): Record<string, CanonicalValue> {
  const entry = projection.components.find(item => item.componentId === id && item.visibility === "student");
  assert.ok(entry, `student state for ${id}`);
  return entry.state as Record<string, CanonicalValue>;
}

test("APP-AC-8 load with a valid document returns the imported session, the normalized document, and runs the vision §19 story", async () => {
  const { send, latest, load } = harness();
  const loaded = await load(fixtureText);
  assert.ok(loaded.type === "loaded", JSON.stringify(loaded));
  const validated = validateScenarioDocument(fixtureText, hostedCatalogs);
  assert.ok(validated.ok);
  assert.deepEqual(loaded.session, {
    lesson: "processor-response-lost@1", seed: "processor-response-lost-1",
    overlay: { version: 1, faults: [], scheduledFaults: [], parameters: [] },
    origin: { kind: "imported", digest: validated.digest, catalog: checkoutCatalogReference },
  });
  assert.match(validated.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(loaded.document, structuredClone(validated.document));
  assert.equal(loaded.document?.presentation.assertions?.["order-not-charged-twice"], "The customer is charged at most once.");

  await send({ type: "run" });
  const finished = latest();
  assert.equal(finished.simulation.status, "COMPLETED");
  assert.equal(finished.simulation.time, 1030);
  // The worker runs exactly what the headless engine runs from the validated document.
  const headless = new DeterministicScenarioEngine(validated.hosted).create(validated.scenario);
  await headless.simulation.run();
  assert.deepEqual(finished.history.observations, structuredClone(headless.simulation.history.all()));
  assert.equal(finished.simulation.runId, headless.simulation.history.export().runId);
  // Verdicts travel on the checkout client projection, as they do for commerce.
  const verdicts = student(finished, "customer-app").assertions as { id: string; status: string }[];
  assert.deepEqual(verdicts.map(item => [item.id, item.status]), [["order-not-charged-twice", "PASS"]]);
  assert.deepEqual((student(finished, "payment-processor").authorizations as { status: string }[]).map(item => item.status), ["APPROVED"]);
});

test("APP-AC-8 an invalid document returns INVALID_DOCUMENT with document-relative diagnostics and exposes no session", async () => {
  const { send, load } = harness();
  assert.equal((await load(fixtureText)).type, "loaded");
  const cases: [string, string[]][] = [
    [text({ ...fixture(), catalog: { id: "mvp.unknown", version: "1.0.0" } }), ["/catalog/id UNKNOWN_CATALOG"]],
    [text({ ...fixture(), catalog: { id: "mvp.checkout", version: "0.9.0" } }), ["/catalog/version CATALOG_VERSION"]],
    ["{", [" DOCUMENT_SYNTAX"]],
    ["", [" DOCUMENT_SYNTAX"]],
    [fixtureText.replace('"seed": "processor-response-lost-1",', '"seed": "processor-response-lost-1", "seed": "other",'), ["/scenario/seed DUPLICATE_KEY"]],
    [" ".repeat(ScenarioDocumentLimits.documentBytes + 1), [" DOCUMENT_SIZE"]],
    [text({ ...fixture(), formatVersion: 2 }), ["/formatVersion FORMAT_VERSION"]],
  ];
  for (const [document, expected] of cases) {
    const failure = await load(document);
    assert.ok(failure.type === "error", JSON.stringify(failure).slice(0, 200));
    assert.equal(failure.error.code, "INVALID_DOCUMENT");
    const diagnostics = (failure.error.context as { diagnostics: { path: string; code: string }[] }).diagnostics;
    assert.deepEqual(diagnostics.map(item => `${item.path} ${item.code}`), expected);
    const [step] = await send({ type: "step" });
    assert.ok(step?.type === "error");
    assert.equal(step.error.code, "INVALID_WORKER_COMMAND", "a rejected load leaves no runnable session");
    const [reset] = await send({ type: "reset" });
    assert.ok(reset?.type === "error");
  }
});

test("APP-AC-8 a load carries exactly one of scenario and document, and the document is text", async () => {
  const { send } = harness();
  for (const body of [{ scenario: {}, document: fixtureText }, { document: JSON.parse(fixtureText) }, {}]) {
    const [failure] = await send({ type: "load", ...body });
    assert.ok(failure?.type === "error");
    assert.equal(failure.error.code, "INVALID_WORKER_COMMAND");
  }
});

test("DOC-AC-3 worker: fresh loads, Reset, and step cadence reproduce the same runId and history", async () => {
  const runs: RuntimeProjectionSet[] = [];
  const loads: WorkerEvent[] = [];
  for (const cadence of ["run", "step"] as const) {
    const { send, latest, load } = harness();
    loads.push(await load(fixtureText));
    const initial = latest();
    if (cadence === "run") await send({ type: "run", maxEvents: 3 });
    while (latest().simulation.status !== "COMPLETED") await send({ type: cadence });
    const finished = latest();
    await send({ type: "reset" });
    assert.deepEqual(latest(), initial, "Reset replays the normalized document");
    await send({ type: "run" });
    assert.deepEqual(latest(), finished);
    runs.push(finished);
  }
  assert.deepEqual(runs[0], runs[1]);
  assert.deepEqual(loads[0], { ...loads[1]!, requestId: loads[0]!.requestId });

  const identity = async (document: string) => {
    const loaded = await harness().load(document);
    assert.ok(loaded.type === "loaded");
    assert.ok(loaded.session.origin.kind === "imported");
    return { digest: loaded.session.origin.digest, runId: loaded.projection.simulation.runId };
  };
  const original = await identity(fixtureText);
  // Whitespace and key order keep both the digest and the runId.
  const reordered = Object.fromEntries(Object.entries(fixture()).reverse());
  assert.deepEqual(await identity(JSON.stringify(reordered, null, 7)), original);
  // A presentation-only change changes the digest and keeps the runId.
  const retitled = await identity(text({ ...fixture(), presentation: { title: "Another title" } }));
  assert.notEqual(retitled.digest, original.digest);
  assert.equal(retitled.runId, original.runId);
  // A scenario change changes both.
  const reseeded = await identity(text({ ...fixture(), scenario: { ...(fixture().scenario as Doc), seed: "another-seed" } }));
  assert.notEqual(reseeded.digest, original.digest);
  assert.notEqual(reseeded.runId, original.runId);
});

const dropResponse = {
  version: 1,
  faults: [{ id: "student-fault-1", point: "network.response", source: "payment-processor", target: "payments", from: 0, occurrence: 1, probability: 1, maxApplications: 1, effect: { kind: "drop" } }],
  scheduledFaults: [], parameters: [],
};

test("DOC-AC-6 worker: without overlayPolicy only the empty overlay loads", async () => {
  const { load } = harness();
  for (const overlay of [undefined, { version: 1 }, { version: 1, faults: [], scheduledFaults: [], parameters: [] }]) {
    assert.equal((await load(fixtureText, overlay)).type, "loaded");
  }
  const rejected = await load(fixtureText, dropResponse);
  assert.ok(rejected.type === "error");
  assert.equal(rejected.error.code, "INVALID_OVERLAY");
  const diagnostics = (rejected.error.context as { diagnostics: { path: string; code: string }[] }).diagnostics;
  assert.ok(diagnostics.length > 0 && diagnostics.every(item => item.path.startsWith("/faults/0")), JSON.stringify(diagnostics));
});

test("DOC-AC-6 worker: the document's own policy governs its overlays, and Reset replays the applied overlay", async () => {
  const name = (fixture().scenario as Doc).name as string;
  const governed = text({ ...fixture(), overlayPolicy: { ...checkoutOverlayPolicy("normal"), lesson: name } });
  // The fixture's processor suppresses its own response, so the student delays the checkout request instead.
  const delayRequest = { ...dropResponse, faults: [{ id: "student-fault-1", point: "network.request", source: "customer-app", target: "orders", from: 0, occurrence: 1, probability: 1, maxApplications: 1, effect: { kind: "delay", duration: 50 } }] };
  const { send, latest, load } = harness();
  const loaded = await load(governed, delayRequest);
  assert.ok(loaded.type === "loaded", JSON.stringify(loaded).slice(0, 400));
  assert.deepEqual(loaded.session.overlay, delayRequest);
  assert.deepEqual(loaded.document?.overlayPolicy, { ...checkoutOverlayPolicy("normal"), lesson: name });
  const initial = latest();
  await send({ type: "run" });
  const finished = latest();
  assert.ok(finished.history.observations.some(item => item.type === "fault.rule.matched" && (item.data as { ruleId: string }).ruleId === "student-fault-1"));
  await send({ type: "reset" });
  assert.deepEqual(latest(), initial);
  await send({ type: "run" });
  assert.deepEqual(latest(), finished);

  // The policy allows no scheduled external-availability fault: rejected against the document's policy.
  const disallowed = await load(governed, { version: 1, faults: [], parameters: [],
    scheduledFaults: [{ id: "student-fault-1", at: 0, kind: "fault", fault: { id: "student-fault-1", kind: "external-availability", target: "payment-processor", state: "UNAVAILABLE" } }] });
  assert.ok(disallowed.type === "error");
  assert.equal(disallowed.error.code, "INVALID_OVERLAY");
});

test("DOC-AC-6 worker: a document's architecture allowance admits an allowed design and rejects a disallowed edit", async () => {
  const lesson = "outbox-notifications-gap";
  const name = "notifications-design-exam@1";
  const document = text({
    format: "distlab.scenario", formatVersion: 1, catalog: commerceCatalogReference,
    presentation: { title: "Design the notifications consumer" },
    scenario: { ...(commerceScenario(lesson) as Doc), name },
    overlayPolicy: { ...commerceOverlayPolicy(lesson), lesson: name },
  });
  const slot = { component: "notifications", model: "commerce.notifications", version: "1.0.0", options: [{ key: "idempotent", value: true }] };
  const design = { version: 1, architecture: {
    slots: [slot], resources: [{ owner: "notifications", resource: "database", change: "attach" }],
    subscriptions: [{ consumer: "notifications", destination: "PaymentApproved", change: "subscribe" }] } };
  const { send, latest, load } = harness();
  const loaded = await load(document, design);
  assert.ok(loaded.type === "loaded", JSON.stringify(loaded).slice(0, 400));
  assert.deepEqual(loaded.session.overlay.architecture?.slots, [slot]);
  await send({ type: "run" });
  // Commerce documents get the commerce student projection, chosen by catalog reference.
  const client = latest().components.find(item => item.visibility === "student" && (item.state as Doc).role === "commerce-client");
  const verdicts = (client?.state as { assertions: { id: string; status: string }[] }).assertions;
  assert.ok(verdicts.length > 0 && verdicts.every(item => item.status === "PASS"), JSON.stringify(verdicts));

  const disallowed = await load(document, { version: 1, architecture: { slots: [{ component: "payments", model: "commerce.notifications", version: "1.0.0", options: [] }] } });
  assert.ok(disallowed.type === "error");
  assert.equal(disallowed.error.code, "INVALID_OVERLAY");
  assert.deepEqual((disallowed.error.context as { diagnostics: { path: string; code: string }[] }).diagnostics.map(item => `${item.path} ${item.code}`),
    ["/architecture/slots/0/component OVERLAY_NOT_ALLOWED"]);
});

/** The vision fixture with every checkout component renamed; peers are bound through configuration (ADR-005). */
function renamedCheckout(): Doc {
  const ids: Record<string, string> = { "customer-app": "shopper", orders: "order-service", payments: "billing", "payment-processor": "psp" };
  const rename = (id: unknown) => ids[id as string] ?? id;
  const document = fixture();
  const scenario = document.scenario as Doc;
  const architecture = scenario.architecture as Doc;
  const components = (architecture.components as Doc[]).map(component => ({ ...component, id: rename(component.id),
    configuration: component.id === "customer-app" ? { orders: "order-service" } : component.id === "payments" ? { processor: "psp" } : component.configuration }));
  return { ...document, scenario: { ...scenario, name: "renamed-checkout@1",
    architecture: { ...architecture, components,
      links: (architecture.links as Doc[]).map(link => ({ ...link, source: rename(link.source), target: rename(link.target) })),
      databases: (architecture.databases as Doc[]).map(database => ({ ...database, owner: rename(database.owner) })),
      subscriptions: (architecture.subscriptions as Doc[]).map(subscription => ({ ...subscription, consumer: rename(subscription.consumer) })) },
    external: (scenario.external as Doc[]).map(entry => ({ ...entry, target: rename(entry.target) })),
    actions: (scenario.actions as Doc[]).map(action => ({ ...action, target: rename(action.target) })),
    // mvp.checkout@1.0.0's predicates read fixed component IDs, so this document states no checks;
    // the 1.1.0 variant below names the components in its assertions (#148).
    assertions: [] }, presentation: { title: "Renamed checkout" } };
}

test("#148: a renamed checkout document against mvp.checkout@1.1.0 names its components and its check passes, as the fixture's does", async () => {
  const original = fixture();
  const named = renamedCheckout();
  const assertions = ((original.scenario as Doc).assertions as Doc[]).map(assertion => ({ ...assertion,
    parameters: { ...(assertion.parameters as Doc), processor: "psp", payments: "billing", orders: "order-service" } }));
  const document = { ...named, catalog: { id: "mvp.checkout", version: "1.1.0" }, scenario: { ...(named.scenario as Doc), assertions } };
  const verdicts = async (value: Doc) => {
    const { send, latest, load } = harness();
    const loaded = await load(text(value));
    assert.ok(loaded.type === "loaded", JSON.stringify(loaded).slice(0, 600));
    await send({ type: "run" });
    const finished = latest();
    assert.equal(finished.simulation.status, "COMPLETED");
    const client = finished.components.find(item => item.visibility === "student" && Array.isArray((item.state as Doc).assertions));
    return { runId: finished.simulation.runId, verdicts: ((client?.state as Doc).assertions as Doc[]).map(item => `${String(item.id)}:${String(item.status)}`) };
  };
  const renamedRun = await verdicts(document);
  assert.deepEqual(renamedRun.verdicts, (await verdicts(original)).verdicts);
  assert.deepEqual(renamedRun.verdicts, ["order-not-charged-twice:PASS"]);
  // Equal inputs, equal run: a second fresh worker reproduces the runId.
  assert.equal((await verdicts(document)).runId, renamedRun.runId);
});

test("a checkout document with renamed component IDs shows correct student state", async () => {
  const { send, latest, load } = harness();
  const loaded = await load(text(renamedCheckout()));
  assert.ok(loaded.type === "loaded", JSON.stringify(loaded).slice(0, 600));
  await send({ type: "run" });
  const finished = latest();
  assert.equal(finished.simulation.status, "COMPLETED");
  const students = finished.components.filter(item => item.visibility === "student");
  assert.deepEqual(students.map(item => [item.componentId, (item.state as Doc).role]),
    [["shopper", "client-observed"], ["order-service", "service"], ["billing", "service"], ["psp", "external-visible"], ["OrderCreated", "bus-delivery"]]);
  const billing = student(finished, "billing");
  const payments = ((billing.committed as Doc).tables as Doc).payments as Record<string, Doc>;
  assert.deepEqual(Object.values(payments).map(row => [row.state, row.outcome]), [["UNKNOWN", "NETWORK_TIMEOUT"]]);
  assert.deepEqual((student(finished, "psp").authorizations as Doc[]).map(item => item.status), ["APPROVED"]);
  assert.equal((student(finished, "shopper").request as Doc | null) !== null, true);
  assert.ok((student(finished, "OrderCreated").records as Doc[]).length > 0);

  // The main-thread report finds each role by the component's model, not by a fixed ID.
  assert.ok(loaded.document);
  const report = inspectFaults(finished, loaded.document.scenario, messages("en"));
  assert.deepEqual(report.roles, { client: "shopper", orders: "order-service", payments: "billing", processor: "psp", destinations: ["OrderCreated"] });
  assert.equal(report.paymentRows[0]?.state, "UNKNOWN");
  assert.equal(report.authorizations[0]?.status, "APPROVED");
  assert.ok(report.evidence.some(item => item.label === "Show Payments timeout"));
  assert.ok(report.deliveries.length > 0);
});
