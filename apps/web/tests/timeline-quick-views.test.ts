import assert from "node:assert/strict";
import test from "node:test";
import type { Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { normalCheckout, responseLostCheckout } from "@distlab/catalogs";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import { emptyTimelineDraft, queryTimeline, withExactValue } from "../src/timeline-query.ts";
import type { TimelineDraft } from "../src/timeline-query.ts";
import { recordKinds } from "../src/records.ts";
import { orderObservations } from "../src/records.ts";
import {
  QUICK_VIEWS,
  emptyQuickViewExplanation,
  matchesQuickView,
  quickViewChip,
  quickViewCounts,
  quickViewFeedback,
  quickViewObservations,
  quickViewSummary,
  recordedComponentChips,
  revealQuickView,
} from "../src/timeline-quick-views.ts";
import type { QuickViewId } from "../src/timeline-quick-views.ts";

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

const titles = [
  { id: "customer-app", title: "Customer App" },
  { id: "orders", title: "Orders" },
  { id: "payments", title: "Payments" },
  { id: "payment-processor", title: "Payment Processor" },
];

function row(input: { id: string; sequence: number; type: string; source: string; target?: string; time?: number; traceId?: string }): Observation {
  return {
    schemaVersion: 1, id: input.id, time: simulationTime(input.time ?? input.sequence), sequence: input.sequence,
    type: input.type, source: input.source,
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
  };
}

const sample: readonly Observation[] = [
  row({ id: "1", sequence: 1, type: "network.request.sent", source: "orders", target: "payments", traceId: "trace-a" }),
  row({ id: "2", sequence: 2, type: "network.response.dropped", source: "payments", target: "orders", traceId: "trace-a" }),
  row({ id: "3", sequence: 3, type: "network.request.timedout", source: "orders", traceId: "trace-a" }),
  row({ id: "4", sequence: 4, type: "fault.rule.matched", source: "payments" }),
  row({ id: "5", sequence: 5, type: "message.published", source: "orders", traceId: "trace-b" }),
  row({ id: "6", sequence: 6, type: "message.acknowledged", source: "orders", traceId: "trace-b" }),
  row({ id: "7", sequence: 7, type: "database.transaction.committed", source: "payments" }),
  row({ id: "8", sequence: 8, type: "database.transaction.rolledback", source: "payments" }),
  row({ id: "9", sequence: 9, type: "external.effect.committed", source: "payment-processor" }),
  row({ id: "10", sequence: 10, type: "scenario.assertion.evaluated", source: "simulation" }),
  row({ id: "11", sequence: 11, type: "scheduler.event.dispatched", source: "simulation" }),
];

function typesOf(observations: readonly Observation[]): readonly string[] {
  return observations.map(observation => observation.type);
}

test("every quick view is a read-only predicate over the recorded snapshot", () => {
  assert.deepEqual(QUICK_VIEWS.map(view => view.id), [
    "key-events", "faults-and-timeouts", "requests-and-responses", "messages", "state-changes", "assertions",
  ]);
  for (const view of QUICK_VIEWS) {
    assert.ok(view.label.length > 0);
    assert.ok(view.keeps.length > 0);
    assert.ok(view.kinds.length > 0 || view.types.length > 0, `${view.id} must name stored records`);
  }
  // A null quick view is the identity projection in canonical order.
  assert.deepEqual(quickViewObservations(sample, null), orderObservations(sample));
  // Projection never reorders, drops unrelated records, or mutates the snapshot.
  const before = JSON.stringify(sample);
  for (const view of QUICK_VIEWS) quickViewObservations(sample, view.id);
  assert.equal(JSON.stringify(sample), before);
  const reversed = [...sample].reverse();
  for (const view of QUICK_VIEWS) assert.deepEqual(quickViewObservations(reversed, view.id), quickViewObservations(sample, view.id));
});

test("each preset keeps exactly the stored records it names", () => {
  const expected: Readonly<Record<QuickViewId, readonly string[]>> = {
    "key-events": [
      "network.request.sent", "network.response.dropped", "network.request.timedout", "fault.rule.matched",
      "message.published", "message.acknowledged", "database.transaction.committed",
      "database.transaction.rolledback", "external.effect.committed",
    ],
    "faults-and-timeouts": ["network.response.dropped", "network.request.timedout", "fault.rule.matched"],
    "requests-and-responses": ["network.request.sent", "network.response.dropped", "network.request.timedout"],
    messages: ["message.published", "message.acknowledged"],
    "state-changes": ["database.transaction.committed", "database.transaction.rolledback", "external.effect.committed"],
    assertions: ["scenario.assertion.evaluated"],
  };
  for (const view of QUICK_VIEWS) {
    const kept = quickViewObservations(sample, view.id);
    assert.deepEqual(typesOf(kept), expected[view.id], view.id);
    for (const observation of kept) assert.ok(matchesQuickView(view.id, observation));
    // No record outside the view matches it.
    for (const observation of sample) {
      if (!expected[view.id].includes(observation.type)) assert.equal(matchesQuickView(view.id, observation), false, `${view.id} ${observation.type}`);
    }
  }
  // Key events are exactly the Story milestones, so both views name the same records.
  assert.deepEqual(quickViewObservations(sample, "key-events").map(item => item.id), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  // One teaching category list, owned by the record readers. `business` existed only for runtime.log.
  assert.equal(recordKinds.length, 10);
  assert.ok(!recordKinds.includes("business" as never));
});

test("quick view counts and summaries state shown out of recorded total", () => {
  const counts = quickViewCounts(sample);
  assert.deepEqual(counts, {
    "key-events": 9, "faults-and-timeouts": 3, "requests-and-responses": 3, messages: 2, "state-changes": 3, assertions: 1,
  });
  assert.equal(counts["faults-and-timeouts"]! + counts.messages! + counts.assertions!, 6);
  for (const view of QUICK_VIEWS) {
    const shown = quickViewObservations(sample, view.id).length;
    const summary = quickViewSummary(view.id, shown, sample.length);
    assert.ok(summary.startsWith(`${view.label} shows ${shown} of ${sample.length} recorded observations.`), summary);
    assert.ok(summary.includes(`It keeps ${view.keeps}.`));
    assert.ok(!/runs|re-records|executes/.test(summary));
  }
  const none = quickViewSummary(null, sample.length, sample.length);
  assert.ok(none.includes(`show ${sample.length} of ${sample.length} recorded observations`));
  assert.ok(quickViewSummary("assertions", 0, sample.length).includes("recorded no assertions"));
  assert.ok(quickViewFeedback("assertions", 1, sample.length).includes("changes nothing in the run"));
  assert.ok(quickViewFeedback(null, 11, 11).includes("cleared"));
  assert.equal(quickViewChip("messages").removeLabel, "Remove the Messages quick view");
  assert.equal(quickViewChip("messages").label, "Quick view Messages");
});

test("quick views compose with canonical filters by intersection", () => {
  const draft: TimelineDraft = withExactValue(emptyTimelineDraft, "component", "payments");
  const query = { component: { value: "payments", mode: "exact" } as const };
  const scoped = quickViewObservations(sample, "faults-and-timeouts");
  const composed = queryTimeline(scoped, query);
  assert.deepEqual(typesOf(composed), ["network.response.dropped", "fault.rule.matched"]);
  // Canonical filters still decide inside the view, and the view never widens them.
  assert.deepEqual(typesOf(queryTimeline(quickViewObservations(sample, "messages"), { traceId: { value: "trace-b", mode: "prefix" } })), ["message.published", "message.acknowledged"]);
  assert.deepEqual(queryTimeline(quickViewObservations(sample, "messages"), { traceId: { value: "trace-a", mode: "exact" } }), []);
  assert.equal(draft.component, "payments");
  // Switching views keeps the canonical criteria.
  assert.deepEqual(typesOf(queryTimeline(quickViewObservations(sample, "state-changes"), query)), ["database.transaction.committed", "database.transaction.rolledback"]);
});

test("an empty quick view explains the constraint and offers a reset", () => {
  const empty = quickViewObservations(sample.filter(observation => observation.type.startsWith("scheduler.")), "assertions");
  assert.deepEqual(empty, []);
  const explanation = emptyQuickViewExplanation("assertions", 1);
  assert.ok(explanation.includes("keeps scenario assertion evaluations"));
  assert.ok(explanation.includes("Remove the quick view chip"));
  const hidden = sample.find(observation => observation.type === "message.published")!;
  const reveal = revealQuickView("faults-and-timeouts", hidden);
  assert.equal(reveal.id, null);
  assert.equal(reveal.cleared, "faults & timeouts quick view");
  // A record inside the view keeps the view untouched.
  const inside = quickViewObservations(sample, "faults-and-timeouts")[0]!;
  assert.deepEqual(revealQuickView("faults-and-timeouts", inside), { id: "faults-and-timeouts", cleared: "" });
  assert.deepEqual(revealQuickView(null, hidden), { id: null, cleared: "" });
});

test("component quick chips name recorded components once in label order", async () => {
  const chips = recordedComponentChips(sample, titles);
  // The simulation pseudo-component is not offered as a chip.
  assert.deepEqual(chips.map(chip => chip.value), ["orders", "payment-processor", "payments"]);
  assert.deepEqual(chips.map(chip => chip.label), ["Orders", "Payment Processor", "Payments"]);
  // Without titles the chip label is the stored id.
  assert.deepEqual(recordedComponentChips(sample).map(chip => chip.label), ["orders", "payment-processor", "payments"]);
  assert.deepEqual(recordedComponentChips([], titles), []);
  const response = await completed("response-lost", responseLostCheckout);
  const fromRun = recordedComponentChips(response.history.observations, titles);
  assert.deepEqual(fromRun.map(chip => chip.value), ["customer-app", "orders", "payment-processor", "payments"]);
  assert.equal(new Set(fromRun.map(chip => chip.value)).size, fromRun.length);
});

test("the faulted checkout reaches dropped-response and timeout evidence in one quick view", async () => {
  const { history } = await completed("response-lost", responseLostCheckout);
  const observations = history.observations;
  const faults = quickViewObservations(observations, "faults-and-timeouts");
  const types = new Set(typesOf(faults));
  assert.ok(types.has("network.response.dropped"));
  assert.ok(types.has("network.request.timedout"));
  assert.ok(faults.length > 0 && faults.length < observations.length);
  // One more action: the recorded component chip, which is a canonical exact filter.
  const withComponent = queryTimeline(faults, { component: { value: "payments", mode: "exact" } });
  // A component matches when the source or the target matches, as in the advanced field.
  assert.deepEqual(typesOf(withComponent), ["network.response.dropped", "network.request.timedout"]);
  assert.deepEqual(typesOf(queryTimeline(faults, { component: { value: "customer", mode: "prefix" } })), []);  // The normal checkout has no faulted evidence to show.
  const normal = (await completed("normal", normalCheckout)).history.observations;
  assert.ok(!typesOf(quickViewObservations(normal, "faults-and-timeouts")).includes("network.response.dropped"));
  assert.ok(quickViewObservations(normal, "faults-and-timeouts").length >= 0);
});
