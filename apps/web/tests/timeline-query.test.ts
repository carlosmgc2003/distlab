import assert from "node:assert/strict";
import test from "node:test";
import type { Observation } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { filterObservations } from "../src/timeline.ts";
import {
  TIMELINE_FILTER_HELP,
  activeFilterChips,
  clearTimelineField,
  componentLabel,
  emptyFilterExplanation,
  emptyTimelineDraft,
  parseTimelineQuery,
  queryTimeline,
  readerFilter,
  timelineDraftIsBlank,
  timelineSuggestions,
  traceOnlyDraft,
  visibleChoices,
  withExactValue,
} from "../src/timeline-query.ts";
import type { TimelineDraft } from "../src/timeline-query.ts";

function observation(input: {
  id: string; time: number; sequence: number; type: string; source: string; target?: string;
  traceId?: string; eventId?: string; entityRefs?: readonly { kind: string; id: string }[];
  data?: Observation["data"]; omitData?: boolean;
}): Observation {
  return {
    schemaVersion: 1, id: input.id, time: simulationTime(input.time), sequence: input.sequence, type: input.type, source: input.source,
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
    ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
    ...(input.entityRefs !== undefined ? { entityRefs: input.entityRefs } : {}),
    ...(!input.omitData && input.data !== undefined ? { data: input.data } : {}),
  };
}

function draft(overrides: Partial<TimelineDraft> = {}): TimelineDraft {
  return { ...emptyTimelineDraft, ...overrides };
}

const titles = [
  { id: "orders", title: "Orders" },
  { id: "payments", title: "Payments" },
  { id: "payment-processor", title: "Payment Processor" },
  { id: "customer-app", title: "Customer App" },
  { id: "ghost", title: "Ghost" },
];

const rows = [
  observation({
    id: "dropped", time: 4, sequence: 3, type: "network.response.dropped", source: "payment-processor", target: "payments",
    traceId: "trace-pay", eventId: "event-pay", entityRefs: [{ kind: "order", id: "order-1" }, { kind: "message", id: "message-9" }],
    data: { secret: "hidden-assessment-token", messageId: "not-an-event", nestedType: "network.secret.hidden" },
  }),
  observation({
    id: "request", time: 1, sequence: 1, type: "network.request.sent", source: "customer-app", target: "orders",
    traceId: "trace-order", eventId: "event-order", entityRefs: [{ kind: "order", id: "order-1" }],
  }),
  observation({
    id: "sent", time: 2, sequence: 2, type: "network.response.sent", source: "orders", target: "customer-app", traceId: "trace-order",
  }),
  observation({ id: "created", time: 0, sequence: 0, type: "simulation.created", source: "simulation", data: { redacted: true } }),
  observation({ id: "quiet", time: 9, sequence: 4, type: "database.row.read", source: "orders", omitData: true, entityRefs: [{ kind: "message", id: "order-1" }] }),
];

test("exact timeline queries match the history filter and partial modes stay out of the reader", () => {
  const exact = parseTimelineQuery(draft({ fromTime: " 0 ", toTime: "4", type: " network.response.dropped ", component: "payments", traceId: "trace-pay", eventId: "event-pay", entityKind: "order", entityId: "order-1" }));
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  const filter = {
    fromTime: simulationTime(0), toTime: simulationTime(4), type: "network.response.dropped", component: "payments",
    traceId: "trace-pay", eventId: "event-pay", entity: { kind: "order", id: "order-1" },
  };
  assert.deepEqual(readerFilter(exact.query), filter);
  assert.deepEqual(queryTimeline(rows, exact.query).map(item => item.id), filterObservations(rows, filter).map(item => item.id));
  assert.deepEqual(queryTimeline(rows, exact.query).map(item => item.id), ["dropped"]);

  const prefix = parseTimelineQuery(draft({ type: "network", typeMode: "prefix" }));
  assert.equal(prefix.ok, true);
  if (!prefix.ok) return;
  assert.equal(readerFilter(prefix.query), undefined);
  const prefixed = queryTimeline(rows, prefix.query).map(item => item.id);
  assert.deepEqual(prefixed, ["request", "sent", "dropped"]);
  assert.deepEqual(prefixed, queryTimeline([...rows].reverse(), prefix.query).map(item => item.id));

  const contains = parseTimelineQuery(draft({ type: "response.dropped", typeMode: "contains" }));
  assert.equal(contains.ok, true);
  if (!contains.ok) return;
  assert.deepEqual(queryTimeline(rows, contains.query).map(item => item.id), ["dropped"]);
  assert.deepEqual(queryTimeline(rows, { type: { value: "response.dropped", mode: "prefix" } }).map(item => item.id), []);
  assert.deepEqual(queryTimeline(rows, { type: { value: "Network", mode: "prefix" } }).map(item => item.id), []);
});

test("suggestions expose only visible canonical fields and refresh when the run is replaced", () => {
  const before = JSON.stringify(rows);
  const suggestions = timelineSuggestions(rows, titles);
  queryTimeline(rows, { type: { value: "network", mode: "prefix" } });
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(suggestions.types.map(choice => choice.value), ["database.row.read", "network.request.sent", "network.response.dropped", "network.response.sent", "simulation.created"]);
  assert.equal(suggestions.types.some(choice => choice.value === "network.secret.hidden"), false);
  assert.deepEqual(suggestions.components.map(choice => choice.label), ["Customer App (customer-app)", "Orders (orders)", "Payment Processor (payment-processor)", "Payments (payments)", "Simulation (simulation)"]);
  assert.equal(suggestions.components.some(choice => choice.value === "ghost"), false);
  assert.deepEqual(suggestions.traces.map(choice => choice.value), ["trace-order", "trace-pay"]);
  assert.deepEqual(suggestions.events.map(choice => choice.value), ["event-order", "event-pay"]);
  assert.equal(suggestions.events.some(choice => choice.value === "not-an-event" || choice.value === "hidden-assessment-token"), false);
  assert.deepEqual(suggestions.entityKinds.map(choice => choice.value), ["message", "order"]);
  assert.deepEqual(suggestions.entityIds.map(choice => choice.value), ["message-9", "order-1"]);
  assert.deepEqual(visibleChoices(suggestions.types, "network").shown.map(choice => choice.value), ["network.request.sent", "network.response.dropped", "network.response.sent"]);
  assert.equal(visibleChoices(suggestions.components, "Orders").shown[0]?.value, "orders");
  assert.equal(visibleChoices(suggestions.types, "Network").shown.length, 0);

  const replacement = [observation({ id: "only", time: 1, sequence: 1, type: "message.published", source: "orders" })];
  assert.deepEqual(timelineSuggestions(replacement).types.map(choice => choice.value), ["message.published"]);
  assert.deepEqual(timelineSuggestions([]).types, []);
  assert.deepEqual(queryTimeline([], { type: { value: "network", mode: "contains" } }), []);
});

test("component, entity, and combined filters are deterministic read-only projections", () => {
  assert.equal(componentLabel("orders", titles), "Orders (orders)");
  assert.equal(componentLabel("simulation", []), "Simulation (simulation)");
  const pay = queryTimeline(rows, { component: { value: "pay", mode: "prefix" } }).map(item => item.id);
  assert.deepEqual(pay, ["dropped"]);
  assert.deepEqual(queryTimeline(rows, { component: { value: "payments", mode: "exact" } }).map(item => item.id), ["dropped"]);
  assert.deepEqual(queryTimeline(rows, { entityKind: { value: "order", mode: "exact" }, entityId: { value: "message-9", mode: "exact" } }).map(item => item.id), []);
  assert.deepEqual(queryTimeline(rows, { entityKind: { value: "message", mode: "exact" }, entityId: { value: "order-1", mode: "exact" } }).map(item => item.id), ["quiet"]);
  assert.equal(readerFilter({ entityKind: { value: "order", mode: "exact" } }), undefined);
  assert.deepEqual(queryTimeline(rows, { entityKind: { value: "ord", mode: "prefix" } }).map(item => item.id), ["request", "dropped"]);
  const combined = queryTimeline(rows, {
    type: { value: "network", mode: "prefix" },
    component: { value: "payments", mode: "exact" },
    fromTime: simulationTime(2),
  }).map(item => item.id);
  assert.deepEqual(combined, ["dropped"]);
  assert.ok(queryTimeline(rows, { type: { value: "network", mode: "prefix" } }).length > combined.length);
});

test("time validation explains malformed and reversed bounds, and chips remove one field", () => {
  assert.equal(parseTimelineQuery(draft()).ok, true);
  assert.equal(timelineDraftIsBlank(emptyTimelineDraft), true);
  const fraction = parseTimelineQuery(draft({ fromTime: "1.5" }));
  assert.equal(fraction.ok, false);
  if (!fraction.ok) assert.match(fraction.message, /Virtual time from "1\.5" is not a whole simulation time/);
  const word = parseTimelineQuery(draft({ toTime: "abc" }));
  assert.equal(word.ok, false);
  if (!word.ok) assert.match(word.message, /Virtual time to "abc" is not a whole simulation time/);
  const reversed = parseTimelineQuery(draft({ fromTime: "4", toTime: "1" }));
  assert.equal(reversed.ok, false);
  if (!reversed.ok) assert.match(reversed.message, /Virtual time from 4 is after virtual time to 1/);
  assert.match(TIMELINE_FILTER_HELP, /combine with AND/);
  assert.match(TIMELINE_FILTER_HELP, /case-sensitive/);
  assert.match(TIMELINE_FILTER_HELP, /Prefix/);
  assert.match(TIMELINE_FILTER_HELP, /Contains/);

  const parsed = parseTimelineQuery(draft({ type: "network", typeMode: "exact", component: "payments", fromTime: "0" }));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(activeFilterChips(parsed.query, titles).map(chip => chip.label), [
    "Virtual time from 0 inclusive",
    "Type exactly network",
    "Component exactly Payments (payments)",
  ]);
  assert.equal(activeFilterChips({ component: { value: "pay", mode: "prefix" } }, titles)[0]?.label, "Component starting with pay");
  const cleared = clearTimelineField(draft({ type: "network", component: "payments", fromTime: "0" }), "type");
  assert.equal(cleared.type, "");
  assert.equal(cleared.component, "payments");
  const applied = withExactValue(withExactValue(draft({ type: "network.response.sent" }), "entityKind", "order"), "entityId", "order-1");
  assert.equal(applied.type, "network.response.sent");
  assert.equal(applied.entityKindMode, "exact");
  assert.deepEqual(traceOnlyDraft("trace-pay"), { ...emptyTimelineDraft, traceId: "trace-pay", traceMode: "exact" });

  const explanation = emptyFilterExplanation(parsed.query, rows, titles);
  assert.match(explanation, /Filters combine with AND/);
  assert.match(explanation, /network\.response\.dropped/);
  assert.match(explanation, /clear all filters/);
  const wrongCase = emptyFilterExplanation({ type: { value: "Network", mode: "exact" } }, rows, titles);
  assert.match(wrongCase, /case-sensitive/);
  assert.match(wrongCase, /network\.response\.dropped/);
  assert.match(emptyFilterExplanation({ type: { value: "network", mode: "prefix" }, component: { value: "missing", mode: "exact" } }, rows, titles), /Another active filter excludes them/);
  const many = timelineSuggestions(Array.from({ length: 10 }, (_, index) => observation({
    id: `id-${index}`, time: index, sequence: index, type: `network.kind.${index}`, source: "orders",
  }))).types;
  assert.equal(visibleChoices(many, "network").hidden, 2);
});
