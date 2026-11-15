import assert from "node:assert/strict";
import test from "node:test";
import type { ArchitectureDefinition, ArchitectureEdits, CanonicalValue, LessonArchitectureAllowance, RuntimeProjectionSet, ScenarioDefinition, SessionIdentity, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { checkoutDescriptors, commerceDescriptors } from "@distlab/catalogs";
import { mapArchitecture } from "../src/architecture-view.ts";
import type { GraphDesign } from "../src/architecture-view.ts";
import { overlayFromDraft } from "../src/break-faults.ts";
import { componentNames } from "../src/component-display.ts";
import { designControls, setBinding, setResource, setSlotModel, setSlotOption, setSubscription } from "../src/design-edits.ts";
import type { DesignContext, DesignDraft } from "../src/design-edits.ts";
import { controlElement, designMarks, designPreview, designProblems, diagnosticElement, elementKey, noDesignMarks } from "../src/design-preview.ts";
import { SimulationHost } from "../src/host.ts";
import type { WorkerPort } from "../src/host.ts";
import { messages } from "../src/i18n/catalog.ts";
import { assessments, packagedMetadata, scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

// #203: the design on the graph is derived on the main thread from the packaged architecture, the
// data-only descriptors, and architecture edits. These tests cover the marks, the graph they draw,
// the diagnostic mapping of ADR-005 "Error presentation", and the commands a design sequence sends.

const m = messages("en");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

async function loaded(scenario: CanonicalValue, overlay?: CanonicalValue): Promise<{ projection: RuntimeProjectionSet; session: SessionIdentity }> {
  const events: WorkerEvent[] = [];
  await new WorkerAdapter(event => events.push(event)).receive({ version: 1, requestId: "test", type: "load", scenario, ...(overlay ? { overlay } : {}) });
  const event = events.find(item => item.type === "loaded");
  assert.ok(event?.type === "loaded", JSON.stringify(events.find(item => item.type === "error")));
  return { projection: event.projection, session: event.session };
}

/** The commerce lessons' display names, as the shell passes them (#103). */
const commerceNames = (projection: RuntimeProjectionSet) => componentNames({ source: "commerce" }, projection.architecture.components, m);

const gap = scenarios.find(choice => choice.id === "outbox-notifications-gap")!;
const gapArchitecture = packagedMetadata(gap).architecture;
const gapContext: DesignContext = { allowance: gap.policy.architecture!, architecture: gapArchitecture, descriptors: commerceDescriptors };
const MODEL = "commerce.notifications@1.0.0";
type Gesture = (draft: DesignDraft) => DesignDraft;
const model: Gesture = draft => setSlotModel(gapContext, draft, "notifications", MODEL);
const database: Gesture = draft => setResource(gapContext, draft, "notifications", "database", true);
const subscribe: Gesture = draft => setSubscription(gapContext, draft, "notifications", "PaymentApproved", true);
const idempotent: Gesture = draft => setSlotOption(gapContext, draft, "notifications", "idempotent", true);
const run = (gestures: readonly Gesture[], from: DesignDraft = undefined) => gestures.reduce((draft, gesture) => gesture(draft), from);
const reversed = (edits: ArchitectureEdits): ArchitectureEdits => ({
  slots: [...edits.slots].reverse().map(slot => ({ ...slot, options: [...slot.options].reverse() })),
  bindings: [...edits.bindings].reverse(), resources: [...edits.resources].reverse(), subscriptions: [...edits.subscriptions].reverse(),
});

const notificationTables = [{ name: "notifications", unique: [], checks: [] }, { name: "inbox", unique: [], checks: [] }];
const filledSlot = (idempotentValue: boolean) => ({ component: "notifications", model: "commerce.notifications", version: "1.0.0", placeholder: false, options: [{ key: "idempotent", value: idempotentValue }] });
const attachDatabase = { owner: "notifications", resource: "database", change: "attach", tables: notificationTables };
const subscribed = { consumer: "notifications", destination: "PaymentApproved", change: "subscribe" };

// docs/commerce-lessons.md §9: the fixture designs and the marks each one draws.
const designs = {
  duplicate: { gestures: [model, database, subscribe], marks: { slots: [filledSlot(false)], resources: [attachDatabase], connections: [], subscriptions: [subscribed] } },
  reference: { gestures: [model, idempotent, database, subscribe], marks: { slots: [filledSlot(true)], resources: [attachDatabase], connections: [], subscriptions: [subscribed] } },
  homeless: { gestures: [model, subscribe], marks: { slots: [filledSlot(false)], resources: [], connections: [], subscriptions: [subscribed] } },
  unsubscribed: { gestures: [model, database], marks: { slots: [filledSlot(false)], resources: [attachDatabase], connections: [], subscriptions: [] } },
} as const;

test("#203 without architecture edits the graph is exactly today's for every packaged lesson and the Reliable Checkout base lesson", async () => {
  const lessons: { name: string; scenario: CanonicalValue; architecture: ArchitectureDefinition; scenarioName: string; commerce: boolean }[] = [
    ...scenarios.map(choice => ({ name: choice.id, scenario: choice.scenario, architecture: packagedMetadata(choice).architecture, scenarioName: packagedMetadata(choice).name, commerce: choice.family === "commerce" })),
    ...assessments.map(choice => ({ name: choice.id, scenario: choice.scenario as unknown as CanonicalValue,
      architecture: (choice.scenario as unknown as ScenarioDefinition).architecture, scenarioName: (choice.scenario as unknown as ScenarioDefinition).name, commerce: true })),
  ];
  assert.equal(lessons.length, scenarios.length + 1);
  const empty: ArchitectureEdits = { slots: [], bindings: [], resources: [], subscriptions: [] };
  for (const lesson of lessons) {
    const { projection } = await loaded(lesson.scenario);
    const descriptors = lesson.commerce ? commerceDescriptors : checkoutDescriptors;
    const today = mapArchitecture(projection.architecture, lesson.architecture, lesson.scenarioName, m);
    for (const edits of [undefined, empty]) {
      assert.deepEqual(designMarks(lesson.architecture, descriptors, edits), noDesignMarks, lesson.name);
      assert.deepEqual(designPreview(lesson.architecture, descriptors, edits, edits), noDesignMarks, lesson.name);
      const design: GraphDesign = {
        applied: designMarks(lesson.architecture, descriptors, edits),
        preview: designPreview(lesson.architecture, descriptors, edits, edits),
        problems: designProblems([], edits, 3, m).elements,
      };
      const drawn = mapArchitecture(projection.architecture, lesson.architecture, lesson.scenarioName, m, today.names, design);
      assert.deepEqual(plain({ ...drawn, names: [...drawn.names] }), plain({ ...today, names: [...today.names] }), `${lesson.name}: the same nodes, edges, and satellites`);
      assert.equal(drawn.designTargets.size, 0);
    }
  }
});

test("#203 each §9 fixture design gives its marks, and the same edits in another order give equal marks", () => {
  for (const [name, design] of Object.entries(designs)) {
    const edits = run(design.gestures)!;
    const marks = designMarks(gapArchitecture, commerceDescriptors, edits);
    assert.deepEqual(plain(marks), plain(design.marks), name);
    assert.deepEqual(plain(designMarks(gapArchitecture, commerceDescriptors, reversed(edits))), plain(marks), `${name}: reversed`);
    // Against the packaged lesson, the draft preview of a design is that design's marks.
    assert.deepEqual(plain(designPreview(gapArchitecture, commerceDescriptors, undefined, edits)), plain(marks), `${name}: preview`);
    assert.deepEqual(plain(designPreview(gapArchitecture, commerceDescriptors, undefined, reversed(edits))), plain(marks), `${name}: preview, reversed`);
    // A draft equal to the applied design previews nothing.
    assert.deepEqual(designPreview(gapArchitecture, commerceDescriptors, edits, reversed(edits)), noDesignMarks, `${name}: no preview`);
  }
  // Only where the draft differs: from the duplicate design to the reference design, only the option changes.
  const applied = run(designs.duplicate.gestures)!;
  assert.deepEqual(plain(designPreview(gapArchitecture, commerceDescriptors, applied, run([idempotent], applied))),
    plain({ slots: [filledSlot(true)], resources: [], connections: [], subscriptions: [] }));
  // Back to the packaged lesson: the slot is relabeled empty, and the database and the subscription are removed in the draft.
  assert.deepEqual(plain(designPreview(gapArchitecture, commerceDescriptors, applied, undefined)), plain({
    slots: [{ component: "notifications", model: "commerce.placeholder-service", version: "1.0.0", placeholder: true, options: [] }],
    resources: [{ ...attachDatabase, change: "detach" }], connections: [], subscriptions: [{ ...subscribed, change: "unsubscribe" }],
  }));
});

// A fixture allowance on notifications-dlq, where a peer, a packaged database, and a packaged subscription exist.
const dlq = scenarios.find(choice => choice.id === "notifications-dlq")!;
const dlqDocument = packagedMetadata(dlq);
const fixtureAllowance: LessonArchitectureAllowance = {
  slots: [],
  bindings: [{ component: "notifications", peer: "provider", candidates: ["messaging", "orders"] }],
  resources: [{ owner: "orders", resource: "database" }],
  subscriptions: [{ consumer: "orders", destination: "NotificationSent" }],
  linkPolicy: gapContext.allowance.linkPolicy,
  maxEdits: 3,
};
const fixture: DesignContext = { allowance: fixtureAllowance, architecture: dlqDocument.architecture, descriptors: commerceDescriptors };

test("#203 a binding, a detachable resource, and a removable subscription give a drafted connection and two removal marks", async () => {
  const draft = run([
    edits => setBinding(fixture, edits, "notifications", "provider", "orders"),
    edits => setResource(fixture, edits, "orders", "database", false),
    edits => setSubscription(fixture, edits, "orders", "NotificationSent", false),
  ])!;
  const ordersTables = dlqDocument.architecture.databases.find(item => item.owner === "orders")!.tables;
  const preview = designPreview(dlqDocument.architecture, commerceDescriptors, undefined, draft);
  assert.deepEqual(plain(preview), plain({
    slots: [],
    resources: [{ owner: "orders", resource: "database", change: "detach", tables: ordersTables }],
    connections: [{ component: "notifications", peer: "provider", target: "orders" }],
    subscriptions: [{ consumer: "orders", destination: "NotificationSent", change: "unsubscribe" }],
  }));
  assert.deepEqual(plain(designPreview(dlqDocument.architecture, commerceDescriptors, undefined, reversed(draft))), plain(preview));

  // The graph: a dashed drafted connection, and the satellite and the subscription link kept and marked as removed.
  const { projection } = await loaded(dlq.scenario);
  const graph = mapArchitecture(projection.architecture, dlqDocument.architecture, dlqDocument.name, m, undefined, { preview });
  const connection = graph.edges.find(edge => edge.id === "draft:binding:notifications:provider");
  assert.ok(connection);
  assert.deepEqual([connection.source, connection.target, connection.data?.relationship, connection.data?.draft], ["notifications", "orders", "request", "added"]);
  assert.equal(connection.label, "Draft · Peer provider");
  assert.match(connection.ariaLabel ?? "", /, draft$/);
  assert.ok(connection.style?.strokeDasharray);
  const satellite = graph.resourceNodes.find(node => node.id === "resource:db:orders");
  assert.equal(satellite?.data.draft, "removed");
  assert.match(satellite?.ariaLabel ?? "", /, removed in draft$/);
  const link = graph.edges.find(edge => edge.data?.relationship === "subscription" && edge.source === "NotificationSent" && edge.target === "orders");
  assert.equal(link?.data?.draft, "removed");
  assert.match(String(link?.label), /^Removed in draft · /);
  assert.match(link?.ariaLabel ?? "", /, removed in draft$/);
  // A problem on the binding is drawn on the drafted connection, which then takes focus.
  const bindingProblem = designProblems([{ path: "/architecture/bindings/0/target", code: "PEER" }], draft, 3, m).elements;
  const rejected = mapArchitecture(projection.architecture, dlqDocument.architecture, dlqDocument.name, m, undefined, { preview, problems: bindingProblem });
  assert.deepEqual(rejected.designTargets.get("connection:notifications:provider"), { kind: "edge", id: "draft:binding:notifications:provider" });
  assert.equal(rejected.edges.find(edge => edge.id === "draft:binding:notifications:provider")?.focusable, true);
  // A draft link is presentation only: the graph without a preview has none, and the projection is untouched.
  assert.equal(mapArchitecture(projection.architecture, dlqDocument.architecture, dlqDocument.name, m).edges.some(edge => edge.id.startsWith("draft:")), false);
});

test("#203 the gap lesson's draft preview relabels the slot, adds an outlined satellite and a dashed subscription, and marks each as draft", async () => {
  const { projection } = await loaded(gap.scenario);
  const meta = packagedMetadata(gap);
  const preview = designPreview(gapArchitecture, commerceDescriptors, undefined, run(designs.duplicate.gestures));
  const graph = mapArchitecture(projection.architecture, meta.architecture, meta.name, m, commerceNames(projection), { applied: noDesignMarks, preview });
  const slot = graph.nodes.find(node => node.id === "notifications")!;
  assert.equal(slot.data.draft?.model, "commerce.notifications");
  assert.equal(slot.data.emptySlot, undefined, "the Empty slot mark goes in the preview");
  assert.equal(slot.ariaLabel, "Notifications, Internal service, commerce.notifications 1.0.0, draft");
  const satellite = graph.resourceNodes.find(node => node.id === "resource:db:notifications")!;
  assert.equal(satellite.data.draft, "added");
  assert.equal(satellite.ariaLabel, "Database owned by Notifications, draft");
  assert.deepEqual(satellite.data.definition, { owner: "notifications", tables: notificationTables, initial: {} });
  assert.equal(graph.resourceEdges.find(edge => edge.target === satellite.id)?.data?.draft, "added");
  const link = graph.edges.find(edge => edge.id === "draft:subscription:PaymentApproved:notifications")!;
  assert.equal(link.ariaLabel, "PaymentApproved to Notifications: Subscription, draft");
  assert.equal(link.label, "Draft · Subscription");
  // Draft elements are presentation over the packaged graph: every packaged element keeps its id.
  const packaged = mapArchitecture(projection.architecture, meta.architecture, meta.name, m, commerceNames(projection));
  for (const node of packaged.nodes) assert.ok(graph.nodes.some(item => item.id === node.id));
  for (const edge of packaged.edges) assert.ok(graph.edges.some(item => item.id === edge.id));
});

test("#203 after Apply the applied design's database is an ordinary satellite with its tables, and the filled slot states its model and options", async () => {
  const edits = run(designs.reference.gestures)!;
  const { projection, session } = await loaded(gap.scenario, overlayFromDraft([], [], edits) as unknown as CanonicalValue);
  assert.deepEqual(plain(session.overlay.architecture), plain(edits));
  const meta = packagedMetadata(gap);
  // Before #203 the graph read resources from the packaged metadata only: the attached database was not drawn.
  const projectionOnly = mapArchitecture(projection.architecture, meta.architecture, meta.name, m);
  assert.equal(projectionOnly.resourceNodes.some(node => node.id === "resource:db:notifications"), false);
  const graph = mapArchitecture(projection.architecture, meta.architecture, meta.name, m, commerceNames(projection), {
    applied: designMarks(gapArchitecture, commerceDescriptors, session.overlay.architecture),
    preview: designPreview(gapArchitecture, commerceDescriptors, session.overlay.architecture, edits),
    problems: [],
  });
  const satellite = graph.resourceNodes.find(node => node.id === "resource:db:notifications");
  assert.ok(satellite);
  assert.equal(satellite.ariaLabel, "Database owned by Notifications");
  assert.equal(satellite.data.draft, undefined);
  assert.deepEqual(("tables" in satellite.data.definition ? satellite.data.definition.tables : []).map(table => table.name), ["notifications", "inbox"]);
  const slot = graph.nodes.find(node => node.id === "notifications")!;
  assert.deepEqual(plain(slot.data.slot), plain(filledSlot(true)));
  assert.deepEqual(slot.data.configuration, { idempotent: true });
  assert.deepEqual(slot.data.resources, ["Database owned by Notifications: notifications, inbox"]);
  assert.equal(slot.data.emptySlot, undefined);
  assert.equal(slot.ariaLabel, "Notifications, Internal service");
  // No draft mark remains: no accessible name says draft, and no element is a draft element.
  for (const element of [...graph.nodes, ...graph.resourceNodes, ...graph.edges, ...graph.resourceEdges]) {
    assert.doesNotMatch(element.ariaLabel ?? "", /draft/i, element.id);
    assert.equal((element.data as { draft?: unknown } | undefined)?.draft, undefined, element.id);
  }
  assert.ok(graph.edges.some(edge => edge.data?.relationship === "subscription" && edge.source === "PaymentApproved" && edge.target === "notifications"));
});

test("#203 the diagnostic mapping covers every row of ADR-005's Error presentation table", () => {
  const edits: ArchitectureEdits = {
    slots: [{ component: "notifications", model: "commerce.notifications", version: "1.0.0", options: [{ key: "idempotent", value: true }] }],
    bindings: [{ component: "notifications", peer: "provider", target: "orders" }],
    resources: [{ owner: "notifications", resource: "database", change: "attach" }],
    subscriptions: [{ consumer: "notifications", destination: "PaymentApproved", change: "subscribe" }],
  };
  const component = { kind: "component", component: "notifications" };
  // /architecture/slots/i… → the slot's component node.
  assert.deepEqual(diagnosticElement("/architecture/slots/0/model", edits), component);
  assert.deepEqual(diagnosticElement("/architecture/slots/0/options/0/value", edits), component);
  assert.deepEqual(diagnosticElement("/architecture/slots/0", edits), component);
  // /architecture/bindings/i… → the drafted connection.
  assert.deepEqual(diagnosticElement("/architecture/bindings/0/target", edits), { kind: "connection", component: "notifications", peer: "provider", target: "orders" });
  // /architecture/resources/i → the resource satellite.
  assert.deepEqual(diagnosticElement("/architecture/resources/0", edits), { kind: "resource", owner: "notifications", resource: "database" });
  // /architecture/subscriptions/i → the subscription edge.
  assert.deepEqual(diagnosticElement("/architecture/subscriptions/0", edits), { kind: "subscription", consumer: "notifications", destination: "PaymentApproved" });
  // Anything else → the section only.
  for (const path of ["/architecture", "/architecture/slots", "/architecture/slots/3/model", "/architecture/resources/0/change", "/architecture/subscriptions/0/destination", "/architecture/other/0", "/faults/0"]) {
    assert.equal(diagnosticElement(path, edits), undefined, path);
  }
  const problems = designProblems([
    { path: "/architecture/slots/0/model", code: "STORAGE" },
    { path: "/architecture/slots/0/options/0/value", code: "PARAMETER_VALUE" },
    { path: "/architecture/bindings/0/target", code: "PEER" },
    { path: "/architecture/resources/0", code: "OWNERSHIP" },
    { path: "/architecture/subscriptions/0", code: "SUBSCRIPTION" },
    { path: "/architecture", code: "OVERLAY_LIMIT" },
    { path: "/faults/0", code: "FAULT" },
  ], edits, 3, m);
  assert.deepEqual(problems.elements.map(item => [item.key, item.messages]), [
    ["component:notifications", ["This model needs storage that the component does not own. (STORAGE)", "This value is outside the allowed range. (PARAMETER_VALUE)"]],
    ["connection:notifications:provider", ["A peer of this component does not resolve to a component it may call. (PEER)"]],
    ["resource:notifications:database", ["Only services own resources. (OWNERSHIP)"]],
    ["subscription:notifications:PaymentApproved", ["The model's consumers and the component's subscriptions do not match. (SUBSCRIPTION)"]],
  ]);
  // A non-architecture diagnostic belongs to another section; an /architecture one with no element stays in this section.
  assert.deepEqual(problems.section, ["This lesson allows at most 3 design edits. (OVERLAY_LIMIT)"]);
  // Each control of the Architecture section names the same element as the diagnostics placed on it.
  assert.deepEqual(designControls(gapContext, edits, m).map(control => elementKey(controlElement(control))), [
    "component:notifications", "component:notifications", "resource:notifications:database", "subscription:notifications:PaymentApproved",
  ]);
  assert.equal(elementKey(controlElement(designControls(fixture, undefined, m)[0]!)), "connection:notifications:provider");
});

test("#203 the two documented rejections (STORAGE and SUBSCRIPTION at /architecture/slots/0/model) mark the notifications node", async () => {
  const meta = packagedMetadata(gap);
  const { projection } = await loaded(gap.scenario);
  for (const [design, code] of [[designs.homeless, "STORAGE"], [designs.unsubscribed, "SUBSCRIPTION"]] as const) {
    const edits = run(design.gestures)!;
    const problems = designProblems([{ path: "/architecture/slots/0/model", code }], edits, 3, m).elements;
    assert.deepEqual(problems.map(item => item.element), [{ kind: "component", component: "notifications" }], code);
    // A rejected load exposes no session: the graph draws the kept architecture, the draft preview, and the problem.
    const graph = mapArchitecture(projection.architecture, meta.architecture, meta.name, m, undefined, {
      applied: noDesignMarks, preview: designPreview(gapArchitecture, commerceDescriptors, undefined, edits), problems,
    });
    const node = graph.nodes.find(item => item.id === "notifications")!;
    assert.deepEqual(node.data.problems, problems[0]!.messages, code);
    assert.ok(node.className?.includes("has-problem"));
    assert.deepEqual(graph.designTargets.get("component:notifications"), { kind: "node", id: "notifications" });
  }
  // A problem on a drafted subscription is drawn on its link, which then takes focus.
  const subscriptionProblem = designProblems([{ path: "/architecture/subscriptions/0", code: "SUBSCRIPTION" }], run(designs.homeless.gestures), 3, m).elements;
  const graph = mapArchitecture(projection.architecture, meta.architecture, meta.name, m, undefined, {
    preview: designPreview(gapArchitecture, commerceDescriptors, undefined, run(designs.homeless.gestures)), problems: subscriptionProblem,
  });
  const target = graph.designTargets.get("subscription:notifications:PaymentApproved");
  assert.deepEqual(target, { kind: "edge", id: "draft:subscription:PaymentApproved:notifications" });
  const edge = graph.edges.find(item => item.id === target!.id)!;
  assert.equal(edge.focusable, true);
  assert.deepEqual(edge.data?.problems, subscriptionProblem[0]!.messages);
});

/** A worker port that records each command and answers it with the real worker adapter. */
class RecordingWorker extends EventTarget implements WorkerPort {
  readonly commands: WorkerCommand[] = [];
  readonly #adapter = new WorkerAdapter(event => this.dispatchEvent(new MessageEvent("message", { data: event })));
  postMessage(command: WorkerCommand): void {
    this.commands.push(structuredClone(command));
    void this.#adapter.receive(structuredClone(command) as unknown as CanonicalValue);
  }
  terminate(): void {}
}

function keys(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  return Array.isArray(value) ? value.flatMap(keys) : Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)]);
}

test("ARCH-AC-7 (#203): a draft, its preview, and Apply send no position, no preview value, and no applied document; nothing is sent before Apply", async () => {
  const worker = new RecordingWorker();
  const host = new SimulationHost(() => worker);
  await host.load(gap.scenario);
  const meta = packagedMetadata(gap);
  const before = host.getSnapshot();
  assert.ok(before.projection);
  // Draft and preview: the draft functions, the marks, and the graph send nothing.
  const draft = run(designs.reference.gestures);
  const preview = designPreview(gapArchitecture, commerceDescriptors, before.session?.overlay.architecture, draft);
  const previewGraph = mapArchitecture(before.projection.architecture, meta.architecture, meta.name, m, undefined, { applied: noDesignMarks, preview });
  assert.ok(previewGraph.resourceNodes.some(node => node.data.draft === "added"));
  assert.equal(worker.commands.length, 1, "no command is sent before Apply");
  // Apply: one ordinary load with the draft overlay and the exact packaged document.
  await host.load(gap.scenario, overlayFromDraft([], [], draft) as unknown as CanonicalValue);
  const after = host.getSnapshot();
  assert.ok(after.projection && after.session);
  mapArchitecture(after.projection.architecture, meta.architecture, meta.name, m, undefined, {
    applied: designMarks(gapArchitecture, commerceDescriptors, after.session.overlay.architecture),
    preview: designPreview(gapArchitecture, commerceDescriptors, after.session.overlay.architecture, draft),
  });
  assert.deepEqual(worker.commands.map(command => command.type), ["load", "load"]);
  for (const command of worker.commands) {
    assert.ok(command.type === "load");
    assert.deepEqual(plain(command.scenario), plain(gap.scenario), "the exact packaged document, never an applied one");
    const names = keys(command);
    for (const forbidden of ["position", "positions", "route", "routes", "measured", "draft", "preview", "marks", "resourceNodes", "designTargets"]) {
      assert.ok(!names.includes(forbidden), `${forbidden} in a ${command.type} command`);
    }
  }
  assert.equal(worker.commands[0]!.type === "load" && worker.commands[0]!.overlay, undefined);
  assert.deepEqual(plain(worker.commands[1]!.type === "load" ? worker.commands[1]!.overlay : null), plain(overlayFromDraft([], [], draft)));
});
