import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalValue } from "@distlab/contracts";
import { commerceAssessment, commerceCatalog, commerceScenario } from "@distlab/catalogs";
import { DeterministicScenarioEngine } from "@distlab/scenario";
import { applyEdits, editableFlags, editableLinks, hasEdits, noEdits, validateEdits } from "../src/experiment-edits.ts";
import type { ExperimentEdits } from "../src/experiment-edits.ts";

const run = async (scenario: CanonicalValue) => {
  const session = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment }).create(scenario);
  await session.simulation.run();
  return { observations: JSON.parse(JSON.stringify(session.simulation.history.export().observations)), results: session.results() };
};
const payments = (results: readonly { id: string; evidence: CanonicalValue }[]) =>
  Object.keys(results.find(result => result.id === "processed-payments")?.evidence as Record<string, unknown>).length;

test("lists links and boolean design switches from the scenario", () => {
  const scenario = commerceScenario("retry-unsafe");
  assert.deepEqual(editableLinks(scenario).map(link => link.key), ["client->payments"]);
  assert.deepEqual(editableFlags(scenario), [{ componentId: "payments", flag: "idempotent", value: false }]);
  assert.deepEqual(editableFlags(commerceScenario("outbox-unsafe-consumer")).map(flag => `${flag.componentId}.${flag.flag}`), ["payments.outbox", "notifications.idempotent"]);
});

test("no edits reproduce the packaged scenario and never mutate the input", () => {
  const scenario = commerceScenario("retry-unsafe");
  const before = JSON.stringify(scenario);
  assert.deepEqual(applyEdits(scenario, noEdits), scenario);
  assert.equal(hasEdits(scenario, noEdits), false);
  assert.equal(hasEdits(scenario, { ...noEdits, seed: "commerce-classroom-1" }), false);
  applyEdits(scenario, { seed: "x", links: { "client->payments": { timeout: 5 } }, flags: { payments: { idempotent: true } }, faults: [] });
  assert.equal(JSON.stringify(scenario), before);
});

test("retry-unsafe with idempotent=true records one payment instead of two", async () => {
  const scenario = commerceScenario("retry-unsafe");
  const unsafe = await run(scenario);
  const safe = await run(applyEdits(scenario, { ...noEdits, flags: { payments: { idempotent: true } } }));
  assert.equal(unsafe.results.find(result => result.id === "processed-payments")?.status, "PASS");
  assert.equal(payments(unsafe.results), 2);
  // The packaged check expects the unsafe outcome (two payments), so it now fails with one.
  assert.equal(safe.results.find(result => result.id === "processed-payments")?.status, "FAIL");
  assert.equal(payments(safe.results), 1);
});

test("the same seed and edits replay identically; another seed changes a random run", async () => {
  const scenario = commerceScenario("retry-unsafe");
  const edits = (seed: string): ExperimentEdits => ({ ...noEdits, seed, links: { "client->payments": { failureRate: 0.5, jitter: 3 } } });
  const first = await run(applyEdits(scenario, edits("seed-a")));
  const again = await run(applyEdits(scenario, edits("seed-a")));
  assert.deepEqual(again.observations, first.observations);
  const other = await run(applyEdits(scenario, edits("seed-b")));
  assert.notDeepEqual(other.observations, first.observations);
});

test("an added fault becomes an ordered rule that the run applies", async () => {
  const scenario = commerceScenario("retry-unsafe");
  const link = editableLinks(scenario)[0]!;
  const edited = applyEdits(scenario, { ...noEdits, faults: [{ link: link.key, point: "network.request", effect: "delay", name: "", from: 0, duration: 7 }] });
  const faults = (edited as { faults: { id: string; source: string; target: string; effect: unknown }[] }).faults;
  assert.deepEqual(faults.at(-1), { id: "experiment-fault-1", point: "network.request", source: link.source, target: link.target, from: 0, probability: 1, maxApplications: 1, effect: { kind: "delay", duration: 7 } });
  const result = await run(edited);
  assert.ok(result.observations.some((item: { type: string }) => item.type === "fault.effect.selected" && JSON.stringify(item).includes("experiment-fault-1")));
});

test("invalid values are reported and never applied", () => {
  const scenario = commerceScenario("retry-unsafe");
  const bad: ExperimentEdits = { seed: " ", links: { "client->payments": { timeout: 0, failureRate: 2, jitter: -1 } }, flags: { payments: { outbox: true } },
    faults: [{ link: "nope", point: "network.request", effect: "delay", name: "", from: -1, duration: 0 }] };
  assert.deepEqual(validateEdits(scenario, bad).map(problem => problem.path), [
    "seed", "links.client->payments.timeout", "links.client->payments.failureRate", "links.client->payments.jitter",
    "flags.payments.outbox", "faults.0.link", "faults.0.from", "faults.0.duration"]);
  assert.throws(() => applyEdits(scenario, bad), RangeError);
});

test("the worker loads an edited packaged scenario and still rejects unknown or invalid ones", async () => {
  const { WorkerAdapter } = await import("../src/worker/adapter.ts");
  const events: { type: string; projection?: unknown; error?: { code: string } }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as never));
  const scenario = commerceScenario("retry-unsafe");
  await adapter.receive({ version: 1, requestId: "a", type: "load", scenario: applyEdits(scenario, { ...noEdits, flags: { payments: { idempotent: true } } }) });
  assert.equal(events.at(-1)?.type, "loaded");
  await adapter.receive({ version: 1, requestId: "b", type: "load", scenario: { ...(scenario as object), name: "made-up@1" } });
  assert.equal(events.at(-1)?.type, "error");
  const broken = applyEdits(scenario, noEdits) as { architecture: { links: { policy: object }[] } };
  broken.architecture.links[0]!.policy = { ...broken.architecture.links[0]!.policy, timeout: 0 };
  await adapter.receive({ version: 1, requestId: "c", type: "load", scenario: broken as unknown as CanonicalValue });
  assert.equal(events.at(-1)?.type, "error");
});
