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
  boundaryCopy,
  changeEvidence,
  continuesHistory,
  correlation,
  emphasisFor,
  filterObservations,
  movementCue,
  movementMessage,
  movementPulseClass,
  orderObservations,
  parseTimelineFilter,
  payloadCopy,
  payloadVisibility,
  playbackAdvance,
  playbackControl,
  playbackStatus,
  revealMessage,
  selectionStep,
  terminalCopy,
  terminalMark,
  traceFilterMessage,
  traceView,
  visibleRowRange,
} from "../src/timeline.ts";
import type { MovementEdge } from "../src/timeline.ts";
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
  assert.deepEqual(changeEvidence(write).map(item => [item.label, item.before, item.after]), [["Recorded change", null, { status: "CREATED" }]]);
  assert.equal(changeEvidence(committed)[0]?.label, "orders order-1");
  assert.deepEqual(changeEvidence(redacted), []);
  assert.deepEqual(changeEvidence(omitted), []);
  assert.equal(payloadVisibility(redacted), "redacted");
  assert.equal(payloadVisibility(omitted), "omitted");
  assert.equal(payloadCopy(redacted), "Stored payload is redacted. Hidden fields are not available.");
  assert.equal(payloadCopy(omitted), "No data field was stored.");
  assert.equal(payloadCopy(write), "Stored payload");
  assert.equal(JSON.stringify(redacted).includes("invented-secret"), false);
});

test("request and message observations project onto the checkout links", async () => {
  for (const [scenario, choice] of [[normalCheckout, scenarios[0]], [responseLostCheckout, scenarios[1]]] as const) {
    const { projection } = await completed(scenario, choice);
    const metadata = packagedMetadata(choice);
    const edges = movementEdges(mapArchitecture(projection.architecture, metadata.architecture, metadata.name).edges);
    assert.deepEqual(edges.map(edge => [edge.source, edge.target, edge.relationship]), checkoutEdges.map(edge => [edge.source, edge.target, edge.relationship]));
    const observations = projection.history.observations;
    const request = observations.find(item => item.type === "network.request.sent" && item.source === "customer-app");
    const response = observations.find(item => item.type === "network.response.sent" && item.source === "payment-processor");
    const published = observations.find(item => item.type === "message.published");
    const delivered = observations.find(item => item.type === "message.delivered");
    const acknowledged = observations.find(item => item.type === "message.acknowledged");
    assert.ok(request && response && published && delivered && acknowledged);
    assert.equal(movementCue(request, edges)?.edgeId, edges.find(edge => edge.source === "customer-app")?.id);
    assert.match(movementCue(request, edges)?.text ?? "", /Request sent from customer-app to orders at virtual time/);
    assert.equal(movementCue(response, edges)?.edgeId, edges.find(edge => edge.source === "payments" && edge.target === "payment-processor")?.id);
    assert.match(movementCue(response, edges)?.text ?? "", /Response sent from payment-processor to payments/);
    assert.equal(movementCue(published, edges)?.edgeId, edges.find(edge => edge.relationship === "publication")?.id);
    assert.match(movementCue(delivered, edges)?.text ?? "", /Message delivered from OrderCreated to payments/);
    assert.equal(movementCue(delivered, edges)?.edgeId, edges.find(edge => edge.relationship === "subscription")?.id);
    assert.match(movementCue(acknowledged, edges)?.text ?? "", /Message acknowledged by payments on OrderCreated/);
    const redactedPublished = { ...published, data: { redacted: true } };
    assert.equal(movementCue(redactedPublished, edges)?.edgeId, movementCue(published, edges)?.edgeId);
    assert.equal(movementCue(redactedPublished, edges)?.text.includes("OrderCreated"), true);
    const emphasis = emphasisFor(request, edges);
    assert.equal(emphasis.kind, "request");
    assert.equal(emphasis.pulseId, request.id);
    assert.match(movementPulseClass(request.id), /^pulse-[a-z0-9]+$/);
    const quiet = emphasisFor(observations.find(item => item.type === "simulation.created")!, edges);
    assert.equal(quiet.kind, undefined);
    assert.match(quiet.text ?? "", /No request or message movement/);
  }
  const lost = await completed(responseLostCheckout, scenarios[1]);
  const dropped = lost.projection.history.observations.find(item => item.type === "network.response.dropped");
  assert.ok(dropped);
  assert.match(movementCue(dropped, checkoutEdges)?.text ?? "", /Response dropped from payment-processor to payments/);
});

test("visible-history suggestions refresh across runs and exact mode matches the reader", async () => {
  const normal = await completed(normalCheckout, scenarios[0]);
  const lost = await completed(responseLostCheckout, scenarios[1]);
  const normalTypes = timelineSuggestions(normal.projection.history.observations).types.map(choice => choice.value);
  const lostTypes = timelineSuggestions(lost.projection.history.observations).types.map(choice => choice.value);
  assert.equal(normalTypes.includes("network.response.dropped"), false);
  assert.equal(lostTypes.includes("network.response.dropped"), true);
  assert.equal(visibleChoices(timelineSuggestions(lost.projection.history.observations).types, "network").shown.some(choice => choice.value === "network.response.dropped"), true);
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
  assert.equal(movementCue(response, edges)?.edgeId, "request");
  assert.equal(movementCue(response, edges.filter(edge => edge.relationship === "publication"))?.edgeId, undefined);
});

test("playback, filters, and reset stay on the UI copy of history", () => {
  const rows = [observation({ id: "a", time: 0, sequence: 0, type: "simulation.created", source: "simulation" })];
  const copy = structuredClone(rows);
  assert.deepEqual(playbackAdvance(-1, 3), { cursor: 0, playing: true });
  assert.deepEqual(playbackAdvance(1, 3), { cursor: 2, playing: true });
  assert.deepEqual(playbackAdvance(2, 3), { cursor: 2, playing: false });
  assert.deepEqual(playbackAdvance(0, 0), { cursor: -1, playing: false });
  assert.deepEqual(rows, copy);
  assert.equal(continuesHistory(rows, [...rows, observation({ id: "b", time: 1, sequence: 1, type: "clock.advanced", source: "simulation" })]), true);
  assert.equal(continuesHistory([...rows, observation({ id: "b", time: 1, sequence: 1, type: "clock.advanced", source: "simulation" })], rows), false);
  const window = visibleRowRange(100_000, 10_000, 320, 44);
  assert.ok(window.end - window.start < 30);
  assert.equal(window.start >= 0 && window.end <= 100_000, true);
  const incomplete = terminalMark("FAILED", { code: "SIMULATION_FAILED", message: "failed", context: { code: "HISTORY_LIMIT_EXCEEDED", historyComplete: false, time: 4, lastObservationId: "observation-9" } });
  assert.ok(incomplete);
  assert.match(terminalCopy(incomplete), /HISTORY_LIMIT_EXCEEDED/);
  assert.match(terminalCopy(incomplete), /incomplete/);
  assert.match(terminalCopy(incomplete), /observation-9/);
  assert.match(terminalCopy(terminalMark(null, { code: "SIMULATION_FAILED", message: "failed", context: { code: "UNKNOWN" } })!), /not reported/);
  assert.equal(terminalMark("COMPLETED", null), null);
});

test("previous, next, and playback follow whether the visible selection can change", () => {
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
  assert.match(boundaryCopy(0, 1), /Previous and Next cannot move/);
  assert.match(boundaryCopy(2, 3), /Next cannot move/);
  assert.match(boundaryCopy(0, 3), /Previous cannot move/);
  assert.match(boundaryCopy(-1, 0), /No visible observations/);
  assert.equal(playbackControl(-1, 0, false).action, "unavailable");
  assert.equal(playbackControl(0, 1, false).action, "unavailable");
  assert.equal(playbackControl(-1, 4, false).label, "Play timeline");
  assert.equal(playbackControl(1, 4, false).action, "play");
  assert.equal(playbackControl(3, 4, false).label, "Restart timeline");
  assert.equal(playbackControl(1, 4, true).action, "unavailable");
  assert.match(playbackStatus("ended", playbackControl(3, 4, false)), /Restart timeline/);
  assert.match(playbackStatus("playing", playbackControl(1, 4, true)), /Pause/);
  assert.match(playbackStatus("paused", playbackControl(1, 4, false)), /paused/);
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
  assert.match(revealMessage(hidden.cleared, cause), /The type filter was cleared so this observation is visible/);
  const visible = revealTimelineObservation({ ...emptyTimelineDraft, component: "payment-processor" }, cause);
  assert.equal(visible.changed, false);
  assert.match(revealMessage(visible.cleared, cause), /^Selected #174 external\.effect\.committed at virtual time 5\.$/);
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
  assert.deepEqual(several.cleared, ["virtual time from", "type", "trace", "entity"]);
  assert.match(revealMessage(several.cleared, cause), /virtual time from, type, trace, and entity filters were cleared/);
  const invalid = revealTimelineObservation({ ...emptyTimelineDraft, fromTime: "nope", type: "other" }, cause);
  assert.equal(invalid.draft.fromTime, "");
  assert.equal(invalid.draft.type, "");
  const invalidReader = readerFilter(invalid.query);
  assert.ok(invalidReader);
  assert.equal(invalidReader.fromTime, undefined);
  assert.equal(invalidReader.type, undefined);
  assert.match(revealMessage(invalid.cleared, cause), /cleared so this observation is visible/);
  const invertedAtUpperBound = revealTimelineObservation({ ...emptyTimelineDraft, fromTime: "10", toTime: "5" }, cause);
  assert.deepEqual(invertedAtUpperBound.cleared, ["virtual time from"]);
  assert.equal(invertedAtUpperBound.draft.toTime, "5");
  assert.deepEqual(readerFilter(invertedAtUpperBound.query), { toTime: 5 });
  const invertedBetweenBounds = revealTimelineObservation({ ...emptyTimelineDraft, fromTime: "10", toTime: "2" }, cause);
  assert.deepEqual(invertedBetweenBounds.cleared, ["virtual time from", "virtual time to"]);
  assert.deepEqual(readerFilter(invertedBetweenBounds.query), {});
  const trace = narrowToTrace({ ...emptyTimelineDraft, type: "network.response.dropped", traceId: "other" }, "trace-9");
  assert.equal(trace.changed, true);
  assert.deepEqual(trace.draft, { ...emptyTimelineDraft, traceId: "trace-9" });
  assert.match(traceFilterMessage("trace-9", trace), /The timeline now shows trace trace-9/);
  assert.match(traceFilterMessage("trace-9", trace), /type and trace filters were cleared/);
  const same = narrowToTrace({ ...emptyTimelineDraft, traceId: "trace-9" }, "trace-9");
  assert.equal(same.changed, false);
  assert.match(traceFilterMessage("trace-9", same), /already shows trace trace-9/);
  const opened = narrowToTrace(emptyTimelineDraft, "trace-9");
  assert.equal(opened.cleared.length, 0);
  assert.match(traceFilterMessage("trace-9", opened), /The timeline now shows trace trace-9\.$/);
  assert.match(movementMessage(cause, 0, 1), /Selected #174/);
  assert.match(movementMessage(cause, 0, 1), /cannot move/);
  assert.deepEqual(cause, before);
});

test("the lost-response checkout has one dropped response at sequence 197", async () => {
  const { projection } = await completed(responseLostCheckout, scenarios[1]);
  const dropped = projection.history.observations.filter(item => item.type === "network.response.dropped");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0]?.sequence, 197);
  const assertions = projection.history.observations.filter(item => item.type === "scenario.assertion.evaluated");
  assert.ok(assertions.length > 1);
  const authorization = projection.history.observations.find(item => item.type === "external.effect.committed" && item.source === "payment-processor");
  assert.ok(authorization?.traceId);
  assert.notEqual(authorization.type, dropped[0]?.type);
  assert.ok(dropped[0]?.causationId);
  assert.ok(dropped[0]?.traceId);
  assert.ok(projection.history.observations.some(item => item.id === dropped[0]?.causationId));
});

function blank() {
  return { fromTime: "", toTime: "", type: "", component: "", traceId: "", eventId: "", entityKind: "", entityId: "" };
}
