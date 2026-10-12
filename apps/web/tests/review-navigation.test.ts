import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { Observation } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { createReviewNavigation, derive, transition } from "../src/review-navigation.ts";
import type { ReviewContext, ReviewIntent, ReviewNavigation, ReviewViewMode } from "../src/review-navigation.ts";
import type { MovementEdge } from "../src/records.ts";
import { emptyTimelineDraft, withExactValue } from "../src/timeline-query.ts";

/**
 * Review navigation is tested without a browser. Every assertion here was
 * previously reachable only by driving the DOM in Playwright.
 */

function record(id: string, sequence: number, type: string, extra: Partial<Observation> = {}): Observation {
  return { schemaVersion: 1, id, time: simulationTime(sequence), sequence, type, source: "orders", ...extra };
}

/** Records that carry the stored fields every reader depends on. */
const records: readonly Observation[] = [
  record("o1", 1, "network.request.sent", { source: "customer-app", target: "orders", traceId: "t1" }),
  record("o2", 2, "network.response.sent", { source: "orders", target: "customer-app", traceId: "t1", causationId: "o1" }),
  record("o3", 3, "message.published", { source: "orders", target: "broker", traceId: "t1", causationId: "o2" }),
  record("o4", 4, "database.transaction.committed", { source: "orders", traceId: "t2" }),
  record("o5", 5, "scenario.assertion.evaluated", { source: "simulation", traceId: "t2" }),
];

const edges: readonly MovementEdge[] = [
  { id: "request:customer-app:orders:0", source: "customer-app", target: "orders", relationship: "request" },
  { id: "request:orders:customer-app:0", source: "orders", target: "customer-app", relationship: "request" },
];

const titles = [{ id: "customer-app", title: "Customer App" }, { id: "orders", title: "Orders" }, { id: "simulation", title: "Simulation" }];

function context(over: Partial<ReviewContext> = {}): ReviewContext {
  return { observations: records, edges, componentTitles: titles, viewport: { scrollTop: 0, height: 320 }, ...over };
}

function at(state: ReviewNavigation, ctx: ReviewContext, ...intents: ReviewIntent[]): ReviewNavigation {
  return intents.reduce((current, intent) => transition(current, intent, ctx), state);
}

function published(state: ReviewNavigation, observations: readonly Observation[] = records, ctx: ReviewContext = context()): ReviewNavigation {
  return transition(state, { type: "published", observations }, ctx);
}

test("reveal clears only the constraints that hide the record and names them", () => {
  const ctx = context();
  const filtered = at(createReviewNavigation(), ctx,
    { type: "toggle-component", value: "orders" },
    { type: "toggle-quick-view", id: "messages" });
  assert.equal(derive(filtered, ctx).filtered.length, 1);

  const revealed = transition(filtered, { type: "reveal", observationId: "o2" }, ctx);

  assert.equal(revealed.view, "raw", "reveal shows Raw");
  assert.equal(revealed.selectedId, "o2");
  assert.equal(revealed.quickView, null, "a quick view that hides the record is removed");
  assert.match(revealed.feedback, /type filter was cleared|component filter was cleared|trace filter was cleared|quick view/i);
  assert.ok(derive(revealed, ctx).filtered.some(item => item.id === "o2"), "the revealed record is visible");
});

test("reveal is the one path: a click and an evidence link reach the same navigation state", () => {
  const ctx = context();
  const start = at(createReviewNavigation(), ctx, { type: "toggle-component", value: "orders" });
  const fromRow = transition(start, { type: "reveal", observationId: "o4" }, ctx);
  const fromEvidenceLink = transition(start, { type: "reveal", observationId: "o4" }, ctx);
  assert.deepEqual(
    { draft: fromRow.draft, query: fromRow.query, quickView: fromRow.quickView, view: fromRow.view, selectedId: fromRow.selectedId, feedback: fromRow.feedback, focus: fromRow.focus },
    { draft: fromEvidenceLink.draft, query: fromEvidenceLink.query, quickView: fromEvidenceLink.quickView, view: fromEvidenceLink.view, selectedId: fromEvidenceLink.selectedId, feedback: fromEvidenceLink.feedback, focus: fromEvidenceLink.focus },
  );
});

test("reveal of a record outside the history changes nothing but the message", () => {
  const ctx = context();
  const start = at(createReviewNavigation(), ctx, { type: "select", observationId: "o1" });
  const missing = transition(start, { type: "reveal", observationId: "nope" }, ctx);
  assert.equal(missing.feedback, "That observation is not in this history.");
  assert.equal(missing.selectedId, "o1", "the review position is unchanged");
  assert.equal(missing.view, start.view);
});

test("reveal requests focus once per request, even for the same record twice", () => {
  const ctx = context();
  const first = transition(createReviewNavigation(), { type: "reveal", observationId: "o2" }, ctx);
  const again = transition(first, { type: "reveal", observationId: "o2" }, ctx);
  assert.equal(first.focus?.observationId, "o2");
  assert.equal(again.focus?.token, (first.focus?.token ?? 0) + 1, "the token moves so the DOM adapter acts again");
});

test("moving the review position stops at both boundaries and says so", () => {
  const ctx = context();
  const start = createReviewNavigation();
  const backToLast = transition(start, { type: "move", delta: -1 }, ctx);
  assert.equal(backToLast.selectedId, "o5", "Previous from nothing selects the last record");

  const first = transition(start, { type: "select-index", index: 0 }, ctx);
  assert.match(first.feedback, /Previous cannot move/);
  const forward = transition(first, { type: "move", delta: 1 }, ctx);
  assert.equal(forward.selectedId, "o2");
  assert.ok(derive(forward, ctx).filtered.some(item => item.id === "o2"));

  const last = transition(forward, { type: "select-index", index: 4 }, ctx);
  const pastEnd = transition(last, { type: "move", delta: 1 }, ctx);
  assert.equal(pastEnd.selectedId, "o5", "the review position stays put");
  assert.match(pastEnd.feedback, /Next cannot move/);
});

test("a review position a filter hides is reported by the boundary copy", () => {
  const ctx = context();
  // o5 is recorded by the simulation pseudo-component, so a component filter
  // for Orders hides it while the review position stays on it.
  const selected = at(createReviewNavigation(), ctx,
    { type: "select", observationId: "o5" },
    { type: "toggle-component", value: "orders" });
  const view = derive(selected, ctx);
  assert.equal(view.selectedIndex, -1, "the selected record is not among the visible records");
  assert.equal(view.boundaryCopy, "4 visible observations. Next selects the first. Previous selects the last.");
  assert.equal(view.selected?.id, "o5", "the review position survives being hidden");
});

test("narrowing to a trace leaves the draft and the result describing the same constraints", () => {
  const ctx = context();
  const narrowed = at(createReviewNavigation(), ctx, { type: "narrow-to-trace", traceId: "t2" });
  assert.equal(narrowed.draft.traceId, "t2");
  assert.equal(narrowed.query.traceId?.value, "t2", "the query follows the draft instead of keeping the old one");
  const view = derive(narrowed, ctx);
  assert.ok(view.filtered.every(item => item.traceId === "t2"));
  assert.equal(view.filtered.length, 2);
});

test("a reveal after narrowing clears the trace that hid the record", () => {
  const ctx = context();
  const narrowed = at(createReviewNavigation(), ctx, { type: "narrow-to-trace", traceId: "t2" });
  const revealed = transition(narrowed, { type: "reveal", observationId: "o1" }, ctx);
  assert.equal(revealed.query.traceId, undefined, "the trace filter that excluded the record is gone");
  assert.match(revealed.feedback, /trace filter was cleared/);
  assert.ok(derive(revealed, ctx).filtered.some(item => item.id === "o1"));
});

test("an invalid draft keeps the previous result and names the error", () => {
  const ctx = context();
  const valid = transition(createReviewNavigation(), { type: "set-draft", draft: withExactValue(emptyTimelineDraft, "component", "orders") }, ctx);
  const invalid = transition(valid, { type: "set-draft", draft: { ...valid.draft, fromTime: "1.5" } }, ctx);
  assert.match(invalid.filterError ?? "", /not a whole simulation time/);
  assert.deepEqual(invalid.query, valid.query, "the last usable result stays in force");
});

test("clearing all filters also clears a filter error left in the drawer", () => {
  const ctx = context();
  const invalid = at(createReviewNavigation(), ctx, { type: "set-draft", draft: { ...emptyTimelineDraft, fromTime: "4", toTime: "1" } });
  assert.match(invalid.filterError ?? "", /after virtual time to/);
  const cleared = transition(invalid, { type: "clear-all" }, ctx);
  assert.equal(cleared.filterError, null);
  assert.equal(cleared.quickView, null);
  assert.deepEqual(cleared.draft, emptyTimelineDraft);
  assert.equal(derive(cleared, ctx).filtered.length, records.length);
});

test("history growth raises a cue for the newest recorded movement and leaves the review position alone", () => {
  const ctx = context();
  const selected = published(at(createReviewNavigation(), ctx, { type: "select", observationId: "o1" }), records, ctx);
  const grown = transition(selected, { type: "published", observations: [...records, record("o6", 6, "network.response.received", { source: "orders", target: "customer-app" })] }, ctx);
  const view = derive(grown, ctx);
  assert.equal(grown.selectedId, "o1");
  assert.equal(grown.liveCueId, "o6");
  assert.equal(view.emphasis?.origin, "selection", "a selected record keeps the highlight");
});

test("an unselected history growth cues the newest movement without taking the highlight from playback", () => {
  const ctx = context();
  const grownRecords = [...records, record("o6", 6, "network.response.received", { source: "orders", target: "customer-app" })];
  const grownCtx = context({ observations: grownRecords });
  const start = published(createReviewNavigation(), records, ctx);
  const grown = transition(start, { type: "published", observations: grownRecords }, grownCtx);
  const view = derive(grown, grownCtx);
  assert.equal(grown.liveCueId, "o6");
  assert.equal(view.emphasis?.origin, "live");
  assert.equal(view.emphasis?.edgeId, "request:orders:customer-app:0");
});

test("a record that travels no link raises no cue", () => {
  const ctx = context();
  const grown = transition(published(createReviewNavigation(), records, ctx), { type: "published", observations: [...records, record("o6", 6, "clock.advanced")] }, ctx);
  assert.equal(grown.liveCueId, null);
  assert.equal(derive(grown, ctx).emphasis, undefined);
});

test("replaced history drops the review position and every active constraint", () => {
  const ctx = context();
  const replacedRecords = [record("n1", 1, "network.request.sent", { source: "customer-app", target: "orders" })];
  const replacedCtx = context({ observations: replacedRecords });
  const busy = published(at(createReviewNavigation(), ctx,
    { type: "select", observationId: "o1" },
    { type: "toggle-component", value: "orders" },
    { type: "toggle-quick-view", id: "messages" }), records, ctx);
  const replaced = transition(busy, { type: "published", observations: replacedRecords }, replacedCtx);
  const view = derive(replaced, replacedCtx);
  assert.equal(replaced.selectedId, null);
  assert.equal(replaced.quickView, null);
  assert.equal(replaced.feedback, "");
  assert.deepEqual(replaced.draft, emptyTimelineDraft);
  assert.equal(view.filtered.length, 1);
  assert.equal(view.filtersActive, false);
});

test("scroll is requested for the reason the reader acted", () => {
  const ctx = context();
  const start = createReviewNavigation();
  const filtered = transition(start, { type: "toggle-component", value: "orders" }, ctx);
  assert.equal(filtered.scroll.kind, "top", "a filter change asks for the top of the list");

  const selected = transition(start, { type: "select", observationId: "o3" }, ctx);
  assert.equal(selected.scroll.kind, "ensure-visible");
  assert.equal(derive(selected, ctx).scroll.index, 2, "the request names the row to keep visible");

  const revealed = transition(start, { type: "reveal", observationId: "o3" }, ctx);
  assert.equal(revealed.scroll.kind, "focus-row");

  const narrowed = at(start, ctx, { type: "select", observationId: "o4" }, { type: "narrow-to-trace", traceId: "t2" });
  assert.equal(narrowed.scroll.kind, "focus-row", "a focus already in flight outranks the scroll reset");
  assert.equal(narrowed.focus?.observationId, "o4");

  const switched = transition(selected, { type: "switch-view", view: "raw" as ReviewViewMode }, ctx);
  assert.equal(switched.scroll.kind, "top", "switching views starts the list again");
  assert.equal(transition(selected, { type: "switch-view", view: "story" as ReviewViewMode }, ctx), selected, "asking for the view already shown changes nothing");
});

test("focus is requested until the DOM reports it applied", () => {
  const ctx = context();
  const revealed = transition(createReviewNavigation(), { type: "reveal", observationId: "o2" }, ctx);
  assert.notEqual(revealed.focus, null);
  const applied = transition(revealed, { type: "focus-applied" }, ctx);
  assert.equal(applied.focus, null);
  assert.equal(transition(applied, { type: "focus-applied" }, ctx), applied, "applying twice is not a change");
});

test("the selected row stays in the Raw window even when it is virtualized out", () => {
  const many: readonly Observation[] = Array.from({ length: 500 }, (_, index) =>
    record(`r${index}`, index + 1, "network.request.sent", { source: "customer-app", target: "orders" }));
  const ctx = context({ observations: many, viewport: { scrollTop: 0, height: 320 } });
  const selected = at(createReviewNavigation(), ctx, { type: "switch-view", view: "raw" }, { type: "select-index", index: 400 });
  const view = derive(selected, ctx);
  assert.ok(view.range.end < 400, "the window is far from the selected row");
  assert.ok(view.rawRows.some(row => row.observation.id === "r400"), "the selected row is rendered anyway");
  const indices = view.rawRows.map(row => row.index);
  assert.deepEqual(indices, [...indices].sort((left, right) => left - right), "DOM order still follows recorded sequence");
});

test("the view projection is computed once from the records and the navigation state", () => {
  const ctx = context();
  const state = at(createReviewNavigation(), ctx, { type: "toggle-quick-view", id: "messages" }, { type: "select", observationId: "o3" });
  const view = derive(state, ctx);
  assert.equal(view.filtered.length, 1);
  assert.equal(view.selectedIndex, 0);
  assert.equal(view.selected?.id, "o3");
  assert.equal(view.selectedTrace, "t1");
  assert.match(view.componentLabels.get("orders") ?? "", /^Orders/, "lane labels resolve to recorded titles");
  assert.match(view.quickCopy, /MessageBus|Message/);
  assert.equal(view.filtersActive, true);
  assert.equal(view.suggestions.types.length > 0, true);
});

test("an empty result names the quick view and the canonical filters", () => {
  const ctx = context();
  const empty = at(createReviewNavigation(), ctx, { type: "toggle-quick-view", id: "assertions" }, { type: "toggle-component", value: "orders" });
  const view = derive(empty, ctx);
  assert.equal(view.filtered.length, 0);
  assert.match(view.explanation, /Assertions quick view keeps/);
  assert.match(view.explanation, /No observations match every active filter/);
});

test("navigation is pure: it names no DOM node, host timer, or worker command", () => {
  // The same guard the kernel uses for determinism, applied to the presentation.
  const source = fileURLToPath(new URL("../src/review-navigation.ts", import.meta.url));
  const forbidden = /\b(?:Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch|document|window|localStorage|sessionStorage)\b/;
  const text = readFileSync(source, "utf8");
  const body = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(body, forbidden, "review-navigation.ts");
  assert.doesNotMatch(body, /\bWorker\b/, "navigation sends no worker command");
});