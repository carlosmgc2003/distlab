import assert from "node:assert/strict";
import test from "node:test";
import type { Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import {
  DEFAULT_FLIGHT_PACE,
  FLIGHT_PACES,
  flightBackground,
  flightDelayMs,
  flightFacts,
  flightInTransit,
  flightInTransitText,
  flightPace,
  flightSteps,
  flightStop,
  flightTransitGroups,
  flightLegend,
  flightPaceText,
} from "../src/flight.ts";
import type { ComponentActivity } from "../src/activity.ts";
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
    assert.equal(flightPaceText(pace.id, m).note, `one milestone every ${pace.delayMs / 1000} seconds`);
  }
  assert.deepEqual(FLIGHT_PACES.map(pace => flightPaceText(pace.id, m).label), ["Slow", "Steady", "Fast"]);
  // Spanish writes the interval with the locale's decimal mark.
  assert.equal(flightPaceText("steady", es).note, "un hito cada 0,9 segundos");
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

test("counts and transit sentences are whole phrases per form and per language", async () => {
  const steps = flightSteps((await run(0)).history.observations, checkoutEdges, m);
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
