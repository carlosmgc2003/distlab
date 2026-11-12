import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeProjectionSet, WorkerEvent } from "@distlab/contracts";
import { mapArchitecture } from "../src/architecture-view.ts";
import { DESIGN_EDITOR_AVAILABLE, designStepUnavailable, isEmptySlot } from "../src/design-step.ts";
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

/** Copy that tells the student to make a design edit: fill a slot, attach a database, subscribe a component. */
const designInstruction = /\bfill the slot\b|\bgive it a database\b|\bsubscribe it\b/i;

test("#164 no offered lesson asks for a design edit the browser cannot make without saying so", () => {
  assert.equal(DESIGN_EDITOR_AVAILABLE, false, "the Design editor (#112) is not in the browser yet");
  const flagged = scenarios.filter(choice => designStepUnavailable(choice.policy)).map(choice => choice.id);
  // Exactly the lessons whose policy allows architecture edits are flagged.
  assert.deepEqual(flagged, scenarios.filter(choice => choice.policy.architecture !== undefined).map(choice => choice.id));
  assert.deepEqual(flagged, ["outbox-notifications-gap"]);
  for (const choice of scenarios) {
    if (designInstruction.test(lessonDescription(choice, messages("en")))) assert.ok(designStepUnavailable(choice.policy), `${choice.id} instructs a design edit and carries the notice`);
  }
  assert.match(messages("en").designChoices.stepNotice, /not available in the browser/);
  assert.match(messages("es").designChoices.stepNotice, /no está disponible en el navegador/);
});

test("#164 the notice goes away once the Design editor is available", () => {
  const gap = scenarios.find(choice => choice.id === "outbox-notifications-gap")!;
  assert.equal(designStepUnavailable(gap.policy, true), false);
  assert.equal(designStepUnavailable(undefined), false);
  assert.equal(designStepUnavailable({}), false);
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
