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
  flightJump,
  flightPace,
  flightPosition,
  flightSteps,
  flightStop,
  flightTransport,
  playbackControl,
  playbackStatus,
  FLIGHT_LEGEND,
} from "../src/flight.ts";
import { flightTokenStyle } from "../src/architecture-view.ts";
import { mapArchitecture, movementEdges } from "../src/architecture-view.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import type { MovementEdge } from "../src/records.ts";
import { edgeDirection, movementOf } from "../src/records.ts";

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
  assert.equal(request.glyph, "REQ");
  assert.equal(request.leg, "departure");
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
  assert.equal(published.glyph, "MSG");
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
  // The drop continues the departure that stopped mid-link, then stops short of payments.
  assert.equal(dropped.leg, "interrupted");
  assert.deepEqual(dropped.span, { start: 50, end: 64 });
  assert.equal(flightStop(dropped), "64%");

  const timedout = steps.find(step => step.headline === "Request timed out");
  assert.ok(timedout);
  assert.equal(timedout.interrupted, true);
  assert.equal(timedout.glyph, "◷");
  // A timeout travels nowhere: it rests at the caller with no heading mark.
  assert.equal(timedout.leg, "timeout");
  assert.equal(timedout.heading, false);
  assert.equal(timedout.from, "payments");
  assert.equal(flightStop(timedout), "8%");
  assert.equal(flightStop(steps.find(step => step.headline === "Request sent")!), "50%");
  assert.equal(flightStop(steps.find(step => step.headline === "Request delivered")!), "100%");
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
  assert.equal(style["--flight-start"], "0%");
  assert.equal(style["--flight-end"], "50%");
  assert.equal(style["--flight-rotate"], "auto");
  assert.equal(style["--flight-duration"], "900ms");
  assert.deepEqual(Object.keys(style).sort(), ["--flight-duration", "--flight-end", "--flight-path", "--flight-rotate", "--flight-start"]);
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
  // The shared control copy states the action and the phase wording.
  assert.equal(playbackControl(-1, 0, false).action, "unavailable");
  assert.equal(playbackControl(0, 1, false).action, "unavailable");
  assert.equal(playbackControl(-1, 4, false).label, "Play timeline");
  assert.equal(playbackControl(1, 4, false).action, "play");
  assert.equal(playbackControl(3, 4, false).label, "Restart timeline");
  assert.equal(playbackControl(1, 4, true).action, "unavailable");
  assert.match(playbackStatus("ended", playbackControl(3, 4, false)), /Restart timeline/);
  assert.match(playbackStatus("playing", playbackControl(1, 4, true)), /Pause/);
  assert.match(playbackStatus("paused", playbackControl(1, 4, false)), /paused/);

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

/** The link a step travels, as the edge list the architecture draws. */
function reversedEdges(edges: readonly MovementEdge[]): MovementEdge[] {
  return edges.map(edge => ({ ...edge, source: edge.target, target: edge.source }));
}

test("direction: every movement runs from its recorded origin, whichever way the link is drawn", () => {
  const records = [
    observation({ id: "q", time: 0, sequence: 1, type: "network.request.sent", source: "customer-app", target: "orders", data: { requestId: "r1" } }),
    observation({ id: "s", time: 1, sequence: 2, type: "network.response.sent", source: "orders", target: "customer-app", data: { requestId: "r1" } }),
    observation({ id: "p", time: 1, sequence: 3, type: "message.published", source: "orders", data: { destination: "OrderCreated" } }),
    observation({ id: "d", time: 2, sequence: 4, type: "message.delivered", source: "payments", data: { consumer: "payments", deliveryId: "d1" },
      entityRefs: [{ kind: "destination", id: "OrderCreated" }] }),
    observation({ id: "a", time: 3, sequence: 5, type: "message.acknowledged", source: "payments", data: { consumer: "payments", deliveryId: "d1" },
      entityRefs: [{ kind: "destination", id: "OrderCreated" }] }),
  ];
  const expected = {
    q: ["customer-app", "orders"], s: ["orders", "customer-app"], p: ["orders", "OrderCreated"],
    d: ["OrderCreated", "payments"], a: ["payments", "OrderCreated"],
  } as const;
  // Against the drawn links: a response and an acknowledgement run against their link.
  const forward = flightSteps(records, checkoutEdges);
  assert.deepEqual(Object.fromEntries(forward.map(step => [step.observationId, [step.from, step.to]])), expected);
  assert.deepEqual(Object.fromEntries(forward.map(step => [step.observationId, step.reversed])), { q: false, s: true, p: false, d: false, a: true });
  // Against links drawn the other way, the same records resolve the same origin and flip the direction.
  const backward = flightSteps(records, reversedEdges(checkoutEdges));
  assert.deepEqual(Object.fromEntries(backward.map(step => [step.observationId, [step.from, step.to]])), expected);
  assert.deepEqual(Object.fromEntries(backward.map(step => [step.observationId, step.reversed])), { q: true, s: false, p: true, d: true, a: false });
  // Invariant: the token leaves the link's source when forward and the link's target when reversed.
  for (const [steps, edges] of [[forward, checkoutEdges], [backward, reversedEdges(checkoutEdges)]] as const) {
    for (const step of steps) {
      const edge = edges.find(item => item.id === step.edgeId);
      assert.ok(edge, `${step.observationId} names the link it travels`);
      assert.equal(step.reversed ? edge.target : edge.source, step.from);
    }
  }
  // The acknowledgement leaves the consumer and travels back to the MessageBus.
  const ack = movementOf(records[4]!)!;
  assert.equal(ack.from, "payments");
  assert.equal(ack.to, "OrderCreated");
  assert.equal(ack.text, "Message acknowledged by payments on OrderCreated at virtual time 3.");
  assert.equal(edgeDirection(ack, checkoutEdges[2]!), "reverse");
});

test("a movement that runs against its link animates from the far end and turns its heading", async () => {
  const projection = await run(0);
  const steps = flightSteps(projection.history.observations, checkoutEdges);
  const sent = steps.find(step => step.headline === "Response sent" && step.from === "orders")!;
  const received = steps.find(step => step.headline === "Response received" && step.to === "customer-app")!;
  assert.equal(sent.reversed, true);
  assert.equal(received.reversed, true);
  // The SVG path runs customer-app → orders, so the response starts at 100% and ends at 0%.
  const leaving = flightTokenStyle(sent, "M 0 0 L 10 0", 500);
  const arriving = flightTokenStyle(received, "M 0 0 L 10 0", 500);
  assert.deepEqual([leaving["--flight-start"], leaving["--flight-end"]], ["100%", "50%"]);
  assert.deepEqual([arriving["--flight-start"], arriving["--flight-end"]], ["50%", "0%"]);
  assert.equal(leaving["--flight-rotate"], "auto 180deg");
  // A forward request keeps the path's own tangent.
  const request = steps.find(step => step.headline === "Request sent")!;
  assert.equal(flightTokenStyle(request, "M 0 0", 500)["--flight-rotate"], "auto");
  // An acknowledgement runs against the subscription link: from payments back to the topic.
  const ack = steps.find(step => step.headline === "Message acknowledged")!;
  assert.equal(ack.glyph, "ACK");
  assert.deepEqual([ack.from, ack.to, ack.reversed], ["payments", "OrderCreated", true]);
  assert.deepEqual([flightTokenStyle(ack, "M 0 0", 500)["--flight-start"], flightTokenStyle(ack, "M 0 0", 500)["--flight-end"]], ["100%", "0%"]);
  // Every glyph is direction-neutral: the heading mark, not the text, carries direction.
  assert.ok(steps.every(step => !/[→←⇢]/.test(step.glyph)));
});

test("hop pairing: a sent leg and its delivered leg cross the link once, one record per cursor step", async () => {
  for (const index of [0, 1]) {
    const projection = await run(index);
    const steps = flightSteps(projection.history.observations, checkoutEdges);
    // The cursor stays one step per stored observation, so history selection and playback agree.
    assert.equal(new Set(steps.map(step => step.observationId)).size, steps.length);
    const hops = new Map<string, typeof steps[number][]>();
    for (const step of steps) if (step.hopId !== undefined) hops.set(step.hopId, [...(hops.get(step.hopId) ?? []), step]);
    assert.ok(hops.size >= 4);
    for (const [hopId, legs] of hops) {
      const departure = legs.find(leg => leg.leg === "departure");
      assert.ok(departure, `${hopId} departs`);
      const ends = legs.filter(leg => leg.leg === "arrival" || leg.leg === "interrupted");
      for (const end of ends) {
        // An arrival names the earlier departure it completes, and starts where the departure stopped.
        assert.equal(end.departure?.observationId, departure.observationId);
        assert.ok(end.sequence > departure.sequence);
        assert.equal(end.span.start, departure.span.end);
      }
      const arrival = legs.find(leg => leg.leg === "arrival");
      if (arrival) {
        // Together the two legs cover the link exactly once.
        assert.deepEqual([departure.span.start, departure.span.end, arrival.span.start, arrival.span.end], [0, 50, 50, 100]);
        assert.match(arrival.transit, new RegExp(`left at virtual time ${departure.time} \\(observation #${departure.sequence}\\)`));
      }
    }
  }
  // A drop and a timeout on the lost-response run close their own hops.
  const lost = flightSteps((await run(1)).history.observations, checkoutEdges);
  const timeout = lost.find(step => step.leg === "timeout")!;
  assert.equal(timeout.departure?.observationId, lost.find(step => step.hopId === timeout.hopId && step.leg === "departure")?.observationId);
  // A record with a redacted payload stores no request id and pairs with nothing.
  const redacted = flightSteps([
    observation({ id: "x", time: 0, sequence: 1, type: "network.request.sent", source: "customer-app", target: "orders", data: { redacted: true } }),
    observation({ id: "y", time: 5, sequence: 2, type: "network.request.delivered", source: "customer-app", target: "orders", data: { redacted: true } }),
  ], checkoutEdges);
  assert.equal(redacted[1]!.departure, undefined);
  assert.equal(redacted[1]!.hopId, undefined);
  // The span still comes from the stored type: the arrival leg still finishes the trip.
  assert.deepEqual(redacted.map(step => step.span), [{ start: 0, end: 50 }, { start: 50, end: 100 }]);
});

test("a virtual-time jump names the two recorded times and nothing else", async () => {
  const steps = flightSteps((await run(1)).history.observations, checkoutEdges);
  const timeout = steps.findIndex(step => step.leg === "timeout");
  assert.equal(flightJump(steps, timeout), "Virtual time jumped t=55 → t=1025 with no recorded movement in between.");
  assert.equal(flightPosition(steps, timeout).jump, flightJump(steps, timeout));
  // No jump at the first movement or between movements at the same virtual time.
  assert.equal(flightJump(steps, 0), undefined);
  const same = steps.findIndex((step, index) => index > 0 && step.time === steps[index - 1]!.time);
  assert.equal(flightJump(steps, same), undefined);
  assert.equal(flightPosition(steps, same).jump, undefined);
});
