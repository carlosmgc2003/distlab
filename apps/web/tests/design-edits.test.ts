import assert from "node:assert/strict";
import test from "node:test";
import type { ArchitectureEdits, CanonicalValue, LessonArchitectureAllowance, LessonOverlayPolicy, ScenarioDefinition } from "@distlab/contracts";
import { commerceCatalog, commerceDescriptors } from "@distlab/catalogs";
import { validateOverlay } from "@distlab/scenario";
import { overlayFromDraft, sameOverlay } from "../src/break-faults.ts";
import {
  bindingControlId, controlAvailable, describeDesign, designControls, editCount, optionControlId, placeDesignDiagnostics, resourceControlId,
  setBinding, setResource, setSlotModel, setSlotOption, setSubscription, slotControlId, subscriptionControlId,
} from "../src/design-edits.ts";
import type { DesignContext, DesignDraft } from "../src/design-edits.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";

const gap = scenarios.find(choice => choice.id === "outbox-notifications-gap")!;
const gapContext: DesignContext = { allowance: gap.policy.architecture!, architecture: packagedMetadata(gap).architecture, descriptors: commerceDescriptors };
const MODEL = "commerce.notifications@1.0.0";

/** The worker's stage-3 reading of an overlay: the normalized form the draft must equal. */
function normalized(document: CanonicalValue, policy: LessonOverlayPolicy, architecture: DesignDraft): ArchitectureEdits | undefined {
  const result = validateOverlay(overlayFromDraft([], [], architecture) as unknown as CanonicalValue, policy, { packaged: document, catalog: commerceCatalog });
  assert.deepEqual(result.diagnostics, []);
  return result.overlay?.architecture;
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

type Gesture = (draft: DesignDraft) => DesignDraft;
const model: Gesture = draft => setSlotModel(gapContext, draft, "notifications", MODEL);
const database: Gesture = draft => setResource(gapContext, draft, "notifications", "database", true);
const subscribe: Gesture = draft => setSubscription(gapContext, draft, "notifications", "PaymentApproved", true);
const idempotent: Gesture = draft => setSlotOption(gapContext, draft, "notifications", "idempotent", true);
const run = (gestures: readonly Gesture[], from: DesignDraft = undefined) => gestures.reduce((draft, gesture) => gesture(draft), from);

const slotEdit = (options: { key: string; value: CanonicalValue }[]) => ({ component: "notifications", model: "commerce.notifications", version: "1.0.0", options });
const designs = {
  // docs/commerce-lessons.md §9: the model, its database, and its subscription; then the same with idempotency.
  duplicate: { gestures: [[model, database, subscribe], [subscribe, database, model]], edits: { slots: [slotEdit([])], bindings: [],
    resources: [{ owner: "notifications", resource: "database", change: "attach" }], subscriptions: [{ consumer: "notifications", destination: "PaymentApproved", change: "subscribe" }] } },
  reference: { gestures: [[model, idempotent, database, subscribe], [database, subscribe, model, idempotent]], edits: { slots: [slotEdit([{ key: "idempotent", value: true }])], bindings: [],
    resources: [{ owner: "notifications", resource: "database", change: "attach" }], subscriptions: [{ consumer: "notifications", destination: "PaymentApproved", change: "subscribe" }] } },
  // The two documented rejections are well-formed drafts too: the worker, not the draft, rejects them.
  homeless: { gestures: [[model, subscribe], [subscribe, model]], edits: { slots: [slotEdit([])], bindings: [], resources: [],
    subscriptions: [{ consumer: "notifications", destination: "PaymentApproved", change: "subscribe" }] } },
  unsubscribed: { gestures: [[model, database], [database, model]], edits: { slots: [slotEdit([])], bindings: [],
    resources: [{ owner: "notifications", resource: "database", change: "attach" }], subscriptions: [] } },
} as const;

test("each §9 fixture design gives the same normalized edits in two gesture orders, equal to the worker's reading", () => {
  for (const [name, design] of Object.entries(designs)) {
    const [first, second] = design.gestures.map(gestures => run(gestures));
    assert.deepEqual(plain(first), plain(design.edits), `${name}: first order`);
    assert.deepEqual(plain(second), plain(first), `${name}: second order`);
    assert.deepEqual(plain(normalized(gap.scenario, gap.policy, first)), plain(first), `${name}: the worker reads the draft unchanged`);
    // The draft overlay compares equal to the overlay the worker would publish for it.
    const sent = overlayFromDraft([], [], first);
    assert.ok(sameOverlay(sent, { version: 1, faults: [], scheduledFaults: [], parameters: [], architecture: normalized(gap.scenario, gap.policy, first)! }), name);
  }
});

test("undoing every gesture leaves no edit, and the overlay carries no architecture field", () => {
  const undo: Gesture[] = [
    draft => setSlotOption(gapContext, draft, "notifications", "idempotent", false),
    draft => setSlotModel(gapContext, draft, "notifications", "packaged"),
    draft => setResource(gapContext, draft, "notifications", "database", false),
    draft => setSubscription(gapContext, draft, "notifications", "PaymentApproved", false),
  ];
  const designed = run([model, idempotent, database, subscribe]);
  assert.equal(editCount(designed), 3);
  const undone = run(undo, designed);
  assert.equal(undone, undefined);
  const overlay = overlayFromDraft([], [], undone);
  assert.equal("architecture" in overlay, false);
  assert.equal(normalized(gap.scenario, gap.policy, undone), undefined);
  // An option back at its model default is not kept, and choosing the packaged model drops the options with the slot edit.
  assert.deepEqual(plain(setSlotOption(gapContext, run([model, idempotent]), "notifications", "idempotent", false)), plain({ slots: [slotEdit([])], bindings: [], resources: [], subscriptions: [] }));
  assert.equal(setSlotModel(gapContext, run([model, idempotent]), "notifications", "packaged"), undefined);
});

test("the gap lesson's controls: labels, packaged values, options only for a chosen model, and the edit limit", () => {
  const packaged = designControls(gapContext, undefined);
  assert.deepEqual(packaged.map(control => [control.id, control.label, control.value]), [
    [slotControlId("notifications"), "Model for notifications", "packaged"],
    [resourceControlId("notifications", "database"), "notifications owns a database", false],
    [subscriptionControlId("notifications", "PaymentApproved"), "notifications subscribes to PaymentApproved", false],
  ]);
  const slot = packaged[0]!;
  assert.ok(slot.kind === "slot");
  assert.deepEqual(slot.choices.map(choice => [choice.value, choice.label]), [["packaged", "Empty slot (packaged)"], [MODEL, "commerce.notifications 1.0.0"]]);

  const chosen = designControls(gapContext, run([model, idempotent]));
  assert.deepEqual(chosen.map(control => [control.id, control.label, control.value]), [
    [slotControlId("notifications"), "Model for notifications", MODEL],
    [optionControlId("notifications", "idempotent"), "notifications: idempotent", true],
    [resourceControlId("notifications", "database"), "notifications owns a database", false],
    [subscriptionControlId("notifications", "PaymentApproved"), "notifications subscribes to PaymentApproved", false],
  ]);

  // At the limit, a control at its packaged value would add an edit; one already edited, or an option, stays available.
  const limited: DesignContext = { ...gapContext, allowance: { ...gapContext.allowance, maxEdits: 2 } };
  const full = run([model, database]);
  const available = Object.fromEntries(designControls(limited, full).map(control => [control.id, controlAvailable(limited, full, control)]));
  assert.deepEqual(available, {
    [slotControlId("notifications")]: true, [optionControlId("notifications", "idempotent")]: true,
    [resourceControlId("notifications", "database")]: true, [subscriptionControlId("notifications", "PaymentApproved")]: false,
  });
  assert.equal(describeDesign(run([model, idempotent, database, subscribe])), "3 design edits · notifications: commerce.notifications 1.0.0");
  assert.equal(describeDesign(undefined), "");
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
const fixturePolicy: LessonOverlayPolicy = { ...dlq.policy, architecture: fixtureAllowance };
const fixture: DesignContext = { allowance: fixtureAllowance, architecture: dlqDocument.architecture as ScenarioDefinition["architecture"], descriptors: commerceDescriptors };

test("a binding, a detachable resource, and a removable subscription give bindings, detach, and unsubscribe edits; packaged values give none", () => {
  const controls = designControls(fixture, undefined);
  assert.deepEqual(controls.map(control => [control.id, control.label, control.value]), [
    [bindingControlId("notifications", "provider"), "notifications calls provider on", "messaging"],
    [resourceControlId("orders", "database"), "orders owns a database", true],
    [subscriptionControlId("orders", "NotificationSent"), "orders subscribes to NotificationSent", true],
  ]);
  const edited = run([
    draft => setBinding(fixture, draft, "notifications", "provider", "orders"),
    draft => setResource(fixture, draft, "orders", "database", false),
    draft => setSubscription(fixture, draft, "orders", "NotificationSent", false),
  ]);
  const expected = {
    slots: [], bindings: [{ component: "notifications", peer: "provider", target: "orders" }],
    resources: [{ owner: "orders", resource: "database", change: "detach" }],
    subscriptions: [{ consumer: "orders", destination: "NotificationSent", change: "unsubscribe" }],
  };
  assert.deepEqual(plain(edited), expected);
  assert.deepEqual(plain(normalized(dlq.scenario, fixturePolicy, edited)), expected, "the worker reads the draft unchanged");
  // Every control set back to its packaged value leaves no entry.
  assert.equal(run([
    draft => setBinding(fixture, draft, "notifications", "provider", "messaging"),
    draft => setResource(fixture, draft, "orders", "database", true),
    draft => setSubscription(fixture, draft, "orders", "NotificationSent", true),
  ], edited), undefined);
  assert.equal(setBinding(fixture, undefined, "notifications", "provider", "messaging"), undefined);
  assert.equal(normalized(dlq.scenario, fixturePolicy, setBinding(fixture, undefined, "notifications", "provider", "messaging")), undefined);
});

test("diagnostic placement puts each path on its control and anything else in the general list, with its code's text", () => {
  const edits: ArchitectureEdits = {
    slots: [slotEdit([{ key: "idempotent", value: true }])],
    bindings: [{ component: "notifications", peer: "provider", target: "orders" }],
    resources: [{ owner: "notifications", resource: "database", change: "attach" }],
    subscriptions: [{ consumer: "notifications", destination: "PaymentApproved", change: "subscribe" }],
  };
  const placed = placeDesignDiagnostics([
    { path: "/architecture/slots/0/model", code: "STORAGE" },
    { path: "/architecture/slots/0/options/0/value", code: "PARAMETER_VALUE" },
    { path: "/architecture/bindings/0/target", code: "PEER" },
    { path: "/architecture/resources/0", code: "OWNERSHIP" },
    { path: "/architecture/subscriptions/0", code: "SUBSCRIPTION" },
    { path: "/architecture", code: "OVERLAY_LIMIT" },
    { path: "/architecture/slots/4/model", code: "DUPLICATE" },
    { path: "/architecture/slots/0/component", code: "SOMETHING_NEW" },
    { path: "/faults/0", code: "FAULT" },
  ], edits, 3);
  assert.deepEqual(Object.fromEntries(placed.controls), {
    [slotControlId("notifications")]: [
      "This model needs storage that the component does not own. (STORAGE)",
      "This edit is not valid. (SOMETHING_NEW)",
    ],
    [optionControlId("notifications", "idempotent")]: ["This value is outside the allowed range. (PARAMETER_VALUE)"],
    [bindingControlId("notifications", "provider")]: ["A peer of this component does not resolve to a component it may call. (PEER)"],
    [resourceControlId("notifications", "database")]: ["Only services own resources. (OWNERSHIP)"],
    [subscriptionControlId("notifications", "PaymentApproved")]: ["The model's consumers and the component's subscriptions do not match. (SUBSCRIPTION)"],
  });
  assert.deepEqual(placed.general, ["This lesson allows at most 3 design edits. (OVERLAY_LIMIT)", "Two edits change the same element. (DUPLICATE)"]);
});
