import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { mapArchitecture } from "../src/architecture-view.ts";
import { isEmptySlot } from "../src/design-step.ts";
import { messages } from "../src/i18n/catalog.ts";
import { lessonDescription, packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

async function load(index: number): Promise<RuntimeProjectionSet> {
  const events: WorkerEvent[] = [];
  await new WorkerAdapter(event => events.push(event)).receive({ version: 1, requestId: "test", type: "load", scenario: scenarios[index]!.scenario });
  const loaded = events.find(event => event.type === "loaded");
  assert.ok(loaded?.type === "loaded");
  return loaded.projection;
}

test("#112 no lesson says the design step is unavailable: the Design editor serves every lesson with an allowance", () => {
  for (const choice of scenarios) assert.doesNotMatch(lessonDescription(choice, messages("en")), /not available in the browser/, choice.id);
  // The gap lesson still asks for the design edits, which the Architecture section now offers.
  const gap = scenarios.find(choice => choice.id === "outbox-notifications-gap")!;
  assert.ok(gap.policy.architecture, "the gap lesson keeps its architecture allowance");
  assert.match(lessonDescription(gap, messages("en")), /Fill the slot, give it a database, and subscribe it\./);
});

test("#164 only placeholder models mark an empty slot", () => {
  assert.equal(isEmptySlot("commerce.placeholder-service", "1.0.0"), true);
  assert.equal(isEmptySlot("commerce.placeholder-external", "1.0.0"), true);
  assert.equal(isEmptySlot("commerce.placeholder-service", "2.0.0"), false);
  assert.equal(isEmptySlot("commerce.notifications", "1.0.0"), false);
  assert.equal(isEmptySlot(undefined, undefined), false);
});

test("#164 the graph marks the empty notifications slot in words, and no other component", async () => {
  for (const [index, choice] of scenarios.entries()) {
    const projection = await load(index);
    const metadata = packagedMetadata(choice);
    const graph = mapArchitecture(projection.architecture, metadata.architecture, metadata.name, messages("en"));
    const empty = graph.nodes.filter(node => node.data.emptySlot === true);
    if (choice.id !== "outbox-notifications-gap") {
      assert.deepEqual(empty, [], choice.id);
      assert.ok(graph.nodes.every(node => !node.ariaLabel?.includes("empty slot")), choice.id);
      continue;
    }
    assert.deepEqual(empty.map(node => node.id), ["notifications"]);
    assert.equal(empty[0]!.ariaLabel, "notifications, Internal service, empty slot");
    assert.match(empty[0]!.className ?? "", /\bis-empty-slot\b/);
  }
});
