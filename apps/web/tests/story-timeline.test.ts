import assert from "node:assert/strict";
import test from "node:test";
import type { Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { normalCheckout, responseLostCheckout } from "@distlab/catalogs";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { componentLabel } from "../src/timeline-query.ts";
import { orderObservations } from "../src/records.ts";
import { storyDetail, storyLanes, storyLegend, storyMilestones, storyReduction, storySummary } from "../src/story-timeline.ts";

const runs = new Map<string, Promise<RuntimeProjectionSet>>();

function completed(key: "normal" | "response-lost", scenario: typeof normalCheckout): Promise<RuntimeProjectionSet> {
  const cached = runs.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
    const adapter = new WorkerAdapter(event => events.push(event));
    await adapter.receive({ version: 1, requestId: "load", type: "load", scenario });
    await adapter.receive({ version: 1, requestId: "run", type: "run" });
    const projection = events.filter(event => event.type === "projection.updated").at(-1)?.projection;
    assert.ok(projection);
    return projection;
  })();
  runs.set(key, pending);
  return pending;
}

const labels: ReadonlyMap<string, string> = new Map([
  ["customer-app", componentLabel("customer-app", [])],
  ["orders", componentLabel("orders", [])],
  ["payments", componentLabel("payments", [])],
  ["payment-processor", componentLabel("payment-processor", [])],
]);

test("story milestones keep canonical sequence, identity, and lanes for both packaged checkouts", async () => {
  for (const [key, scenario] of [["normal", normalCheckout], ["response-lost", responseLostCheckout]] as const) {
    const { history } = await completed(key, scenario);
    const observations = history.observations;
    const ordered = orderObservations(observations);
    const milestones = storyMilestones(observations);
    const known = new Set(observations.map(observation => observation.id));
    assert.ok(milestones.length > 0);
    assert.ok(milestones.length < observations.length);
    for (const milestone of milestones) {
      assert.ok(known.has(milestone.observation.id));
      assert.equal(milestone.lane, milestone.observation.source);
      assert.ok(milestone.label.length > 0);
      assert.ok(milestone.shape.length > 0);
    }
    // Every milestone is the same object identity as its canonical record, in canonical order.
    const positions = milestones.map(milestone => ordered.indexOf(milestone.observation));
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
    const sequences = milestones.map(milestone => milestone.observation.sequence);
    assert.deepEqual(sequences, [...sequences].sort((left, right) => left - right));
    assert.equal(new Set(sequences).size, sequences.length);
    const lanes = storyLanes(milestones);
    assert.deepEqual(lanes, [...new Set(milestones.map(milestone => milestone.lane))]);
    const firstSeen = lanes.map(lane => Math.min(...milestones.filter(item => item.lane === lane).map(item => item.observation.sequence)));
    assert.deepEqual(firstSeen, [...firstSeen].sort((left, right) => left - right));
  }
});

test("story milestone projection is deterministic, order-insensitive, and read-only", async () => {
  const { history } = await completed("response-lost", responseLostCheckout);
  const observations = history.observations;
  const first = storyMilestones(observations);
  const second = storyMilestones(observations);
  assert.deepEqual(first, second);
  const reversed = [...observations].reverse();
  assert.deepEqual(storyMilestones(reversed), first);
  const before = JSON.stringify(observations);
  storyMilestones(observations);
  assert.equal(JSON.stringify(observations), before);
  const encoded = JSON.stringify(first);
  assert.deepEqual(JSON.parse(encoded), first);
});

test("story milestones keep only stored teaching records and never invent durations", async () => {
  const { history } = await completed("response-lost", responseLostCheckout);
  const observations = history.observations;
  const milestones = storyMilestones(observations);
  const types = new Set(milestones.map(milestone => milestone.observation.type));
  for (const type of [
    "network.request.sent", "network.request.delivered", "network.request.timedout",
    "network.response.sent", "network.response.dropped",
    "message.published", "message.delivered", "message.acknowledged", "message.retry.scheduled",
    "database.transaction.committed", "database.transaction.rolledback",
    "external.effect.committed", "fault.rule.matched", "fault.effect.selected",
  ]) assert.ok(types.has(type), `expected a milestone for ${type}`);
  for (const milestone of milestones) {
    assert.ok(!/scheduler\.|clock\.|simulation\.|scenario\.assertion\.|database\.write\.|database\.row\.|service\.handler\.|client\./.test(milestone.observation.type));
    assert.ok(!/\b(ms|msec|seconds?|latency|took|elapsed)\b/i.test(milestone.label));
  }
  const stored = new Map(observations.map(observation => [observation.id, observation]));
  for (const milestone of milestones) assert.equal(milestone.observation, stored.get(milestone.observation.id));
});

test("virtual-time boundaries are marked only where the recorded time changes", async () => {
  const { history } = await completed("response-lost", responseLostCheckout);
  const milestones = storyMilestones(history.observations);
  assert.equal(milestones[0]!.timeBoundary, true);
  for (const [index, milestone] of milestones.entries()) {
    const previous = milestones[index - 1];
    assert.equal(milestone.timeBoundary, previous === undefined || previous.observation.time !== milestone.observation.time);
  }
  const times = milestones.map(milestone => milestone.observation.time);
  assert.deepEqual(times, [...times].sort((left, right) => left - right));
  assert.ok(milestones.some(milestone => milestone.timeBoundary && milestone.observation.time > (milestones[0]?.observation.time ?? 0)));
});

test("story copy reports the reduction, recorded boundaries, and labeled shapes without inferred time", async () => {
  const { history } = await completed("response-lost", responseLostCheckout);
  const observations = history.observations;
  const milestones = storyMilestones(observations);
  const reduction = storyReduction(milestones, observations.length);
  assert.equal(reduction, `${milestones.length} teaching milestones from ${observations.length} recorded observations.`);
  const summary = storySummary(milestones, observations.length, labels);
  assert.ok(summary.startsWith(reduction));
  assert.ok(!summary.includes("column"));
  assert.ok(summary.includes(`${storyLanes(milestones).length} component lanes`));
  assert.ok(summary.includes(`first milestone is recorded at virtual time ${milestones[0]!.observation.time}`));
  assert.ok(summary.includes(`last at virtual time ${milestones.at(-1)!.observation.time}`));
  const detail = storyDetail(milestones);
  assert.ok(detail.includes(`${milestones.length} columns and ${storyLanes(milestones).length} component lanes`));
  assert.ok(detail.includes("no elapsed duration between milestones is stored"));
  assert.ok(detail.includes(`${milestones.filter(milestone => milestone.timeBoundary).length} recorded virtual-time boundaries are marked`));
  assert.ok(!/\b\d+\s*(ms|s|sec|seconds)\b/.test(summary + detail));
  const legend = storyLegend(milestones);
  assert.equal(new Set(legend.map(entry => entry.shape)).size, legend.length);
  assert.deepEqual(new Set(legend.map(entry => entry.kind)), new Set(milestones.map(milestone => milestone.kind)));
  assert.equal(legend.reduce((total, entry) => total + entry.count, 0), milestones.length);
  for (const entry of legend) assert.ok(entry.label.length > 0);
});

test("empty and filtered results keep an explicit story state", () => {
  const rows: Observation[] = [
    { schemaVersion: 1, id: "only-bookkeeping", time: simulationTime(0), sequence: 1, type: "scheduler.event.scheduled", source: "simulation" },
  ];
  assert.deepEqual(storyMilestones(rows), []);
  assert.equal(storyReduction([], 1), "0 teaching milestones from 1 recorded observation.");
  assert.equal(storyReduction([], 2), "0 teaching milestones from 2 recorded observations.");
  assert.ok(storySummary([], 1, labels).startsWith("No teaching milestones are in the current results."));
  assert.equal(storyDetail([]), "The Story strip and its table are empty.");
  assert.deepEqual(storyLegend([]), []);
});
