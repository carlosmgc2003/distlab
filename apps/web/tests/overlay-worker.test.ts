import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue, RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, commerceAssessment, commerceCatalog, commerceDescriptors, commerceOverlayPolicy, commerceScenario, normalCheckout } from "@distlab/catalogs";
import { DeterministicScenarioEngine, composeOverlay } from "@distlab/scenario";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { SimulationHost } from "../src/host.ts";
import { isWorkerEvent } from "../src/protocol.ts";
import { FakeWorker, projection, session } from "./support.ts";
import { overlayFromDraft, sameOverlay } from "../src/break-faults.ts";
import { setResource, setSlotModel, setSlotOption, setSubscription } from "../src/design-edits.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";

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
  assert.deepEqual(loaded.session, { lesson: "checkout-normal@1", seed: "mvp-normal-001", overlay: dropResponse, origin: { kind: "packaged" } });
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

test("#97 D-8 a crash with a restart loads, keeps its restart in the session, and replays on reset", async () => {
  const { send, latest } = harness();
  const overlay = { version: 1, faults: [], parameters: [],
    scheduledFaults: [{ id: "student-crash", at: 2, kind: "fault", fault: { id: "student-crash-payments", kind: "crash", target: "payments" }, restart: { after: 10 } }] };
  const [loaded] = await send({ type: "load", scenario: normalCheckout, overlay: overlay as unknown as CanonicalValue });
  assert.ok(loaded?.type === "loaded", JSON.stringify(loaded));
  assert.deepEqual(loaded.session.overlay, overlay, "the session shows the student's entry, not the generated lifecycle actions");
  const initial = latest();
  await send({ type: "run" });
  const finished = latest();
  assert.equal(finished.simulation.status, "COMPLETED");
  const lifecycle = finished.history.observations.filter(item => item.type === "service.lifecycle.changed" && item.source === "payments")
    .map(item => `${item.time}:${(item.data as { after: string }).after}`);
  assert.deepEqual(lifecycle, ["0:RUNNING", "2:CRASHED", "12:STARTING", "13:RUNNING"]);
  await send({ type: "reset" });
  assert.deepEqual(latest(), initial);
  await send({ type: "run" });
  assert.deepEqual(latest(), finished);
});

test("#126: a RATE_LIMITED Messaging Provider loads as an overlay, NACKs rejected sends, and matches the headless run", async () => {
  const outage = (state: string, at: number, id: string) =>
    ({ id: `student-${id}`, at, kind: "fault", fault: { id: `student-${id}-fault`, kind: "external-availability", target: "messaging", state } });
  const overlay = { version: 1, faults: [], parameters: [], scheduledFaults: [outage("RATE_LIMITED", 80, "rate-limited"), outage("AVAILABLE", 110, "recovered")] };
  const { send, latest } = harness();
  const [loaded] = await send({ type: "load", scenario: commerceScenario("notifications-unbounded"), overlay: overlay as unknown as CanonicalValue });
  assert.ok(loaded?.type === "loaded", JSON.stringify(loaded));
  const initial = latest();
  // Run to t=90: the student projection shows the provider rate-limited.
  while ((latest().simulation.time as number) < 90) await send({ type: "step" });
  const during = latest().components.find(item => item.componentId === "messaging" && item.visibility === "student");
  assert.equal((during?.state as { availability?: string } | undefined)?.availability, "RATE_LIMITED");
  while (latest().simulation.status !== "COMPLETED") await send({ type: "run" });
  const finished = latest();
  const rejected = finished.history.observations.filter(item => item.type === "service.handler.failed" && (item.data as { code: string }).code === "EXTERNAL_RATE_LIMITED");
  assert.ok(rejected.length > 0, "a rejected send NACKs instead of ending the run");
  await send({ type: "reset" });
  assert.deepEqual(latest(), initial);
  await send({ type: "run" });
  assert.deepEqual(latest(), finished);

  const engine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
  const composed = composeOverlay(commerceScenario("notifications-unbounded"), commerceOverlayPolicy("notifications-unbounded"), overlay as unknown as CanonicalValue, value => engine.validate(value), commerceCatalog);
  assert.ok(composed.ok);
  const headless = engine.create(composed.document);
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

test("a design choice reaches the worker as a parameter override and Reset replays it", async () => {
  const { send, latest } = harness();
  const overlay = { version: 1, faults: [], scheduledFaults: [], parameters: [{ key: "idempotency", value: true }] };
  const [loaded] = await send({ type: "load", scenario: commerceScenario("retry-unsafe"), overlay: overlay as unknown as CanonicalValue });
  assert.ok(loaded?.type === "loaded", JSON.stringify(loaded));
  assert.deepEqual(loaded.session, { lesson: "retry-unsafe@1", seed: "commerce-classroom-1", overlay, origin: { kind: "packaged" } });
  const initial = latest();
  await send({ type: "run" });
  const finished = latest();
  assert.equal(finished.simulation.status, "COMPLETED");
  // Idempotency on: the retry returns the stored result, so the packaged invariant (one payment per order) holds.
  const client = finished.components.find(item => item.componentId === "client" && item.visibility === "student");
  const verdicts = (client?.state as { assertions?: { id: string; status: string }[] } | undefined)?.assertions ?? [];
  assert.deepEqual(verdicts.map(item => `${item.id} ${item.status}`), ["one-payment-per-order PASS"]);
  await send({ type: "reset" });
  assert.deepEqual(latest(), initial);
  await send({ type: "run" });
  assert.deepEqual(latest(), finished);

  // Setting the choice back to its default is the packaged lesson: the same runId as no overlay.
  const fresh = harness();
  await fresh.send({ type: "load", scenario: commerceScenario("retry-unsafe") });
  const packagedRun = fresh.latest().simulation.runId;
  const [restored] = await fresh.send({ type: "load", scenario: commerceScenario("retry-unsafe"), overlay: { version: 1, parameters: [{ key: "idempotency", value: false }] } });
  assert.ok(restored?.type === "loaded");
  assert.deepEqual(restored.session.overlay.parameters, [], "a default override is normalized away");
  assert.equal(fresh.latest().simulation.runId, packagedRun);
  assert.notEqual(initial.simulation.runId, packagedRun);

  // Out-of-range values are rejected with the overlay path.
  const [rejected] = await fresh.send({ type: "load", scenario: commerceScenario("retry-unsafe"), overlay: { version: 1, parameters: [{ key: "timeout", value: 0 }] } });
  assert.ok(rejected?.type === "error" && rejected.error.code === "INVALID_OVERLAY");
  assert.deepEqual((rejected.error.context as { diagnostics: unknown }).diagnostics, [{ path: "/parameters/0/value", code: "PARAMETER_VALUE" }]);
});

test("ARCH-AC-1: an overlay without architecture edits, or with empty ones, loads and resets every lesson kind as before", async () => {
  for (const scenario of [normalCheckout, commerceScenario("notifications-dlq")]) {
    const plain = harness();
    await plain.send({ type: "load", scenario });
    await plain.send({ type: "run" });
    const expected = plain.latest();
    for (const architecture of [{}, { slots: [], bindings: [], resources: [], subscriptions: [] }]) {
      const { send, latest } = harness();
      const [loaded] = await send({ type: "load", scenario, overlay: { version: 1, architecture } });
      assert.ok(loaded?.type === "loaded", JSON.stringify(loaded));
      assert.equal(Object.hasOwn(loaded.session.overlay, "architecture"), false, "an empty architecture normalizes to absent");
      const initial = latest();
      await send({ type: "run" });
      assert.deepEqual(latest(), expected);
      await send({ type: "reset" });
      assert.deepEqual(latest(), initial);
    }
  }
});

test("ARCH-AC-4/7: the worker checks architecture edits against its own catalog's allowance and a rejected design exposes no session", async () => {
  const { send } = harness();
  await send({ type: "load", scenario: normalCheckout });
  const [failure] = await send({ type: "load", scenario: normalCheckout, overlay: {
    version: 1, architecture: { bindings: [{ component: "payments", peer: "processor", target: "payment-processor" }] },
  } });
  assert.ok(failure?.type === "error", JSON.stringify(failure));
  assert.equal(failure.error.code, "INVALID_OVERLAY");
  const diagnostics = (failure.error.context as { diagnostics: { path: string; code: string }[] }).diagnostics;
  assert.deepEqual(diagnostics.map(item => `${item.path} ${item.code}`), ["/architecture/bindings/0 OVERLAY_LIMIT", "/architecture/bindings/0/component OVERLAY_NOT_ALLOWED"]);
  const [step] = await send({ type: "step" });
  assert.ok(step?.type === "error" && step.error.code === "INVALID_WORKER_COMMAND", "no old session stays exposed");
  // An allowance never travels in a command: neither beside the overlay nor inside it.
  const allowance = { slots: [], bindings: [{ component: "payments", peer: "processor", candidates: ["payment-processor"] }], resources: [], subscriptions: [], linkPolicy: {}, maxEdits: 5 };
  const [beside] = await send({ type: "load", scenario: normalCheckout, policy: { architecture: allowance } });
  assert.ok(beside?.type === "error" && beside.error.code === "INVALID_WORKER_COMMAND");
  const [inside] = await send({ type: "load", scenario: normalCheckout, overlay: { version: 1, policy: { architecture: allowance } } });
  assert.ok(inside?.type === "error" && inside.error.code === "INVALID_OVERLAY");
  assert.deepEqual((inside.error.context as { diagnostics: unknown }).diagnostics, [{ path: "/policy", code: "UNSUPPORTED" }]);
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

test("#112 a gap-lesson load of each draft-built design returns the overlay sent, so the draft is not pending after Apply", async () => {
  const gap = scenarios.find(choice => choice.id === "outbox-notifications-gap")!;
  const context = { allowance: gap.policy.architecture!, architecture: packagedMetadata(gap).architecture, descriptors: commerceDescriptors };
  const base = setSubscription(context, setResource(context, setSlotModel(context, undefined, "notifications", "commerce.notifications@1.0.0"),
    "notifications", "database", true), "notifications", "PaymentApproved", true);
  for (const design of [base, setSlotOption(context, base, "notifications", "idempotent", true)]) {
    const { send } = harness();
    const sent = overlayFromDraft([], [], design);
    const [loaded] = await send({ type: "load", scenario: gap.scenario, overlay: sent as unknown as CanonicalValue });
    assert.ok(loaded?.type === "loaded", JSON.stringify(loaded));
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.session.overlay)), JSON.parse(JSON.stringify(sent)));
    assert.ok(sameOverlay(overlayFromDraft([], [], design), loaded.session.overlay));
  }
});
