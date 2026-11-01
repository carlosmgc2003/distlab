import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, commerceScenario, normalCheckout } from "@distlab/catalogs";
import { DeterministicScenarioEngine } from "@distlab/scenario";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { SimulationHost } from "../src/host.ts";
import { isWorkerEvent } from "../src/protocol.ts";
import { FakeWorker, projection, session } from "./support.ts";

/** The issue's example: drop the first processor response on Normal checkout. */
const dropResponse = {
  version: 1,
  faults: [{ id: "student-fault-1", point: "network.response", source: "payment-processor", target: "payments", from: 0, occurrence: 1, probability: 1, maxApplications: 1, effect: { kind: "drop" } }],
  scheduledFaults: [],
  parameters: [],
} as const;

function harness() {
  const events: WorkerEvent[] = [];
  const adapter = new WorkerAdapter(event => { assert.ok(isWorkerEvent(event)); events.push(event); });
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
  return { events, send, latest };
}

test("load accepts a packaged lesson with an allowed overlay and returns the applied session", async () => {
  const { send, latest } = harness();
  const [loaded] = await send({ type: "load", scenario: normalCheckout, overlay: dropResponse as unknown as CanonicalValue });
  assert.ok(loaded?.type === "loaded", JSON.stringify(loaded));
  assert.deepEqual(loaded.session, { lesson: "checkout-normal@1", seed: "mvp-normal-001", overlay: dropResponse });
  const initial = latest();
  await send({ type: "run" });
  const finished = latest();
  assert.equal(finished.simulation.status, "COMPLETED");
  const observations = finished.history.observations;
  const matched = observations.filter(item => item.type === "fault.rule.matched").map(item => (item.data as { ruleId: string }).ruleId);
  assert.deepEqual(matched, ["student-fault-1"], "the student's rule ID is recorded");
  assert.ok(observations.some(item => item.type === "network.response.dropped"));
  assert.ok(observations.some(item => item.type === "network.request.timedout" && item.source === "payments"), "the lost-response story appears");

  // Reset replays the applied overlay: the same inputs, runId, and history.
  await send({ type: "reset" });
  assert.deepEqual(latest(), initial);
  await send({ type: "run" });
  assert.deepEqual(latest(), finished);

  // The worker applies exactly what the headless composition produces.
  const headless = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment })
    .create({ ...(normalCheckout as Record<string, CanonicalValue>), faults: dropResponse.faults as unknown as CanonicalValue });
  await headless.simulation.run();
  assert.deepEqual(finished.history.observations, structuredClone(headless.simulation.history.all()));
  assert.equal(finished.simulation.runId, headless.simulation.history.export().runId);
});

test("the same overlay and seed give identical history in fresh worker sessions", async () => {
  const exports: RuntimeProjectionSet[] = [];
  for (const cadence of ["run", "step"] as const) {
    const { send, latest } = harness();
    await send({ type: "load", scenario: normalCheckout, overlay: dropResponse as unknown as CanonicalValue });
    if (cadence === "run") await send({ type: "run", maxEvents: 3 });
    while (latest().simulation.status !== "COMPLETED") await send({ type: cadence === "run" ? "run" : "step" });
    exports.push(latest());
  }
  assert.deepEqual(exports[0], exports[1]);
});

test("absent and empty overlays reproduce the packaged session", async () => {
  const results = [];
  for (const overlay of [undefined, { version: 1 }, { version: 1, faults: [], scheduledFaults: [], parameters: [] }]) {
    const { send, latest } = harness();
    const [loaded] = await send({ type: "load", scenario: normalCheckout, ...(overlay ? { overlay } : {}) });
    assert.ok(loaded?.type === "loaded");
    assert.deepEqual(loaded.session.overlay, { version: 1, faults: [], scheduledFaults: [], parameters: [] });
    await send({ type: "run" });
    results.push(latest());
  }
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});

test("a disallowed or invalid overlay is rejected with overlay paths and exposes no session", async () => {
  const { send, events } = harness();
  await send({ type: "load", scenario: normalCheckout });
  const cases: [unknown, string[]][] = [
    [{ version: 1, faults: [{ ...dropResponse.faults[0], effect: { kind: "disconnect" } }] }, ["/faults/0/effect/kind OVERLAY_NOT_ALLOWED"]],
    [{ version: 1, faults: [{ ...dropResponse.faults[0], id: "my-rule" }] }, ["/faults/0/id OVERLAY_ID_PREFIX"]],
    [{ version: 1, faults: [{ ...dropResponse.faults[0], from: 10, until: 5 }, { ...dropResponse.faults[0], id: "student-ghost", source: "nobody" }] },
      ["/faults/0/until FAULT", "/faults/1/source UNKNOWN_COMPONENT"]],
    [{ version: 1, scheduledFaults: [{ id: "student-a", at: 0, kind: "fault", fault: { id: "student-b", kind: "external-availability", target: "payment-processor", state: "UNAVAILABLE" } }] },
      ["/scheduledFaults/0/fault/kind OVERLAY_NOT_ALLOWED"]],
    [{ version: 1, parameters: [{ key: "timeout", value: 1 }] }, ["/parameters/0/key UNKNOWN_PARAMETER"]],
  ];
  for (const [overlay, expected] of cases) {
    const [failure] = await send({ type: "load", scenario: normalCheckout, overlay });
    assert.ok(failure?.type === "error", JSON.stringify(failure));
    assert.equal(failure.error.code, "INVALID_OVERLAY");
    const diagnostics = (failure.error.context as { diagnostics: { path: string; code: string }[] }).diagnostics;
    assert.deepEqual(diagnostics.map(item => `${item.path} ${item.code}`), expected);
    const [step] = await send({ type: "step" });
    assert.ok(step?.type === "error");
    assert.equal(step.error.code, "INVALID_WORKER_COMMAND", "no old session stays exposed");
  }
  // Other lessons enforce their own policy: retry has no message bus to break.
  const retry = await send({ type: "load", scenario: commerceScenario("retry-unsafe"), overlay: { version: 1, faults: [{ id: "student-x", point: "message.delivery", from: 0, effect: { kind: "drop" } }] } });
  assert.ok(retry[0]?.type === "error" && retry[0].error.code === "INVALID_OVERLAY");
  // A changed packaged document is still INVALID_SCENARIO, checked before the overlay.
  const [forged] = await send({ type: "load", scenario: { ...(normalCheckout as object), faults: dropResponse.faults }, overlay: { version: 1, faults: [{ id: "nope" }] } });
  assert.ok(forged?.type === "error" && forged.error.code === "INVALID_SCENARIO");
  assert.ok(!events.some(event => event.type === "loaded" && event.requestId !== "r1"));
});

test("the host sends the draft overlay inside load and exposes the applied session with the projection", async () => {
  const worker = new FakeWorker();
  const host = new SimulationHost(() => worker);
  const overlay = { version: 1, faults: [], scheduledFaults: [], parameters: [] };
  const loaded = host.load({ name: "packaged" }, overlay);
  assert.deepEqual(worker.last(), { version: 1, requestId: worker.last().requestId, type: "load", scenario: { name: "packaged" }, overlay });
  assert.equal(host.getSnapshot().session, null);
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "loaded", projection: projection(), session: session() });
  await loaded;
  assert.deepEqual(host.getSnapshot().session, session());
  const reset = host.reset();
  assert.deepEqual(Object.keys(worker.last()).sort(), ["requestId", "type", "version"], "reset takes no overlay");
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "projection.updated", projection: projection() });
  await reset;
  assert.deepEqual(host.getSnapshot().session, session(), "reset keeps the applied session");
  const rejected = host.load({ name: "packaged" }, { version: 1, faults: [{ id: "bad" }] });
  worker.emit({ version: 1, requestId: worker.last().requestId, type: "error", error: { code: "INVALID_OVERLAY", message: "rejected", context: { diagnostics: [{ path: "/faults/0/id", code: "OVERLAY_ID_PREFIX" }] } } });
  await assert.rejects(rejected);
  assert.equal(host.getSnapshot().projection, null);
  assert.equal(host.getSnapshot().session, null);
  assert.equal(host.getSnapshot().error?.code, "INVALID_OVERLAY");
  assert.equal(host.load({}).constructor, Promise);
  assert.deepEqual(Object.keys(worker.last()).sort(), ["requestId", "scenario", "type", "version"], "an absent overlay is not sent");
});
