import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, normalCheckout, responseLostCheckout } from "@distlab/catalogs";
import { DeterministicScenarioEngine } from "@distlab/scenario";
import { inspectFaults } from "../src/fault-inspection.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

const hiddenKeys = ["effectCount", "admittedCount", "rejectedCount", "suppressedCount", "tasks", "callbacks", "actions", "availability", "secret"];

function latest(events: readonly WorkerEvent[]): RuntimeProjectionSet {
  const event = events.filter(item => item.type === "loaded" || item.type === "projection.updated").at(-1);
  assert.ok(event && "projection" in event);
  return event.projection;
}

async function drive(scenario: CanonicalValue, events: WorkerEvent[], adapter: WorkerAdapter, type: "load" | "run" | "reset"): Promise<RuntimeProjectionSet> {
  const requestId = `${type}:${events.length}`;
  await adapter.receive({ version: 1, requestId, type, ...(type === "load" ? { scenario } : {}) });
  return latest(events);
}

function assertPlainData(value: unknown): void {
  assert.notEqual(typeof value, "function");
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) assertPlainData(child);
}

test("response-lost selection shows remote authorization and local timeout as distinct facts", async () => {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  const scenario = packagedMetadata(scenarios.find(item => item.id === "response-lost")!);
  const finished = await drive(responseLostCheckout, events, adapter, "load").then(() => drive(responseLostCheckout, events, adapter, "run"));
  assert.equal(finished.simulation.status, "COMPLETED");
  const report = inspectFaults(finished, scenario);
  const headless = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment }).create(responseLostCheckout);
  await headless.simulation.run();
  const assessed = headless.projection();
  const payment = (assessed.databases as { payments: { tables: { payments: Record<string, { state: string; outcome: string; authorizationId: string | null }> } } }).payments.tables.payments["payment-1"];
  const visible = (assessed.components as { "payment-processor": { visible: { authorizations: { authorizationId: string; status: string }[] } } })["payment-processor"].visible.authorizations;

  assert.equal(report.scenarioName, "checkout-processor-response-lost@1");
  assert.equal(report.seed, "mvp-response-lost-001");
  assert.equal(report.faultStatus, "selected");
  assert.equal(report.faults[0]?.id, "drop-first-processor-authorize-response");
  assert.equal(report.faults[0]?.effect, "drop");
  assert.equal(report.paymentRows[0]?.state, "UNKNOWN");
  assert.equal(report.paymentRows[0]?.outcome, "NETWORK_TIMEOUT");
  assert.equal(report.paymentRows[0]?.authorizationId, null);
  assert.equal(report.paymentRows[0]?.state, payment?.state);
  assert.equal(report.paymentRows[0]?.outcome, payment?.outcome);
  assert.equal(report.authorizations[0]?.authorizationId, "authorization-1");
  assert.equal(report.authorizations[0]?.status, "APPROVED");
  assert.equal(report.authorizations[0]?.authorizationId, visible[0]?.authorizationId);
  assert.notEqual(report.paymentRows[0]?.outcome, report.authorizations[0]?.status);
  assert.match(report.knowledge, /NETWORK_TIMEOUT/);
  assert.match(report.knowledge, /authorization-1 APPROVED/);
  assert.match(report.knowledge, /different facts/);
  assert.match(report.knowledge, /not proof of denial or rollback/);
  assert.doesNotMatch(report.knowledge, /payment failed|timeout proves|proves that the payment/i);
  assert.equal(report.orders?.rows.some(row => row.table === "orders" && row.fields.some(field => field.name === "state" && field.value === "CREATED")), true);
  assert.equal(report.orders?.lifecycle, "RUNNING");
  assert.equal(report.paymentsService?.lifecycle, "RUNNING");
  assert.equal(report.deliveries[0]?.state, "ACKED");
  const authorization = report.evidence.find(item => item.type === "external.effect.committed");
  const dropped = report.evidence.find(item => item.type === "network.response.dropped");
  const timeout = report.evidence.find(item => item.type === "network.request.timedout");
  const fault = report.evidence.find(item => item.type === "fault.effect.selected");
  assert.ok(authorization && dropped && timeout && fault);
  assert.ok(authorization.sequence < dropped.sequence && dropped.sequence < timeout.sequence);
  assert.equal(JSON.stringify(report).includes("PRIVATE_STATE_SENTINEL"), false);
  for (const item of finished.components.filter(entry => entry.visibility === "student")) {
    assert.equal(Object.isFrozen(item.state), true);
    assertPlainData(item.state);
    for (const key of hiddenKeys) assert.equal(JSON.stringify(item.state).includes(`"${key}"`), false, key);
  }

  const replayed = await drive(responseLostCheckout, events, adapter, "reset").then(() => drive(responseLostCheckout, events, adapter, "run"));
  assert.deepEqual(inspectFaults(replayed, scenario), report);
});

test("normal selection keeps the authorization and records no response-drop", async () => {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  const scenario = packagedMetadata(scenarios.find(item => item.id === "normal")!);
  await drive(normalCheckout, events, adapter, "load");
  const ready = inspectFaults(latest(events), scenario);
  assert.equal(ready.faultStatus, "not recorded");
  assert.equal(ready.paymentRows.length, 0);
  assert.equal(ready.authorizations.length, 0);
  assert.doesNotMatch(ready.knowledge, /NETWORK_TIMEOUT/);
  const finished = await drive(normalCheckout, events, adapter, "run");
  const report = inspectFaults(finished, scenario);
  assert.equal(report.scenarioName, "checkout-normal@1");
  assert.equal(report.seed, "mvp-normal-001");
  assert.equal(report.faults.length, 0);
  assert.equal(report.paymentRows[0]?.state, "AUTHORIZED");
  assert.equal(report.paymentRows[0]?.outcome, "APPROVED");
  assert.equal(report.paymentRows[0]?.authorizationId, "authorization-1");
  assert.equal(report.authorizations[0]?.status, "APPROVED");
  assert.match(report.knowledge, /matches a visible processor authorization/);
  assert.match(report.knowledge, /not proof of denial or rollback/);
  assert.equal(report.evidence.some(item => item.type === "network.request.timedout" || item.type === "network.response.dropped" || item.type === "fault.effect.selected"), false);
  assert.equal(finished.history.observations.some(item => item.type === "network.response.dropped"), false);
});

test("switching experiments replaces the session and drops the previous timeout", async () => {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => events.push(event));
  const lostScenario = packagedMetadata(scenarios.find(item => item.id === "response-lost")!);
  const normalScenario = packagedMetadata(scenarios.find(item => item.id === "normal")!);
  await drive(responseLostCheckout, events, adapter, "load");
  const lost = await drive(responseLostCheckout, events, adapter, "run");
  assert.equal(inspectFaults(lost, lostScenario).paymentRows[0]?.outcome, "NETWORK_TIMEOUT");
  const ready = await drive(normalCheckout, events, adapter, "load");
  const readyReport = inspectFaults(ready, normalScenario);
  assert.equal(ready.simulation.status, "READY");
  assert.equal(ready.simulation.processedEvents, 0);
  assert.equal(readyReport.paymentRows.length, 0);
  assert.equal(readyReport.authorizations.length, 0);
  assert.equal(readyReport.faultStatus, "not recorded");
  assert.doesNotMatch(readyReport.knowledge, /NETWORK_TIMEOUT/);
  const lostIds = new Set(lost.history.observations.map(item => item.id));
  assert.equal(ready.history.observations.some(item => lostIds.has(item.id)), false);
  const finished = await drive(normalCheckout, events, adapter, "run");
  const report = inspectFaults(finished, normalScenario);
  assert.equal(report.paymentRows[0]?.state, "AUTHORIZED");
  assert.equal(finished.history.observations.some(item => item.type === "network.request.timedout"), false);
});

test("inspection ignores host-only secrets and does not invent checkout rows", () => {
  const projection = {
    architecture: { components: [], links: [] },
    simulation: { runId: "test", status: "READY", time: 0, pendingEvents: 0, processedEvents: 0, randomDrawCount: 0 },
    history: { observations: [] },
    components: [{ componentId: "orders", visibility: "host", state: { secret: "PRIVATE_STATE_SENTINEL", effectCount: 4, tasks: [{ name: "TASK_SENTINEL" }] } }],
  } as unknown as RuntimeProjectionSet;
  const report = inspectFaults(projection, packagedMetadata(scenarios[0]!));
  assert.equal(report.studentFactsPresent, false);
  assert.equal(report.orders, null);
  assert.equal(report.paymentRows.length, 0);
  const encoded = JSON.stringify(report);
  assert.equal(encoded.includes("PRIVATE_STATE_SENTINEL"), false);
  assert.equal(encoded.includes("effectCount"), false);
  assert.equal(encoded.includes("TASK_SENTINEL"), false);
});
