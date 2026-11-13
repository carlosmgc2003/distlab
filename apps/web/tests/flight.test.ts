import assert from "node:assert/strict";
import test from "node:test";
import type { Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import {
  DEFAULT_FLIGHT_PACE,
  FLIGHT_PACES,
  flightAdvance,
  flightBackground,
  flightBoundaries,
  flightDelayMs,
  flightFacts,
  flightIndexOf,
  flightInTransit,
  flightInTransitText,
  flightJump,
  flightPace,
  flightPosition,
  flightSteps,
  flightStop,
  flightTransitGroups,
  flightTransport,
  playbackControl,
  playbackStatus,
  flightLegend,
  flightPaceText,
  replayKeyAction,
  transportStep,
} from "../src/flight.ts";
import type { ComponentActivity } from "../src/activity.ts";
import { selectionStep } from "../src/timeline.ts";
import { flightTokenStyle, transitTokenStyle } from "../src/architecture-view.ts";
import { mapArchitecture, movementEdges } from "../src/architecture-view.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import type { MovementEdge } from "../src/records.ts";
import { edgeDirection, movementOf, movementText } from "../src/records.ts";
import { messages } from "../src/i18n/catalog.ts";

const m = messages("en");
const es = messages("es");

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
  const steps = flightSteps(projection.history.observations, checkoutEdges, m);
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
  const steps = flightSteps(projection.history.observations, checkoutEdges, m);
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
  const steps = flightSteps(projection.history.observations, checkoutEdges, m);
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
  const facts = flightFacts(observation({ id: "a", time: 0, sequence: 1, type: "network.request.sent", source: "a", data: { redacted: true } }), m);
  assert.deepEqual(facts, [{ label: "Stored payload", value: "Redacted; not shown" }]);
  const omitted = flightFacts(observation({ id: "b", time: 0, sequence: 1, type: "network.request.sent", source: "a" }), m);
  assert.deepEqual(omitted, [{ label: "Stored payload", value: "Omitted; not shown" }]);
});

test("recorded transitions, changed rows, and external changes are read from stored fields", async () => {
  const projection = await run(1);
  const steps = flightSteps(projection.history.observations, checkoutEdges, m);
  const acknowledged = steps.find(step => step.headline === "Message acknowledged");
  assert.ok(acknowledged);
  assert.equal(acknowledged.facts.find(fact => fact.label === "Recorded transition")?.value, "IN_FLIGHT → ACKED");
  // A type with no stored transition contributes no transition line.
  assert.equal(steps.find(step => step.headline === "Request delivered")!.facts
    .some(fact => fact.label === "Recorded transition"), false);
});

test("movement edges from the architecture projection drive the same routes", async () => {
  const projection = await run(0);
  const graph = mapArchitecture(projection.architecture, packagedMetadata(scenarios[0]!).architecture, packagedMetadata(scenarios[0]!).name, m);
  const edges = movementEdges(graph.edges);
  assert.equal(edges.length, 4);
  const steps = flightSteps(projection.history.observations, edges, m);
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
    assert.equal(flightPaceText(pace.id, m).note, `one movement every ${pace.delayMs / 1000} seconds`);
  }
  assert.deepEqual(FLIGHT_PACES.map(pace => flightPaceText(pace.id, m).label), ["Slow", "Steady", "Fast"]);
  // Spanish writes the interval with the locale's decimal mark.
  assert.equal(flightPaceText("steady", es).note, "un movimiento cada 0,9 segundos");
  // The token paints inside the cursor's interval, so a movement arrives before the next one starts.
  assert.ok(Math.round(flightDelayMs("slow") * 0.62) < flightDelayMs("slow"));
});

test("the legend names every token glyph and shape the graph paints", async () => {
  const painted = new Set(flightSteps((await run(1)).history.observations, checkoutEdges, m).map(step => step.glyph));
  for (const glyph of painted) {
    const entry = flightLegend(m).find(item => item.glyph === glyph);
    assert.ok(entry, `the legend names ${glyph}`);
    assert.ok(entry.label.length > 0 && entry.detail.length > 0);
  }
  assert.equal(new Set(flightLegend(m).map(item => item.glyph)).size, flightLegend(m).length, "each glyph is named once");
  // A token only travels to the destination unless the record says the movement stopped.
  assert.deepEqual([...new Set(flightLegend(m).map(item => item.shape))].sort(), ["dashed", "dotted", "solid"]);
});

test("the token follows the measured link path and stops where the record says", async () => {
  const projection = await run(1);
  const steps = flightSteps(projection.history.observations, checkoutEdges, m);
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
  const steps = flightSteps(projection.history.observations, checkoutEdges, m);
  const idle = flightTransport(-1, steps.length, "idle", false, m);
  assert.equal(idle.control.action, "play");
  assert.equal(idle.control.label, "Play replay");
  // With nothing selected, Next selects the first movement and Previous is unavailable (#191).
  assert.equal(idle.previous, false);
  assert.equal(idle.next, true);
  const playing = flightTransport(0, steps.length, "playing", true, m);
  assert.equal(playing.control.action, "unavailable");
  assert.match(playing.reason, /waits at the end while the run records more/);
  const ended = flightTransport(steps.length - 1, steps.length, "idle", false, m);
  assert.equal(ended.control.action, "restart");
  assert.equal(ended.control.label, "Restart replay");
  assert.equal(ended.next, false);
  const empty = flightTransport(-1, 0, "idle", false, m);
  assert.equal(empty.control.action, "unavailable");
  assert.match(empty.status, /No visible observations/);
  // The shared control copy states the action and the phase wording.
  assert.equal(playbackControl(-1, 0, false, m).action, "unavailable");
  assert.equal(playbackControl(-1, 4, false, m).label, "Play replay");
  assert.equal(playbackControl(1, 4, false, m).action, "play");
  assert.equal(playbackControl(3, 4, false, m).label, "Restart replay");
  assert.equal(playbackControl(1, 4, true, m).action, "unavailable");
  assert.match(playbackStatus("ended", playbackControl(3, 4, false, m), m), /Restart replay/);
  assert.match(playbackStatus("playing", playbackControl(1, 4, true, m), m), /Pause/);
  assert.match(playbackStatus("paused", playbackControl(1, 4, false, m), m), /paused/);

  const position = flightPosition(steps, 2, m);
  assert.equal(position.text, `Movement 3 of ${steps.length} · virtual time ${steps[2]!.time} · observation #${steps[2]!.sequence}.`);
  assert.match(flightPosition(steps, -1, m).text, /^0 of \d+ recorded movements/);
  assert.match(flightPosition([], -1, m).text, /No recorded movements/);
  assert.match(flightPosition(steps, steps.length - 1, m).detail, /waits for the run to record more/);
});

test("recorded virtual-time boundaries are a list of times, not durations", async () => {
  const projection = await run(0);
  const steps = flightSteps(projection.history.observations, checkoutEdges, m);
  const boundaries = flightBoundaries(steps);
  assert.deepEqual(boundaries, [...new Set(steps.map(step => step.time))]);
  assert.ok(boundaries.every(time => typeof time === "number"));
  assert.deepEqual(flightBoundaries([]), []);
  assert.match(flightPosition(steps, 0, m).detail, /no duration is stored|Rules mark boundaries only/);
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
  const forward = flightSteps(records, checkoutEdges, m);
  assert.deepEqual(Object.fromEntries(forward.map(step => [step.observationId, [step.from, step.to]])), expected);
  assert.deepEqual(Object.fromEntries(forward.map(step => [step.observationId, step.reversed])), { q: false, s: true, p: false, d: false, a: true });
  // Against links drawn the other way, the same records resolve the same origin and flip the direction.
  const backward = flightSteps(records, reversedEdges(checkoutEdges), m);
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
  assert.equal(movementText(ack, m), "Message acknowledged by payments on OrderCreated at virtual time 3.");
  assert.equal(edgeDirection(ack, checkoutEdges[2]!), "reverse");
});

test("a movement that runs against its link animates from the far end and turns its heading", async () => {
  const projection = await run(0);
  const steps = flightSteps(projection.history.observations, checkoutEdges, m);
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
    const steps = flightSteps(projection.history.observations, checkoutEdges, m);
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
  const lost = flightSteps((await run(1)).history.observations, checkoutEdges, m);
  const timeout = lost.find(step => step.leg === "timeout")!;
  assert.equal(timeout.departure?.observationId, lost.find(step => step.hopId === timeout.hopId && step.leg === "departure")?.observationId);
  // A record with a redacted payload stores no request id and pairs with nothing.
  const redacted = flightSteps([
    observation({ id: "x", time: 0, sequence: 1, type: "network.request.sent", source: "customer-app", target: "orders", data: { redacted: true } }),
    observation({ id: "y", time: 5, sequence: 2, type: "network.request.delivered", source: "customer-app", target: "orders", data: { redacted: true } }),
  ], checkoutEdges, m);
  assert.equal(redacted[1]!.departure, undefined);
  assert.equal(redacted[1]!.hopId, undefined);
  // The span still comes from the stored type: the arrival leg still finishes the trip.
  assert.deepEqual(redacted.map(step => step.span), [{ start: 0, end: 50 }, { start: 50, end: 100 }]);
});

test("a virtual-time jump names the two recorded times and nothing else", async () => {
  const steps = flightSteps((await run(1)).history.observations, checkoutEdges, m);
  const timeout = steps.findIndex(step => step.leg === "timeout");
  assert.equal(flightJump(steps, timeout, m), "Virtual time jumped t=55 → t=1025 with no recorded movement in between.");
  assert.equal(flightPosition(steps, timeout, m).jump, flightJump(steps, timeout, m));
  // No jump at the first movement or between movements at the same virtual time.
  assert.equal(flightJump(steps, 0, m), undefined);
  const same = steps.findIndex((step, index) => index > 0 && step.time === steps[index - 1]!.time);
  assert.equal(flightJump(steps, same, m), undefined);
  assert.equal(flightPosition(steps, same, m).jump, undefined);
});

test("#191 with nothing selected, Next selects the first movement and Previous is unavailable", () => {
  assert.equal(transportStep(-1, 13, 1), 0);
  assert.equal(transportStep(-1, 13, -1), null);
  assert.equal(transportStep(-1, 1, -1), null);
  assert.equal(transportStep(-1, 0, 1), null);
  // On the first movement Previous is unavailable; on a later one it selects the one before.
  assert.equal(transportStep(0, 13, -1), null);
  assert.equal(transportStep(5, 13, -1), 4);
  assert.equal(transportStep(12, 13, 1), null);
  const first = flightTransport(0, 13, "paused", false, m);
  assert.equal(first.previous, false);
  assert.equal(first.next, true);
  const later = flightTransport(5, 13, "paused", false, m);
  assert.equal(later.previous, true);
  assert.equal(later.next, true);
  // Row navigation in Recorded history is unchanged: with nothing selected, Previous selects the last row.
  assert.equal(selectionStep(-1, 13, -1), 12);
  assert.equal(selectionStep(-1, 13, 1), 0);
});

test("#192 one recorded movement can be played, and restarted once painted", () => {
  const idle = flightTransport(-1, 1, "idle", false, m);
  assert.equal(idle.control.action, "play");
  assert.equal(idle.control.label, "Play replay");
  assert.equal(idle.next, true);
  assert.equal(idle.previous, false);
  // Play paints the one movement, then the cursor ends there, or waits while the run records.
  assert.deepEqual(flightAdvance(0, 1, "playing", false), { cursor: 0, phase: "ended", waiting: false });
  assert.deepEqual(flightAdvance(0, 1, "playing", true), { cursor: 0, phase: "playing", waiting: true });
  const ended = flightTransport(0, 1, "ended", false, m);
  assert.equal(ended.control.action, "restart");
  assert.equal(ended.control.label, "Restart replay");
  assert.equal(ended.previous, false);
  assert.equal(ended.next, false);
  assert.equal(playbackControl(0, 1, false, m).action, "restart");
  assert.equal(playbackControl(-1, 1, false, m).action, "play");
  // Zero movements still leave Play unavailable.
  assert.equal(flightTransport(-1, 0, "idle", false, m).control.action, "unavailable");
});

test("counts and transit sentences are whole phrases per form and per language", async () => {
  const steps = flightSteps((await run(0)).history.observations, checkoutEdges, m);
  const one = steps.slice(0, 1);
  assert.equal(flightPosition(one, -1, m).text, "0 of 1 recorded movement. Nothing selected.");
  assert.equal(flightPosition(one, -1, es).text, "0 de 1 movimiento registrado. No hay nada seleccionado.");
  assert.equal(flightPosition(steps, -1, m).text, `0 of ${steps.length} recorded movements. Nothing selected.`);
  assert.equal(flightPosition(steps, -1, es).text, `0 de ${steps.length} movimientos registrados. No hay nada seleccionado.`);
  assert.equal(flightPosition(one, -1, m).detail, `The 1 recorded movement is at virtual time ${one[0]!.time}.`);
  assert.equal(flightPosition(one, -1, es).detail, `El único movimiento registrado ocurre en el tiempo virtual ${one[0]!.time}.`);
  // The same records, narrated in each language, keep the stored ids and the t= notation.
  const spanish = flightSteps((await run(0)).history.observations, checkoutEdges, es);
  assert.equal(spanish.length, steps.length);
  assert.deepEqual(spanish.map(step => step.observationId), steps.map(step => step.observationId));
  const departure = spanish.find(step => step.leg === "departure")!;
  assert.match(departure.transit, /^Salida: el token sale de .+ y espera a mitad del enlace\./);
  assert.match(departure.route, /Enlace de solicitud|Publicación de MessageBus|Suscripción de MessageBus/);
  const arrival = spanish.find(step => step.leg === "arrival" && step.departure !== undefined)!;
  assert.match(arrival.transit, /^Llegada: el token de la salida que partió en el tiempo virtual \d+ \(observación #\d+\) llega a /);
});

test("the background of a movement is every component that is neither an end of it nor busy at the cursor", () => {
  const ids = ["client", "orders", "payments", "carrier", "topic"];
  const activity = new Map<string, ComponentActivity>([
    // Waiting on an earlier request: still part of the story, so it stays in front.
    ["client", { componentId: "client", state: "waiting", waits: [{ target: "orders" }], work: [] }],
    ["payments", { componentId: "payments", state: "idle", waits: [], work: [] }],
    // Idle again, but this record is its timeout: it stays in front.
    ["carrier", { componentId: "carrier", state: "idle", waits: [], work: [], timedOut: { target: "orders", time: simulationTime(5) } }],
  ]);
  // No movement painted: nothing is in the background, so a graph with no cursor is drawn as before.
  assert.deepEqual([...flightBackground(ids, undefined, activity)], []);
  // `topic` has no recorded activity at all, which reads as idle.
  assert.deepEqual([...flightBackground(ids, { nodeIds: ["orders", "payments"] }, activity)], ["topic"]);
  assert.deepEqual([...flightBackground(ids, { nodeIds: ["orders"] }, activity)], ["payments", "topic"]);
  // An end of the movement is never in the background, even when it is idle.
  assert.deepEqual([...flightBackground(ids, { nodeIds: ["payments", "topic"] }, activity)], ["orders"]);
  // Neither is an end of a hop still in transit: a request is on its way to `payments`.
  assert.deepEqual([...flightBackground(ids, { nodeIds: ["orders"] }, activity, [{ nodeIds: ["client", "payments"] }])], ["topic"]);
});

test("cqrs-delayed: two requests sent at the same virtual time are both on their links until each arrives", async () => {
  const index = scenarios.findIndex(lesson => lesson.id === "cqrs-delayed");
  const projection = await run(index);
  const metadata = packagedMetadata(scenarios[index]!);
  const edges = movementEdges(mapArchitecture(projection.architecture, metadata.architecture, metadata.name, m).edges);
  const steps = flightSteps(projection.history.observations, edges, m);
  // The client reads Orders and Reports at once: two departures, recorded one after the other at one virtual time.
  const second = steps.findIndex((step, at) => at > 0 && step.leg === "departure" && step.from === "client" && step.to === "reporting"
    && steps[at - 1]!.leg === "departure" && steps[at - 1]!.from === "client" && steps[at - 1]!.time === step.time);
  assert.ok(second > 0, "the lesson records the two reads back to back");
  const first = steps[second - 1]!;
  assert.equal(first.to, "orders");

  // With no cursor, and on a movement with nothing sent before it, nothing is in transit.
  assert.deepEqual(flightInTransit(steps, -1), []);
  assert.deepEqual(flightInTransit(steps, 0), []);
  // On the first read, the cursor's own token is the only one. On the second, the first is still on its link.
  assert.deepEqual(flightInTransit(steps, second - 1), []);
  assert.deepEqual(flightInTransit(steps, second).map(step => step.observationId), [first.observationId]);
  assert.equal(flightInTransitText(flightInTransit(steps, second), m), "Still in transit: REQ client → orders.");
  assert.equal(flightInTransitText(flightInTransit(steps, second), es), "Sigue en viaje: REQ client → orders.");
  assert.equal(flightInTransitText([], m), undefined);
  // A component with a request on its way is not in the background.
  assert.ok(!flightBackground(["client", "orders", "reporting"], steps[second], new Map(), flightInTransit(steps, second)).has("orders"));

  // Every hop leaves the list at its own arrival or drop and not before, and nothing is read past the cursor.
  for (let cursor = 0; cursor < steps.length; cursor += 1) {
    const listed = new Set(flightInTransit(steps, cursor).map(step => step.hopId));
    for (let at = 0; at < cursor; at += 1) {
      const step = steps[at]!;
      if (step.leg !== "departure" || step.hopId === undefined) continue;
      const ended = steps.slice(at + 1, cursor + 1).some(later => later.hopId === step.hopId && (later.leg === "arrival" || later.leg === "interrupted"));
      assert.equal(listed.has(step.hopId), !ended, `movement ${cursor + 1}: ${step.hopId}`);
    }
    assert.ok(!listed.has(steps[cursor]!.hopId ?? "none") || steps[cursor]!.leg !== "departure", "the cursor's own departure is not listed");
  }
  // Both reads arrive, so the run ends with nothing in transit.
  assert.deepEqual(flightInTransit(steps, steps.length - 1), []);
});

test("hops in transit are grouped per link, kind, and direction, and a caller's timeout does not end one", () => {
  const leg = (id: string, hop: string, kind: "departure" | "arrival" | "timeout", edgeId: string | undefined, reversed = false) => ({
    observationId: id, hopId: hop, leg: kind, kind: "request", glyph: "REQ", from: "a", to: "b", nodeIds: ["a", "b"], reversed,
    ...(edgeId !== undefined ? { edgeId } : {}),
  }) as unknown as Parameters<typeof flightInTransit>[0][number];
  const steps = [
    leg("s1", "request:1", "departure", "e1"), leg("s2", "request:2", "departure", "e1"), leg("s3", "request:3", "departure", "e2"),
    leg("t1", "request:1", "timeout", "e1"), leg("s4", "request:4", "departure", undefined), leg("d2", "request:2", "arrival", "e1"),
    leg("s5", "request:5", "departure", "e1"),
  ];
  // The timeout of request 1 is the caller's record: the request is still not recorded as arrived or dropped.
  assert.deepEqual(flightInTransit(steps, 4).map(step => step.observationId), ["s1", "s2", "s3"]);
  const groups = flightTransitGroups(flightInTransit(steps, 4));
  // Two requests wait on e1: one token, the latest departure, with a count. A hop on no drawn link is left out.
  assert.deepEqual([...groups.keys()], ["e1", "e2"]);
  assert.deepEqual(groups.get("e1")!.map(group => [group.step.observationId, group.count]), [["s2", 2]]);
  assert.deepEqual(groups.get("e2")!.map(group => [group.step.observationId, group.count]), [["s3", 1]]);
  // More than three are counted, not named.
  const many = [...steps.slice(0, 3), leg("s6", "request:6", "departure", "e1"), leg("s7", "request:7", "departure", "e1"), leg("s8", "request:8", "departure", "e1")];
  assert.equal(flightInTransitText(flightInTransit(many, 5), m), "Still in transit: 5 other movements.");
  assert.equal(flightInTransitText(flightInTransit(many, 5), es), "Siguen en viaje otros 5 movimientos.");
  // A resting token sits just behind mid-link, measured from its own origin.
  assert.equal(transitTokenStyle({ reversed: false }, "M0 0")["--flight-end"], "42%");
  assert.equal(transitTokenStyle({ reversed: true }, "M0 0")["--flight-end"], "58%");
});

test("Left and Right step one movement and Space plays or pauses, unless a control or a chord owns the key", () => {
  const free = { modified: false, repeat: false, arrowsClaimed: false, spaceClaimed: false };
  assert.equal(replayKeyAction({ ...free, key: "ArrowLeft" }), "previous");
  assert.equal(replayKeyAction({ ...free, key: "ArrowRight" }), "next");
  assert.equal(replayKeyAction({ ...free, key: " " }), "toggle");
  // Holding an arrow walks the movements; holding Space must not flip play and pause.
  assert.equal(replayKeyAction({ ...free, key: "ArrowRight", repeat: true }), "next");
  assert.equal(replayKeyAction({ ...free, key: " ", repeat: true }), null);
  // A field, a select, a tab list, or a dialog keeps its arrows; a button or a component node keeps Space.
  assert.equal(replayKeyAction({ ...free, key: "ArrowRight", arrowsClaimed: true }), null);
  assert.equal(replayKeyAction({ ...free, key: "ArrowLeft", arrowsClaimed: true }), null);
  assert.equal(replayKeyAction({ ...free, key: " ", spaceClaimed: true }), null);
  // A button does not use the arrows, so they still step while focus rests on a toolbar button.
  assert.equal(replayKeyAction({ ...free, key: "ArrowRight", spaceClaimed: true }), "next");
  // Browser chords and every other key are left alone.
  assert.equal(replayKeyAction({ ...free, key: "ArrowLeft", modified: true }), null);
  for (const key of ["ArrowUp", "ArrowDown", "Enter", "Escape", "a", "Home"]) assert.equal(replayKeyAction({ ...free, key }), null);
});
