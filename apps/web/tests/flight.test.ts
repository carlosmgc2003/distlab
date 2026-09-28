import assert from "node:assert/strict";
import test from "node:test";
import type { Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import {
  DEFAULT_FLIGHT_PACE,
  FLIGHT_PACES,
  flightAdvance,
  flightBoundaries,
  flightDelayMs,
  flightFacts,
  flightIndexOf,
  flightPace,
  flightPosition,
  flightSteps,
  flightStop,
  flightTransport,
  FLIGHT_LEGEND,
} from "../src/flight.ts";
import { flightTokenStyle } from "../src/architecture-view.ts";
import { mapArchitecture, movementEdges } from "../src/architecture-view.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import type { MovementEdge } from "../src/timeline.ts";

const checkoutEdges: readonly MovementEdge[] = [
  { id: "request:customer-app:orders:0", source: "customer-app", target: "orders", relationship: "request" },
  { id: "request:payments:payment-processor:1", source: "payments", target: "payment-processor", relationship: "request" },
  { id: "subscription:OrderCreated:payments:2", source: "OrderCreated", target: "payments", relationship: "subscription" },
  { id: "publication:orders:OrderCreated", source: "orders", target: "OrderCreated", relationship: "publication" },
];

function observation(input: {
  id: string; time: number; sequence: number; type: string; source: string; target?: string;
  traceId?: string; data?: Observation["data"]; entityRefs?: readonly { kind: string; id: string }[];
}): Observation {
  return {
    schemaVersion: 1, id: input.id, time: simulationTime(input.time), sequence: input.sequence, type: input.type, source: input.source,
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
    ...(input.entityRefs !== undefined ? { entityRefs: input.entityRefs } : {}),
    ...(Object.hasOwn(input, "data") ? { data: input.data } : {}),
  } as Observation;
}

async function run(index: number): Promise<RuntimeProjectionSet> {
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: scenarios[index]!.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const last = events.filter(event => event.type === "projection.updated").at(-1);
  assert.ok(last?.projection);
  return last.projection;
}

test("flight steps read the recorded movements in canonical order and change nothing", async () => {
  const projection = await run(0);
  const before = JSON.stringify(projection.history.observations);
  const steps = flightSteps(projection.history.observations, checkoutEdges);
  assert.equal(JSON.stringify(projection.history.observations), before);
  // Every step is a stored observation, in stored sequence order, and every movement cue is one step.
  assert.deepEqual(steps.map(step => step.sequence), [...steps.map(step => step.sequence)].sort((a, b) => a - b));
  assert.ok(steps.length > 0);
  for (const step of steps) {
    const record = projection.history.observations.find(item => item.id === step.observationId);
    assert.ok(record, "each step names a stored observation");
    assert.equal(step.time, record.time);
    assert.equal(step.sequence, record.sequence);
    assert.equal(step.headline.length > 0, true);
  }
  // A record that travels no link is not a movement.
  const scheduler = projection.history.observations.filter(item => item.type === "scheduler.event.dispatched");
  assert.ok(scheduler.length > 0);
  assert.ok(scheduler.every(item => !steps.some(step => step.observationId === item.id)));
});

test("a step names its link, its route, and only stored fields", async () => {
  const projection = await run(0);
  const steps = flightSteps(projection.history.observations, checkoutEdges);
  const request = steps.find(step => step.headline === "Request sent");
  assert.ok(request);
  assert.equal(request.from, "customer-app");
  assert.equal(request.to, "orders");
  assert.equal(request.relationship, "request");
  assert.equal(request.route, "customer-app → orders · Request link");
  assert.equal(request.glyph, "→");
  assert.equal(request.shape, "solid");
  assert.equal(request.interrupted, false);
  assert.equal(request.announcement, "Request sent from customer-app to orders at virtual time 0.");
  const stored = projection.history.observations.find(item => item.id === request.observationId)!;
  assert.equal(request.facts.find(fact => fact.label === "Endpoint")?.value, (stored.data as { endpoint: string }).endpoint);
  assert.equal(request.facts.find(fact => fact.label === "Deadline at virtual time")?.value, "1000");
  // Narration names payload fields, never their stored values.
  assert.equal(request.facts.find(fact => fact.label === "Stored body fields")?.value, "cartId, customerId, amount");
  assert.ok(!JSON.stringify(request).includes("cart-1"));

  const published = steps.find(step => step.headline === "Message published");
  assert.ok(published);
  assert.equal(published.relationship, "publication");
  assert.equal(published.glyph, "⇢");
  assert.equal(published.shape, "dotted");
  assert.equal(published.route, "orders → OrderCreated · MessageBus publication");
  assert.equal(published.facts.find(fact => fact.label === "Message type")?.value, "OrderCreated");

  const delivered = steps.find(step => step.headline.startsWith("Message delivered"));
  assert.ok(delivered);
  assert.equal(delivered.relationship, "subscription");
  assert.equal(delivered.shape, "dashed");
  assert.equal(delivered.facts.find(fact => fact.label === "Delivery attempt")?.value, "1");
});

test("a dropped response and a timeout are interrupted movements that stop on the link", async () => {
  const projection = await run(1);
  const steps = flightSteps(projection.history.observations, checkoutEdges);
  const dropped = steps.find(step => step.headline === "Response dropped");
  assert.ok(dropped);
  assert.equal(dropped.interrupted, true);
  assert.equal(dropped.glyph, "⊘");
  assert.equal(dropped.shape, "dotted");
  assert.equal(dropped.facts.find(fact => fact.label === "Stored reason")?.value, "fault");
  assert.equal(flightStop(dropped), "52%");

  const timedout = steps.find(step => step.headline === "Request timed out");
  assert.ok(timedout);
  assert.equal(timedout.interrupted, true);
  assert.equal(timedout.glyph, "◷");
  assert.equal(flightStop(timedout), "78%");
  assert.equal(flightStop(steps.find(step => step.headline === "Request sent")!), "100%");
  // A drop is stated; the pattern note asks a question rather than claiming an outcome.
  assert.match(dropped.pattern, /the caller do next/);
  assert.match(timedout.pattern, /what does the caller now know/i);
});

test("a redacted payload contributes a visibility statement and no fields", () => {
  const facts = flightFacts(observation({ id: "a", time: 0, sequence: 1, type: "network.request.sent", source: "a", data: { redacted: true } }));
  assert.deepEqual(facts, [{ label: "Stored payload", value: "Redacted; not shown" }]);
  const omitted = flightFacts(observation({ id: "b", time: 0, sequence: 1, type: "network.request.sent", source: "a" }));
  assert.deepEqual(omitted, [{ label: "Stored payload", value: "Omitted; not shown" }]);
});

test("recorded transitions, changed rows, and external changes are read from stored fields", async () => {
  const projection = await run(1);
  const steps = flightSteps(projection.history.observations, checkoutEdges);
  const acknowledged = steps.find(step => step.headline === "Message acknowledged");
  assert.ok(acknowledged);
  assert.equal(acknowledged.facts.find(fact => fact.label === "Recorded transition")?.value, "IN_FLIGHT → ACKED");
  // A type with no stored transition contributes no transition line.
  assert.equal(steps.find(step => step.headline === "Request delivered")!.facts
    .some(fact => fact.label === "Recorded transition"), false);
});

test("movement edges from the architecture projection drive the same routes", async () => {
  const projection = await run(0);
  const graph = mapArchitecture(projection.architecture, packagedMetadata(scenarios[0]!).architecture, packagedMetadata(scenarios[0]!).name);
  const edges = movementEdges(graph.edges);
  assert.equal(edges.length, 4);
  const steps = flightSteps(projection.history.observations, edges);
  assert.ok(steps.length > 0);
  for (const step of steps) {
    if (step.edgeId === undefined) continue;
    const edge = edges.find(item => item.id === step.edgeId);
    assert.ok(edge, "a step names a link the architecture draws");
    assert.equal(edge.relationship, step.relationship);
  }
});

test("paces are named, ordered, and default to the slowest", () => {
  assert.deepEqual(FLIGHT_PACES.map(item => item.id), ["slow", "steady", "fast"]);
  assert.equal(DEFAULT_FLIGHT_PACE, "slow");
  assert.equal(flightDelayMs("slow"), 1800);
  assert.ok(flightDelayMs("slow") > flightDelayMs("steady"));
  assert.ok(flightDelayMs("steady") > flightDelayMs("fast"));
  assert.equal(flightPace("fast").delayMs, flightDelayMs("fast"));
  // Each named pace states its own interval, so the control never hides its timing.
  for (const pace of FLIGHT_PACES) {
    assert.equal(pace.note, `one movement every ${pace.delayMs / 1000} seconds`);
  }
  // The token paints inside the cursor's interval, so a movement arrives before the next one starts.
  assert.ok(Math.round(flightDelayMs("slow") * 0.62) < flightDelayMs("slow"));
});

test("the legend names every token glyph and shape the graph paints", async () => {
  const painted = new Set(flightSteps((await run(1)).history.observations, checkoutEdges).map(step => step.glyph));
  for (const glyph of painted) {
    const entry = FLIGHT_LEGEND.find(item => item.glyph === glyph);
    assert.ok(entry, `the legend names ${glyph}`);
    assert.ok(entry.label.length > 0 && entry.detail.length > 0);
  }
  assert.equal(new Set(FLIGHT_LEGEND.map(item => item.glyph)).size, FLIGHT_LEGEND.length, "each glyph is named once");
  // A token only travels to the destination unless the record says the movement stopped.
  assert.deepEqual([...new Set(FLIGHT_LEGEND.map(item => item.shape))].sort(), ["dashed", "dotted", "solid"]);
});

test("the token follows the measured link path and stops where the record says", async () => {
  const projection = await run(1);
  const steps = flightSteps(projection.history.observations, checkoutEdges);
  const style = flightTokenStyle(steps[0]!, "M 0 0 L 10 10", 900);
  assert.equal(style["--flight-path"], 'path("M 0 0 L 10 10")');
  assert.equal(style["--flight-end"], "100%");
  assert.equal(style["--flight-duration"], "900ms");
  assert.deepEqual(Object.keys(style).sort(), ["--flight-duration", "--flight-end", "--flight-path"]);
  const dropped = steps.find(step => step.interrupted)!;
  assert.equal(flightTokenStyle(dropped, "M 0 0", 0)["--flight-duration"], "1ms");
});

test("the cursor walks recorded movements, waits while recording, and ends at the recorded end", () => {
  assert.deepEqual(flightAdvance(-1, 0, "playing", false), { cursor: -1, phase: "idle", waiting: false });
  assert.deepEqual(flightAdvance(0, 3, "playing", false), { cursor: 1, phase: "playing", waiting: false });
  assert.deepEqual(flightAdvance(2, 3, "playing", false), { cursor: 2, phase: "ended", waiting: false });
  // The recorded end waits for the run instead of stopping, then still ends when the run is done.
  assert.deepEqual(flightAdvance(2, 3, "playing", true), { cursor: 2, phase: "playing", waiting: true });
  assert.deepEqual(flightAdvance(2, 3, "paused", true), { cursor: 2, phase: "paused", waiting: false });
  assert.deepEqual(flightAdvance(0, 1, "paused", false), { cursor: 0, phase: "paused", waiting: false });
});

test("the transport states one position, one reason, and the two step directions", async () => {
  const projection = await run(0);
  const steps = flightSteps(projection.history.observations, checkoutEdges);
  const idle = flightTransport(-1, steps.length, "idle", false);
  assert.equal(idle.control.action, "play");
  assert.equal(idle.control.label, "Play timeline");
  // With nothing selected, Previous states the last movement and Next the first.
  assert.equal(idle.previous, true);
  assert.equal(idle.next, true);
  const playing = flightTransport(0, steps.length, "playing", true);
  assert.equal(playing.control.action, "unavailable");
  assert.match(playing.reason, /waits at the end while the run records more/);
  const ended = flightTransport(steps.length - 1, steps.length, "idle", false);
  assert.equal(ended.control.action, "restart");
  assert.equal(ended.control.label, "Restart timeline");
  assert.equal(ended.next, false);
  const empty = flightTransport(-1, 0, "idle", false);
  assert.equal(empty.control.action, "unavailable");
  assert.match(empty.status, /No visible observations/);

  const position = flightPosition(steps, 2);
  assert.equal(position.text, `Movement 3 of ${steps.length} · virtual time ${steps[2]!.time} · observation #${steps[2]!.sequence}.`);
  assert.match(flightPosition(steps, -1).text, /^0 of \d+ recorded movements/);
  assert.match(flightPosition([], -1).text, /No recorded movements/);
  assert.match(flightPosition(steps, steps.length - 1).detail, /waits for the run to record more/);
});

test("recorded virtual-time boundaries are a list of times, not durations", async () => {
  const projection = await run(0);
  const steps = flightSteps(projection.history.observations, checkoutEdges);
  const boundaries = flightBoundaries(steps);
  assert.deepEqual(boundaries, [...new Set(steps.map(step => step.time))]);
  assert.ok(boundaries.every(time => typeof time === "number"));
  assert.deepEqual(flightBoundaries([]), []);
  assert.match(flightPosition(steps, 0).detail, /no duration is stored|Rules mark boundaries only/);
  assert.equal(flightIndexOf(steps, steps[4]!.observationId), 4);
  assert.equal(flightIndexOf(steps, "not-a-record"), -1);
  assert.equal(flightIndexOf(steps, null), -1);
});
