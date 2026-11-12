import assert from "node:assert/strict";
import test from "node:test";
import type { Observation, ObservationFilter, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { checkoutAssessment, checkoutCatalog, normalCheckout, responseLostCheckout } from "@distlab/catalogs";
import { DeterministicScenarioEngine } from "@distlab/scenario";
import { mapArchitecture, movementEdges } from "../src/architecture-view.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import {
  continuesHistory,
  correlation,
  edgeFor,
  movementOf,
  movementText,
  orderObservations,
  payloadVisibility,
  traceView,
} from "../src/records.ts";
import type { MovementEdge } from "../src/records.ts";
import {
  changeEvidence,
  emphasisFor,
  movementPulseClass,
  payloadCopy,
  recordLabel,
  revealMessage,
  selectionStep,
  terminalCopy,
  terminalMark,
  traceFilterMessage,
} from "../src/timeline.ts";
import { filterObservations, parseTimelineFilter } from "./filter-oracle.ts";
import { messages } from "../src/i18n/catalog.ts";

const m = messages("en");
const es = messages("es");
import { emptyTimelineDraft, narrowToTrace, parseTimelineQuery, queryTimeline, readerFilter, revealTimelineObservation, timelineSuggestions, visibleChoices } from "../src/timeline-query.ts";

const checkoutEdges: readonly MovementEdge[] = [
  { id: "request:customer-app:orders:0", source: "customer-app", target: "orders", relationship: "request" },
  { id: "request:payments:payment-processor:1", source: "payments", target: "payment-processor", relationship: "request" },
  { id: "subscription:OrderCreated:payments:2", source: "OrderCreated", target: "payments", relationship: "subscription" },
  { id: "publication:orders:OrderCreated", source: "orders", target: "OrderCreated", relationship: "publication" },
];

function observation(input: {
  id: string; time: number; sequence: number; type: string; source: string; target?: string;
  traceId?: string; spanId?: string; parentSpanId?: string; causationId?: string; eventId?: string;
  entityRefs?: readonly { kind: string; id: string }[]; data?: Observation["data"]; omitData?: boolean;
}): Observation {
  return {
    schemaVersion: 1, id: input.id, time: simulationTime(input.time), sequence: input.sequence, type: input.type, source: input.source,
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
    ...(input.spanId !== undefined ? { spanId: input.spanId } : {}),
    ...(input.parentSpanId !== undefined ? { parentSpanId: input.parentSpanId } : {}),
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
    ...(input.entityRefs !== undefined ? { entityRefs: input.entityRefs } : {}),
    ...(!input.omitData && input.data !== undefined ? { data: input.data } : {}),
  };
}

const runs = new Map<string, Promise<{ projection: RuntimeProjectionSet; query: (filter: ObservationFilter) => readonly Observation[] }>>();

test("the response-lost checkout records each teaching fact once and the retried delivery attempt", async () => {
  for (const [scenario, choice] of [[normalCheckout, scenarios[0]!], [responseLostCheckout, scenarios[1]!]] as const) {
    const { projection } = await completed(scenario, choice);
    const observations = projection.history.observations;
    if (choice.id === "response-lost") {
      for (const type of ["external.effect.committed", "network.response.dropped", "network.request.timedout"]) {
        assert.equal(observations.filter(item => item.type === type).length, 1);
      }
      const attempts = observations.filter(item => item.type === "message.delivered");
      assert.ok(attempts.some(item => (item.data as Record<string, unknown> | undefined)?.attempt === 2));
    }
  }
});

function completed(scenario: typeof normalCheckout, choice: (typeof scenarios)[number]) {
  const cached = runs.get(choice.id);
  if (cached) return cached;
  const pending = (async () => {
    const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
    const adapter = new WorkerAdapter(event => events.push(event));
    await adapter.receive({ version: 1, requestId: "load", type: "load", scenario });
    await adapter.receive({ version: 1, requestId: "run", type: "run" });
    const projection = events.filter(event => event.type === "projection.updated").at(-1)?.projection;
    assert.ok(projection);
    const session = new DeterministicScenarioEngine({ catalog: checkoutCatalog, assessment: checkoutAssessment }).create(scenario);
    await session.simulation.run();
    assert.deepEqual(structuredClone(projection.history.observations), structuredClone(session.simulation.history.all()));
    return { projection, query: (filter: ObservationFilter) => structuredClone(session.simulation.history.query(filter)) };
  })();
  runs.set(choice.id, pending);
  return pending;
}

test("timeline keeps sequence order when virtual times are equal", () => {
  const rows = [
    observation({ id: "later", time: 10, sequence: 3, type: "network.response.sent", source: "orders", target: "customer-app" }),
    observation({ id: "first", time: 10, sequence: 1, type: "network.request.sent", source: "customer-app", target: "orders" }),
    observation({ id: "middle", time: 10, sequence: 2, type: "network.request.delivered", source: "customer-app", target: "orders" }),
  ];
  assert.deepEqual(orderObservations(rows).map(item => item.id), ["first", "middle", "later"]);
  assert.deepEqual(filterObservations(rows, {}).map(item => item.time), [10, 10, 10]);
  const before = JSON.stringify(rows);
  orderObservations(rows);
  assert.equal(JSON.stringify(rows), before);
});

test("a delivery's label names its stored attempt, in each language", () => {
  const delivery = observation({ id: "delivery-1", time: 1, sequence: 3, type: "message.delivered", source: "payments", data: { attempt: 1 } });
  assert.equal(recordLabel(delivery, m), "Message delivered (attempt 1)");
  assert.equal(recordLabel(delivery, messages("es")), "Mensaje entregado (intento 1)");
});

test("filters match headless history queries and reject invalid virtual-time bounds", async () => {
  const { query } = await completed(normalCheckout, scenarios[0]);
  const all = query({});
  const sample = all.find(item => item.traceId && item.eventId && item.entityRefs?.length);
  const entity = sample?.entityRefs?.[0];
  assert.ok(sample?.traceId && sample.eventId && entity);
  const filters: ObservationFilter[] = [
    {},
    { type: "network.request.sent" },
    { component: "orders" },
    { component: "payment-processor" },
    { traceId: sample.traceId },
    { eventId: sample.eventId },
    { entity },
    { fromTime: simulationTime(0), toTime: simulationTime(0) },
    { type: "message.delivered", component: "payments", traceId: sample.traceId },
  ];
  for (const filter of filters) assert.deepEqual(structuredClone(filterObservations(all, filter)), query(filter));
  assert.ok(filterObservations(all, { type: "network.request.sent" }).every((item, index, list) => index === 0 || item.sequence > list[index - 1]!.sequence));
  assert.deepEqual(parseTimelineFilter({ fromTime: "0", toTime: "10", type: " message.published ", component: " orders ", traceId: "", eventId: "", entityKind: "destination", entityId: "OrderCreated" }), {
    ok: true,
    filter: { fromTime: simulationTime(0), toTime: simulationTime(10), type: "message.published", component: "orders", entity: { kind: "destination", id: "OrderCreated" } },
  });
  assert.equal(parseTimelineFilter({ ...blank(), fromTime: "4", toTime: "1" }).ok, false);
  assert.equal(parseTimelineFilter({ ...blank(), entityKind: "message" }).ok, false);
  assert.equal(parseTimelineFilter({ ...blank(), fromTime: "1.5" }).ok, false);
});

test("trace, span, and causation stay attached to stored before and after data", () => {
  const published = observation({
    id: "published", time: 20, sequence: 1, type: "message.published", source: "orders", traceId: "trace-1", spanId: "span-parent", eventId: "event-1",
    entityRefs: [{ kind: "destination", id: "OrderCreated" }, { kind: "message", id: "message-1" }],
    data: { messageId: "message-1", destination: "OrderCreated" },
  });
  const queued = observation({
    id: "queued", time: 20, sequence: 2, type: "message.queued", source: "orders", traceId: "trace-1", spanId: "span-parent", parentSpanId: "span-root",
    causationId: "published", data: { before: "PUBLISHED", after: "QUEUED", subscriber: "payments" },
  });
  const delivered = observation({
    id: "delivered", time: 20, sequence: 3, type: "message.delivered", source: "payments", traceId: "trace-1", spanId: "span-child", parentSpanId: "span-parent",
    causationId: "missing-cause", entityRefs: [{ kind: "destination", id: "OrderCreated" }],
  });
  const write = observation({
    id: "write", time: 20, sequence: 4, type: "database.write.staged", source: "orders", traceId: "trace-1", spanId: "span-child", parentSpanId: "span-parent",
    causationId: "published", data: { table: "orders", key: "order-1", before: null, after: { status: "CREATED" } },
  });
  const committed = observation({
    id: "committed", time: 21, sequence: 5, type: "database.transaction.committed", source: "orders", traceId: "trace-1", spanId: "span-child",
    data: { changes: [{ table: "orders", key: "order-1", before: null, after: { status: "CREATED" } }] },
  });
  const redacted = observation({ id: "redacted", time: 21, sequence: 6, type: "database.row.read", source: "orders", data: { redacted: true } });
  const omitted = observation({ id: "omitted", time: 21, sequence: 7, type: "database.row.read", source: "orders", omitData: true });
  const rows = [committed, redacted, omitted, write, delivered, queued, published];
  const trace = traceView(rows, "trace-1");
  assert.deepEqual(trace.roots.map(node => node.spanId), ["span-parent"]);
  assert.deepEqual(trace.roots[0]?.children.map(node => node.spanId), ["span-child"]);
  assert.deepEqual(trace.roots[0]?.observations.map(item => item.id), ["published", "queued"]);
  assert.equal(trace.causation.find(item => item.effectId === "delivered")?.causeFound, false);
  assert.equal(trace.causation.find(item => item.effectId === "write")?.causeFound, true);
  const linked = correlation(rows, write);
  assert.equal(linked.cause?.id, "published");
  assert.deepEqual(changeEvidence(write, m).map(item => [item.label, item.before, item.after]), [["Recorded change", null, { status: "CREATED" }]]);
  assert.equal(changeEvidence(committed, m)[0]?.label, "orders order-1");
  assert.deepEqual(changeEvidence(redacted, m), []);
  assert.deepEqual(changeEvidence(omitted, m), []);
  assert.equal(payloadVisibility(redacted), "redacted");
  assert.equal(payloadVisibility(omitted), "omitted");
  assert.equal(payloadCopy(redacted, m), "Stored payload is redacted. Hidden fields are not available.");
  assert.equal(payloadCopy(omitted, m), "No data field was stored.");
  assert.equal(payloadCopy(write, m), "Stored payload");
  assert.equal(JSON.stringify(redacted).includes("invented-secret"), false);
});

test("request and message observations project onto the checkout links", async () => {
  for (const [scenario, choice] of [[normalCheckout, scenarios[0]], [responseLostCheckout, scenarios[1]]] as const) {
    const { projection } = await completed(scenario, choice);
    const metadata = packagedMetadata(choice);
    const edges = movementEdges(mapArchitecture(projection.architecture, metadata.architecture, metadata.name, m).edges);
    assert.deepEqual(edges.map(edge => [edge.source, edge.target, edge.relationship]), checkoutEdges.map(edge => [edge.source, edge.target, edge.relationship]));
    const observations = projection.history.observations;
    const request = observations.find(item => item.type === "network.request.sent" && item.source === "customer-app");
    const response = observations.find(item => item.type === "network.response.sent" && item.source === "payment-processor");
    const published = observations.find(item => item.type === "message.published");
    const delivered = observations.find(item => item.type === "message.delivered");
    const acknowledged = observations.find(item => item.type === "message.acknowledged");
    assert.ok(request && response && published && delivered && acknowledged);
    assert.equal(edgeFor(movementOf(request)!, edges)?.id, edges.find(edge => edge.source === "customer-app")?.id);
    assert.match(movementText(movementOf(request)!, m), /Request sent from customer-app to orders at virtual time/);
    assert.equal(edgeFor(movementOf(response)!, edges)?.id, edges.find(edge => edge.source === "payments" && edge.target === "payment-processor")?.id);
    assert.match(movementText(movementOf(response)!, m), /Response sent from payment-processor to payments/);
    assert.equal(edgeFor(movementOf(published)!, edges)?.id, edges.find(edge => edge.relationship === "publication")?.id);
    assert.match(movementText(movementOf(delivered)!, m), /Message delivered from OrderCreated to payments/);
    assert.equal(edgeFor(movementOf(delivered)!, edges)?.id, edges.find(edge => edge.relationship === "subscription")?.id);
    assert.match(movementText(movementOf(acknowledged)!, m), /Message acknowledged by payments on OrderCreated/);
    const redactedPublished = { ...published, data: { redacted: true } };
    assert.equal(edgeFor(movementOf(redactedPublished)!, edges)?.id, edgeFor(movementOf(published)!, edges)?.id);
    assert.equal(movementText(movementOf(redactedPublished)!, m).includes("OrderCreated"), true);
    const emphasis = emphasisFor(request, edges, m);
    assert.equal(emphasis.kind, "request");
    assert.equal(emphasis.pulseId, request.id);
    assert.match(movementPulseClass(request.id), /^pulse-[a-z0-9]+$/);
    const quiet = emphasisFor(observations.find(item => item.type === "simulation.created")!, edges, m);
    assert.equal(quiet.kind, undefined);
    assert.match(quiet.text ?? "", /No request or message movement/);
  }
  const lost = await completed(responseLostCheckout, scenarios[1]);
  const dropped = lost.projection.history.observations.find(item => item.type === "network.response.dropped");
  assert.ok(dropped);
  assert.match(movementText(movementOf(dropped)!, m), /Response dropped from payment-processor to payments/);
});

test("visible-history suggestions refresh across runs and exact mode matches the reader", async () => {
  const normal = await completed(normalCheckout, scenarios[0]);
  const lost = await completed(responseLostCheckout, scenarios[1]);
  const normalTypes = timelineSuggestions(normal.projection.history.observations, [], m).types.map(choice => choice.value);
  const lostTypes = timelineSuggestions(lost.projection.history.observations, [], m).types.map(choice => choice.value);
  assert.equal(normalTypes.includes("network.response.dropped"), false);
  assert.equal(lostTypes.includes("network.response.dropped"), true);
  assert.equal(visibleChoices(timelineSuggestions(lost.projection.history.observations, [], m).types, "network").shown.some(choice => choice.value === "network.response.dropped"), true);
  const chosen = parseTimelineQuery({ ...emptyTimelineDraft, type: "network.response.dropped", typeMode: "exact" });
  assert.equal(chosen.ok, true);
  if (!chosen.ok) return;
  const dropped = queryTimeline(lost.projection.history.observations, chosen.query);
  assert.ok(dropped.length > 0);
  assert.equal(dropped.every(item => item.type === "network.response.dropped"), true);
  assert.deepEqual(structuredClone(dropped), lost.query({ type: "network.response.dropped" }));
  const prefix = parseTimelineQuery({ ...emptyTimelineDraft, type: "network", typeMode: "prefix" });
  assert.equal(prefix.ok, true);
  if (!prefix.ok) return;
  assert.equal(readerFilter(prefix.query), undefined);
  const prefixed = queryTimeline(lost.projection.history.observations, prefix.query);
  assert.ok(prefixed.length > dropped.length);
  assert.equal(prefixed.every(item => item.type.startsWith("network")), true);
  const cases = [
    { draft: {}, filter: {} },
    { draft: { type: "network.request.sent" }, filter: { type: "network.request.sent" } },
    { draft: { component: "orders" }, filter: { component: "orders" } },
    { draft: { component: "payment-processor" }, filter: { component: "payment-processor" } },
  ] as const;
  for (const item of cases) {
    const parsed = parseTimelineQuery({ ...emptyTimelineDraft, ...item.draft });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    assert.deepEqual(structuredClone(queryTimeline(normal.projection.history.observations, parsed.query)), normal.query(item.filter));
    assert.deepEqual(queryTimeline(normal.projection.history.observations, parsed.query).map(row => row.id), filterObservations(normal.projection.history.observations, item.filter).map(row => row.id));
  }
});

test("movement only highlights an edge with the matching relationship", () => {
  const edges: MovementEdge[] = [
    { id: "publication", source: "orders", target: "payments", relationship: "publication" },
    { id: "request", source: "payments", target: "orders", relationship: "request" },
  ];
  const response = observation({ id: "response", time: 1, sequence: 1, type: "network.response.sent", source: "orders", target: "payments" });
  assert.equal(edgeFor(movementOf(response)!, edges)?.id, "request");
  // A drawn publication link is not the link a response travels, even for the same components.
  assert.equal(edgeFor(movementOf(response)!, edges.filter(edge => edge.relationship === "publication")), undefined);
});

test("playback, filters, and reset stay on the UI copy of history", () => {
  const rows = [observation({ id: "a", time: 0, sequence: 0, type: "simulation.created", source: "simulation" })];
  const copy = structuredClone(rows);
  assert.deepEqual(rows, copy);
  assert.equal(continuesHistory(rows, [...rows, observation({ id: "b", time: 1, sequence: 1, type: "clock.advanced", source: "simulation" })]), true);
  assert.equal(continuesHistory([...rows, observation({ id: "b", time: 1, sequence: 1, type: "clock.advanced", source: "simulation" })], rows), false);
  const incomplete = terminalMark("FAILED", { code: "SIMULATION_FAILED", message: "failed", context: { code: "HISTORY_LIMIT_EXCEEDED", historyComplete: false, time: 4, lastObservationId: "observation-9" } });
  assert.ok(incomplete);
  assert.match(terminalCopy(incomplete, m), /HISTORY_LIMIT_EXCEEDED/);
  assert.match(terminalCopy(incomplete, m), /incomplete/);
  assert.match(terminalCopy(incomplete, m), /observation-9/);
  assert.match(terminalCopy(terminalMark(null, { code: "SIMULATION_FAILED", message: "failed", context: { code: "UNKNOWN" } })!, m), /not reported/);
  assert.equal(terminalMark("COMPLETED", null), null);
});

test("previous and next follow whether the visible selection can change", () => {
  assert.equal(selectionStep(-1, 0, 1), null);
  assert.equal(selectionStep(-1, 0, -1), null);
  assert.equal(selectionStep(-1, 1, 1), 0);
  assert.equal(selectionStep(-1, 1, -1), 0);
  assert.equal(selectionStep(0, 1, 1), null);
  assert.equal(selectionStep(0, 1, -1), null);
  assert.equal(selectionStep(-1, 3, 1), 0);
  assert.equal(selectionStep(-1, 3, -1), 2);
  assert.equal(selectionStep(0, 3, -1), null);
  assert.equal(selectionStep(2, 3, 1), null);
  assert.equal(selectionStep(1, 3, 1), 2);
  const rows = [observation({ id: "a", time: 0, sequence: 0, type: "simulation.created", source: "simulation" })];
  assert.equal(JSON.stringify(rows), JSON.stringify(structuredClone(rows)));
});

test("navigation clears only the filters that hide the destination", () => {
  const cause = observation({
    id: "cause", time: 5, sequence: 174, type: "external.effect.committed", source: "payment-processor",
    traceId: "trace-9", eventId: "event-2", entityRefs: [{ kind: "authorization", id: "authorization-1" }],
  });
  const before = structuredClone(cause);
  const hidden = revealTimelineObservation({ ...emptyTimelineDraft, type: "network.response.dropped", component: "payment-processor" }, cause);
  assert.deepEqual(hidden.cleared, ["type"]);
  assert.equal(hidden.draft.type, "");
  assert.equal(hidden.draft.component, "payment-processor");
  const hiddenReader = readerFilter(hidden.query);
  assert.ok(hiddenReader);
  assert.equal(hiddenReader.type, undefined);
  assert.equal(hiddenReader.component, "payment-processor");
  assert.deepEqual(filterObservations([cause], hiddenReader).map(item => item.id), ["cause"]);
  assert.match(revealMessage(hidden.cleared, cause, m), /The type filter was cleared so this observation is visible/);
  const visible = revealTimelineObservation({ ...emptyTimelineDraft, component: "payment-processor" }, cause);
  assert.equal(visible.changed, false);
  assert.match(revealMessage(visible.cleared, cause, m), /^Selected Observation #174: external\.effect\.committed at virtual time 5\.$/);
  const prefixed = revealTimelineObservation({
    ...emptyTimelineDraft, type: "external", typeMode: "prefix", component: "pay", componentMode: "prefix",
  }, cause);
  assert.deepEqual(prefixed.cleared, []);
  assert.equal(prefixed.draft.typeMode, "prefix");
  assert.equal(prefixed.draft.component, "pay");
  const missed = revealTimelineObservation({ ...emptyTimelineDraft, type: "network", typeMode: "contains" }, cause);
  assert.deepEqual(missed.cleared, ["type"]);
  assert.equal(missed.draft.type, "");
  assert.equal(missed.draft.typeMode, "exact");
  const several = revealTimelineObservation({
    ...emptyTimelineDraft, type: "network.response.dropped", traceId: "other", fromTime: "20", entityKind: "order", entityId: "order-1",
  }, cause);
  assert.deepEqual(several.cleared, ["fromTime", "type", "traceId", "entity"]);
  assert.match(revealMessage(several.cleared, cause, m), /virtual time from, type, trace, and entity filters were cleared/);
  const invalid = revealTimelineObservation({ ...emptyTimelineDraft, fromTime: "nope", type: "other" }, cause);
  assert.equal(invalid.draft.fromTime, "");
  assert.equal(invalid.draft.type, "");
  const invalidReader = readerFilter(invalid.query);
  assert.ok(invalidReader);
  assert.equal(invalidReader.fromTime, undefined);
  assert.equal(invalidReader.type, undefined);
  assert.match(revealMessage(invalid.cleared, cause, m), /cleared so this observation is visible/);
  const invertedAtUpperBound = revealTimelineObservation({ ...emptyTimelineDraft, fromTime: "10", toTime: "5" }, cause);
  assert.deepEqual(invertedAtUpperBound.cleared, ["fromTime"]);
  assert.equal(invertedAtUpperBound.draft.toTime, "5");
  assert.deepEqual(readerFilter(invertedAtUpperBound.query), { toTime: 5 });
  const invertedBetweenBounds = revealTimelineObservation({ ...emptyTimelineDraft, fromTime: "10", toTime: "2" }, cause);
  assert.deepEqual(invertedBetweenBounds.cleared, ["fromTime", "toTime"]);
  assert.deepEqual(readerFilter(invertedBetweenBounds.query), {});
  const trace = narrowToTrace({ ...emptyTimelineDraft, type: "network.response.dropped", traceId: "other" }, "trace-9");
  assert.equal(trace.changed, true);
  assert.deepEqual(trace.draft, { ...emptyTimelineDraft, traceId: "trace-9" });
  assert.match(traceFilterMessage("trace-9", trace, m), /The timeline now shows trace trace-9/);
  assert.match(traceFilterMessage("trace-9", trace, m), /type and trace filters were cleared/);
  const same = narrowToTrace({ ...emptyTimelineDraft, traceId: "trace-9" }, "trace-9");
  assert.equal(same.changed, false);
  assert.match(traceFilterMessage("trace-9", same, m), /already shows trace trace-9/);
  const opened = narrowToTrace(emptyTimelineDraft, "trace-9");
  assert.equal(opened.cleared.length, 0);
  assert.match(traceFilterMessage("trace-9", opened, m), /The timeline now shows trace trace-9\.$/);
  assert.deepEqual(cause, before);
});

test("the lost-response checkout has one dropped response in canonical sequence order", async () => {
  const { projection } = await completed(responseLostCheckout, scenarios[1]);
  const dropped = projection.history.observations.filter(item => item.type === "network.response.dropped");
  assert.equal(dropped.length, 1);
  const droppedResponse = dropped[0]!;
  assert.ok(projection.history.observations.every((item, index, observations) =>
    index === 0 || item.sequence > observations[index - 1]!.sequence));
  const assertions = projection.history.observations.filter(item => item.type === "scenario.assertion.evaluated");
  assert.ok(assertions.length > 1);
  const authorization = projection.history.observations.find(item => item.type === "external.effect.committed" && item.source === "payment-processor");
  assert.ok(authorization?.traceId);
  assert.ok(authorization.sequence < droppedResponse.sequence);
  assert.notEqual(authorization.type, droppedResponse.type);
  assert.ok(droppedResponse.causationId);
  assert.ok(droppedResponse.traceId);
  assert.ok(projection.history.observations.some(item => item.id === droppedResponse.causationId));
});

test("observation headings describe only stored fields and never reconstruct redacted payloads", () => {
  const headings: Record<string, string> = {
    "network.request.sent": "Request sent",
    "network.request.delivered": "Request delivered",
    "network.request.dropped": "Request dropped",
    "network.request.timedout": "Request timed out",
    "network.response.sent": "Response sent",
    "network.response.received": "Response received",
    "network.response.dropped": "Response dropped",
    "message.published": "Message published",
    "message.acknowledged": "Message acknowledged",
    "message.ack.stale": "Stale message acknowledgement",
    "message.retry.scheduled": "Message retry scheduled",
    "database.transaction.committed": "Database transaction committed",
    "database.transaction.rolledback": "Database transaction rolled back",
    "external.effect.committed": "External side effect committed",
    "fault.effect.selected": "Fault effect selected",
    "fault.rule.matched": "Fault rule matched",
    "fault.custom.rule": "Fault recorded",
  };
  for (const [type, heading] of Object.entries(headings)) {
    assert.equal(recordLabel(observation({ id: type, time: 1, sequence: 1, type, source: "orders" }), m), heading);
  }
  const delivered = observation({ id: "delivered", time: 1, sequence: 2, type: "message.delivered", source: "payments", data: { attempt: 2 } });
  assert.equal(recordLabel(delivered, m), "Message delivered (attempt 2)");
  const redactedDelivered = observation({ id: "redacted", time: 1, sequence: 3, type: "message.delivered", source: "payments", data: { redacted: true } });
  assert.equal(recordLabel(redactedDelivered, m), "Message delivered");
  assert.equal(JSON.stringify(redactedDelivered).includes("invented-secret"), false);
  const before = structuredClone(delivered);
  recordLabel(delivered, m);
  assert.deepEqual(delivered, before);
});

function blank() {
  return { fromTime: "", toTime: "", type: "", component: "", traceId: "", eventId: "", entityKind: "", entityId: "" };
}

test("labels and cleared-filter lists follow the language through plural and list rules", () => {
  const delivered = observation({ id: "d", time: 1, sequence: 2, type: "message.delivered", source: "payments", data: { attempt: 2 } });
  assert.equal(recordLabel(delivered, es), "Mensaje entregado (intento 2)");
  assert.equal(recordLabel(observation({ id: "x", time: 1, sequence: 1, type: "unknown.type", source: "orders" }), es), "unknown.type");
  const cause = observation({ id: "c", time: 5, sequence: 7, type: "external.effect.committed", source: "payment-processor" });
  // One cleared filter is singular, several are a list; codes are deduplicated before any text exists.
  assert.equal(revealMessage(["type"], cause, m), "Selected Observation #7: external.effect.committed at virtual time 5. The type filter was cleared so this observation is visible.");
  assert.match(revealMessage(["type"], cause, es), /Se quitó el filtro de tipo para que esta observación sea visible\.$/);
  assert.match(revealMessage(["type", "traceId", "entity"], cause, es), /Se quitaron los filtros de tipo, traza y entidad para que/);
  assert.match(revealMessage([{ quickView: "messages" }], cause, m), /The messages quick view filter was cleared/);
  assert.match(revealMessage([{ quickView: "messages" }], cause, es), /vista rápida mensajes/);
  assert.match(traceFilterMessage("t", { changed: true, cleared: ["type", "component"] }, es), /^La línea de tiempo ahora muestra la traza t\. Se quitaron los filtros de tipo y componente\.$/);
  const mark = terminalMark("FAILED", { code: "SIMULATION_FAILED", message: "failed", context: { code: "HISTORY_LIMIT_EXCEEDED", historyComplete: true, time: 4, lastObservationId: "o-9" } })!;
  assert.equal(terminalCopy(mark, m), "Terminal failure HISTORY_LIMIT_EXCEEDED. Execution history is complete. Last recorded observation: o-9.");
  assert.equal(terminalCopy(mark, es), "Falla terminal HISTORY_LIMIT_EXCEEDED. El historial de la ejecución está completo. Última observación registrada: o-9.");
  assert.equal(emphasisFor(observation({ id: "q", time: 1, sequence: 1, type: "simulation.created", source: "simulation" }), [], es).text,
    "Elegiste simulation.created en simulation en el tiempo virtual 1. No hay movimiento de solicitud ni de mensaje.");
});
