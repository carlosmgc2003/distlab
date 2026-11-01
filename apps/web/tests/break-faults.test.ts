import assert from "node:assert/strict";
import test from "node:test";
import type { ArchitectureDefinition, LessonOverlayPolicy, ScenarioDefinition } from "@distlab/contracts";
import { STUDENT_ID_PREFIX } from "@distlab/contracts";
import { checkoutOverlayPolicy, commerceOverlayPolicy, commerceScenario, normalCheckout } from "@distlab/catalogs";
import {
  STUDENT_PREFIX, buildEntry, carryOverlay, describeEntry, draftFromOverlay, emptyForm, faultKindOptions, faultMarks,
  formFromEntry, nextStudentId, overlayFromDraft, pickTarget, placeDiagnostics, sameOverlay, targetOptions,
} from "../src/break-faults.ts";
import type { DraftEntry, FaultForm } from "../src/break-faults.ts";

const checkout = (normalCheckout as unknown as ScenarioDefinition).architecture;
const policy = checkoutOverlayPolicy("normal");
const options = faultKindOptions(policy);
const form = (kind: FaultForm["kind"], changes: Partial<FaultForm> = {}): FaultForm => ({ ...emptyForm, kind, ...changes });
const targetsOf = (kind: string, architecture: ArchitectureDefinition = checkout) => targetOptions(options.find(item => item.id === kind), architecture);

test("the panel prefix is the contract's student ID prefix", () => {
  assert.equal(STUDENT_PREFIX, STUDENT_ID_PREFIX);
});

test("only the fault kinds a lesson allows are offered", () => {
  assert.deepEqual(options.map(item => item.id), [
    "network.request/delay", "network.request/drop", "network.request/disconnect", "network.response/delay", "network.response/drop",
    "message.delivery/delay", "message.delivery/drop", "message.delivery/duplicate", "database.commit/fail", "scheduled/crash",
  ]);
  const retry = faultKindOptions(commerceOverlayPolicy("retry-unsafe")).map(item => item.id);
  assert.ok(!retry.some(id => id.startsWith("message.delivery") || id === "scheduled/external-availability"));
  assert.ok(faultKindOptions(commerceOverlayPolicy("saga-compensated")).some(item => item.id === "scheduled/external-availability"));
  const closed: LessonOverlayPolicy = { version: 1, lesson: "x@1", faults: { rules: [], scheduled: [], maxEntries: 0 }, parameters: [] };
  assert.deepEqual(faultKindOptions(closed), []);
  assert.deepEqual(faultKindOptions(undefined), []);
});

test("targets come from the architecture, and responses travel back along a link", () => {
  assert.deepEqual(targetsOf("network.request/drop").map(item => item.label), ["customer-app → orders", "payments → payment-processor"]);
  assert.deepEqual(targetsOf("network.response/drop").map(item => item.label), ["orders → customer-app", "payment-processor → payments"]);
  assert.deepEqual(targetsOf("message.delivery/delay").map(item => [item.name, item.target]), [["OrderCreated", "payments"]]);
  assert.deepEqual(targetsOf("database.commit/fail").map(item => item.name), ["orders", "payments"]);
  assert.deepEqual(targetsOf("scheduled/crash").map(item => item.target), ["orders", "payments"]);
});

test("graph picks resolve to the matching target option only", () => {
  const responses = targetsOf("network.response/drop");
  assert.equal(pickTarget(responses, { kind: "link", source: "payments", target: "payment-processor" })?.label, "payment-processor → payments");
  assert.equal(pickTarget(responses, { kind: "node", id: "payments" }), undefined);
  assert.equal(pickTarget(targetsOf("scheduled/crash"), { kind: "node", id: "payments" })?.target, "payments");
  assert.equal(pickTarget(targetsOf("scheduled/crash"), { kind: "node", id: "payment-processor" }), undefined);
  assert.equal(pickTarget(targetsOf("message.delivery/drop"), { kind: "node", id: "OrderCreated" })?.name, "OrderCreated");
  assert.equal(pickTarget(targetsOf("database.commit/fail"), { kind: "node", id: "resource:db:payments" })?.name, "payments");
});

test("panel input maps one-to-one to FaultRule with the fault engine's defaults", () => {
  const target = targetsOf("network.response/drop").find(item => item.label === "payment-processor → payments")!;
  const result = buildEntry(form("network.response/drop", { target: target.value, occurrence: "1" }), options, targetsOf("network.response/drop"), "student-fault-1");
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.entry, { kind: "rule", rule: {
    id: "student-fault-1", point: "network.response", source: "payment-processor", target: "payments",
    from: 0, occurrence: 1, probability: 1, maxApplications: 1, effect: { kind: "drop" },
  } });
  assert.equal(describeEntry(result.entry!), "Drop response · payment-processor → payments · occurrence 1");

  const delay = targetsOf("network.request/delay")[1]!;
  const full = buildEntry(form("network.request/delay", { target: delay.value, endpoint: " POST /authorize ", from: "5", until: "50", maxApplications: "3", probability: "0.25", duration: "40" }),
    options, targetsOf("network.request/delay"), "student-fault-2");
  assert.deepEqual(full.entry, { kind: "rule", rule: {
    id: "student-fault-2", point: "network.request", source: "payments", target: "payment-processor", name: "POST /authorize",
    from: 5, until: 50, probability: 0.25, maxApplications: 3, effect: { kind: "delay", duration: 40 },
  } });
  assert.match(describeEntry(full.entry!), /uses the session seed/);

  const duplicate = targetsOf("message.delivery/duplicate")[0]!;
  assert.deepEqual(buildEntry(form("message.delivery/duplicate", { target: duplicate.value, additionalCopies: "2", spacing: "3" }), options, targetsOf("message.delivery/duplicate"), "student-d").entry, {
    kind: "rule", rule: { id: "student-d", point: "message.delivery", target: "payments", name: "OrderCreated", from: 0, probability: 1, maxApplications: 1, effect: { kind: "duplicate", additionalCopies: 2, spacing: 3 } },
  });
  const commit = targetsOf("database.commit/fail")[1]!;
  assert.deepEqual(buildEntry(form("database.commit/fail", { target: commit.value }), options, targetsOf("database.commit/fail"), "student-c").entry, {
    kind: "rule", rule: { id: "student-c", point: "database.commit", name: "payments", from: 0, probability: 1, maxApplications: 1, effect: { kind: "fail" } },
  });
});

test("panel input maps one-to-one to scheduled faults", () => {
  const crash = targetsOf("scheduled/crash")[1]!;
  assert.deepEqual(buildEntry(form("scheduled/crash", { target: crash.value, at: "25" }), options, targetsOf("scheduled/crash"), "student-fault-3").entry, {
    kind: "scheduled", action: { id: "student-fault-3", at: 25, kind: "fault", fault: { id: "student-fault-3-fault", kind: "crash", target: "payments" } },
  });
  const saga = commerceScenario("saga-compensated") as unknown as ScenarioDefinition;
  const sagaOptions = faultKindOptions(commerceOverlayPolicy("saga-compensated"));
  const carriers = targetOptions(sagaOptions.find(item => item.id === "scheduled/external-availability"), saga.architecture);
  assert.deepEqual(carriers.map(item => item.target), ["carrier"]);
  assert.deepEqual(buildEntry(form("scheduled/external-availability", { target: carriers[0]!.value, at: "3", state: "RATE_LIMITED" }), sagaOptions, carriers, "student-x").entry, {
    kind: "scheduled", action: { id: "student-x", at: 3, kind: "fault", fault: { id: "student-x-fault", kind: "external-availability", target: "carrier", state: "RATE_LIMITED" } },
  });
});

test("text with no contract value is reported on its field and adds nothing", () => {
  const targets = targetsOf("network.request/delay");
  const result = buildEntry(form("network.request/delay", { from: "-1", until: "soon", occurrence: "0", maxApplications: "", probability: "1.5", duration: "2.5" }), options, targets, "student-x");
  assert.equal(result.entry, undefined);
  assert.deepEqual(Object.keys(result.errors).sort(), ["duration", "from", "maxApplications", "occurrence", "probability", "target", "until"]);
  assert.deepEqual(buildEntry(form(""), options, [], "student-x").errors, { kind: "Choose a fault this lesson allows." });
  assert.deepEqual(buildEntry(form("scheduled/external-availability"), options, [], "student-x").errors, { kind: "Choose a fault this lesson allows." }, "a kind the lesson does not allow is not accepted");
  // Contract rules such as an empty time window are left to the worker, which reports them by path.
  assert.ok(buildEntry(form("network.request/delay", { target: targets[0]!.value, from: "10", until: "5" }), options, targets, "student-x").entry);
});

test("entries round-trip through the form for editing, and IDs stay unique", () => {
  const targets = (kind: string) => targetsOf(kind);
  const entries: DraftEntry[] = [
    buildEntry(form("network.response/drop", { target: targets("network.response/drop")[1]!.value, occurrence: "1" }), options, targets("network.response/drop"), "student-fault-1").entry!,
    buildEntry(form("network.request/delay", { target: targets("network.request/delay")[0]!.value, endpoint: "POST /orders", until: "9", duration: "7" }), options, targets("network.request/delay"), "student-fault-2").entry!,
    buildEntry(form("scheduled/crash", { target: targets("scheduled/crash")[0]!.value, at: "4" }), options, targets("scheduled/crash"), "student-fault-3").entry!,
  ];
  for (const entry of entries) {
    const restored = formFromEntry(entry, kind => targets(kind));
    const id = entry.kind === "rule" ? entry.rule.id : entry.action.id;
    assert.deepEqual(buildEntry(restored, options, targets(restored.kind), id).entry, entry);
  }
  assert.equal(nextStudentId(entries), "student-fault-4");
  assert.equal(nextStudentId([entries[2]!]), "student-fault-2");
  assert.equal(nextStudentId([]), "student-fault-1");
});

test("the draft becomes an overlay and compares with the applied one", () => {
  const entries = [
    buildEntry(form("scheduled/crash", { target: targetsOf("scheduled/crash")[0]!.value }), options, targetsOf("scheduled/crash"), "student-b").entry!,
    buildEntry(form("network.request/drop", { target: targetsOf("network.request/drop")[0]!.value }), options, targetsOf("network.request/drop"), "student-a").entry!,
  ];
  const overlay = overlayFromDraft(entries);
  assert.deepEqual(overlay.faults.map(item => item.id), ["student-a"]);
  assert.deepEqual(overlay.scheduledFaults.map(item => item.id), ["student-b"]);
  assert.ok(sameOverlay(overlay, overlayFromDraft(draftFromOverlay(overlay))));
  assert.ok(!sameOverlay(overlay, overlayFromDraft(entries.slice(1))));
});

test("worker diagnostics are placed on the draft entry and field they name", () => {
  const entries = [
    buildEntry(form("network.request/delay", { target: targetsOf("network.request/delay")[0]!.value, from: "10", until: "5" }), options, targetsOf("network.request/delay"), "student-a").entry!,
    buildEntry(form("scheduled/crash", { target: targetsOf("scheduled/crash")[0]!.value }), options, targetsOf("scheduled/crash"), "student-b").entry!,
  ];
  const placed = placeDiagnostics([
    { path: "/faults/0/until", code: "FAULT" },
    { path: "/faults/0/effect/kind", code: "OVERLAY_NOT_ALLOWED" },
    { path: "/scheduledFaults/0/fault/target", code: "FAULT" },
    { path: "/scheduledFaults/0", code: "OVERLAY_LIMIT" },
    { path: "/version", code: "VERSION" },
  ], overlayFromDraft(entries));
  assert.deepEqual(placed.entries.map(item => [item.entryId, item.field ?? null]), [
    ["student-a", "until"], ["student-a", "kind"], ["student-b", "target"], ["student-b", null],
  ]);
  assert.ok(placed.entries.every(item => item.message.length > 0));
  assert.deepEqual(placed.general.length, 1);
});

test("Compare carries fault entries and only overrides the paired lesson declares identically", () => {
  const overlay = { version: 1 as const, faults: [], scheduledFaults: [{ id: "student-a", at: 0, kind: "fault", fault: { id: "student-a-fault", kind: "crash", target: "payments" } }] as never,
    parameters: [{ key: "timeout", value: 40 }, { key: "idempotency", value: true }] };
  const base = commerceOverlayPolicy("retry-unsafe");
  const left: LessonOverlayPolicy = { ...base, parameters: [
    { key: "timeout", domain: { type: "integer", default: 20, minimum: 5, maximum: 100 }, targets: [] },
    { key: "idempotency", domain: { type: "boolean", default: false }, targets: [] },
  ] };
  const right: LessonOverlayPolicy = { ...base, parameters: [
    { key: "timeout", domain: { type: "integer", default: 20, minimum: 5, maximum: 100 }, targets: [] },
    { key: "idempotency", domain: { type: "boolean", default: true }, targets: [] },
  ] };
  const carried = carryOverlay(overlay, left, right);
  assert.deepEqual(carried.overlay.scheduledFaults, overlay.scheduledFaults);
  assert.deepEqual(carried.overlay.parameters, [{ key: "timeout", value: 40 }]);
  assert.deepEqual(carried.dropped, ["idempotency"]);
});

test("applied faults mark the links, destinations, databases, and components they target", () => {
  const entries: DraftEntry[] = draftFromOverlay({ version: 1, parameters: [],
    faults: [
      { id: "student-a", point: "network.response", source: "payment-processor", target: "payments", from: 0, probability: 1, maxApplications: 1, effect: { kind: "drop" } },
      { id: "student-b", point: "message.delivery", name: "OrderCreated", from: 0, probability: 1, maxApplications: 1, effect: { kind: "drop" } },
      { id: "student-c", point: "database.commit", name: "orders", from: 0, probability: 1, maxApplications: 1, effect: { kind: "fail" } },
    ] as never,
    scheduledFaults: [{ id: "student-d", at: 0, kind: "fault", fault: { id: "student-d-fault", kind: "crash", target: "payments" } }] as never });
  const marks = faultMarks(entries, checkout);
  assert.deepEqual([...marks.links.keys()].sort(), ["OrderCreated->payments", "payments->payment-processor"]);
  assert.deepEqual([...marks.nodes.keys()].sort(), ["payments", "resource:db:orders"]);
});
