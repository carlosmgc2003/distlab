import { test } from "node:test";
import assert from "node:assert/strict";
import type { CanonicalValue, LessonArchitectureAllowance, Observation, ScenarioDefinition } from "@distlab/contracts";
import { NOT_IMPLEMENTED } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import {
  checkoutOverlayPolicy, commerceAssessment, commerceCatalog, commerceChecks, commerceDescriptors, commerceLessonNames, commerceOverlayPolicy, commerceScenario,
} from "@distlab/catalogs";
import type { CommerceLessonName } from "@distlab/catalogs";
import { DeterministicScenarioEngine, composeOverlay, openHarness, resolveTarget } from "@distlab/scenario";
import type { HarnessExport } from "@distlab/scenario";

type Doc = Record<string, CanonicalValue>;
const engine = new DeterministicScenarioEngine({ catalog: commerceCatalog, assessment: commerceAssessment });
const encode = (value: unknown) => canonicalEncode(value as CanonicalValue);
const copy = (value: CanonicalValue): Doc => JSON.parse(JSON.stringify(value)) as Doc;
const architectureOf = (document: Doc) => document.architecture as unknown as ScenarioDefinition["architecture"] & Doc;
const GAP = "outbox-notifications-gap" satisfies CommerceLessonName;

async function runDocument(document: CanonicalValue): Promise<HarnessExport> {
  assert.deepEqual(engine.validate(document), []);
  const session = openHarness(engine.create(document));
  await session.run();
  return session.inspect();
}
function compose(name: CommerceLessonName, overlay: unknown) {
  return composeOverlay(commerceScenario(name), commerceOverlayPolicy(name), overlay as CanonicalValue, value => engine.validate(value), commerceCatalog);
}
const codes = (diagnostics: readonly { path: string; code: string }[]) => diagnostics.map(item => `${item.path} ${item.code}`);
const verdicts = (result: HarnessExport) => Object.fromEntries(result.results.map(item => [item.id, item.status]));

// --- Placeholder models -------------------------------------------------------------

test("placeholder descriptors consume, publish, call, and store nothing, and declare no interface of their own", () => {
  const placeholders = commerceDescriptors.filter(item => item.placeholder);
  assert.deepEqual(placeholders.map(item => [item.model, item.kind]), [["commerce.placeholder-service", "service"], ["commerce.placeholder-external", "external"]]);
  for (const descriptor of placeholders) {
    assert.deepEqual([descriptor.actions, descriptor.endpoints, descriptor.consumers, descriptor.operations, descriptor.publishes, descriptor.peers, descriptor.options], [[], [], [], [], [], [], []], descriptor.model);
    assert.deepEqual(descriptor.storage, {}, descriptor.model);
  }
});

test("a placeholder service exposes its configured interface and answers every request with NOT_IMPLEMENTED", async () => {
  // retry-unsafe with Payments replaced by an empty slot that offers POST /pay.
  const document = copy(commerceScenario("retry-unsafe"));
  const architecture = architectureOf(document);
  const components = architecture.components as unknown as Doc[];
  components[1] = { ...components[1]!, model: "commerce.placeholder-service", configuration: { interface: ["POST /pay"] } };
  Object.assign(document, { faults: [], assertions: [] });
  Object.assign(architecture, { databases: [] });
  const result = await runDocument(document);
  assert.equal(result.status, "COMPLETED");
  const outcomes = result.history.observations.filter(item => item.type === "runtime.log" && (item.data as Doc).message === "client.result")
    .map(item => (item.data as Doc).data);
  assert.deepEqual(JSON.parse(JSON.stringify(outcomes)), [{ attempt: 1, label: "pay", result: { code: NOT_IMPLEMENTED } }]);
  // No state, no storage, no publication.
  assert.ok(!result.history.observations.some(item => item.source === "payments" && /^(database|message)\./.test(item.type)));

  // Without the endpoint in its interface the placeholder registers nothing, so the reply is the runtime's, not NOT_IMPLEMENTED.
  components[1] = { ...components[1]!, configuration: {} };
  const unregistered = await runDocument(document);
  const replies = unregistered.history.observations.filter(item => item.type === "network.response.sent" && item.source === "payments")
    .map(item => encode((item.data as Doc).body));
  assert.deepEqual(replies, [encode({ code: "ENDPOINT_NOT_FOUND" })]);
});

test("a placeholder external satisfies a peer only through its interface and answers NOT_IMPLEMENTED without a visible change", async () => {
  // saga-uncompensated with the Shipping Carrier replaced by an empty slot.
  const document = copy(commerceScenario("saga-uncompensated"));
  const components = architectureOf(document).components as unknown as Doc[];
  const index = components.findIndex(item => item.id === "carrier");
  components[index] = { ...components[index]!, model: "commerce.placeholder-external", configuration: {} };
  Object.assign(document, { faults: [], assertions: [] });
  const orders = components.findIndex(item => item.id === "orders");
  assert.deepEqual(codes(engine.validate(document)), [`/architecture/components/${orders}/configuration/carrier INTERFACE`]);

  components[index] = { ...components[index]!, configuration: { interface: ["POST /ship"] } };
  const result = await runDocument(document);
  assert.equal(result.status, "COMPLETED");
  const effects = result.history.observations.filter(item => item.type === "external.effect.committed" && item.source === "carrier");
  assert.deepEqual(effects.map(item => [(item.data as Doc).operation, encode((item.data as Doc).visibleChanges)]), [["POST /ship", encode({})]]);
  const replies = result.history.observations.filter((item: Observation) => item.source === "carrier" && JSON.stringify(item.data ?? null).includes(NOT_IMPLEMENTED));
  assert.ok(replies.length > 0, "the carrier's reply carries NOT_IMPLEMENTED");
});

// --- Allowance integrity --------------------------------------------------------------

const designed = commerceLessonNames.filter(name => commerceOverlayPolicy(name).architecture !== undefined);

test("only the gap lesson declares an architecture allowance", () => {
  assert.deepEqual(designed, [GAP]);
  assert.equal(checkoutOverlayPolicy("normal").architecture, undefined);
  assert.equal(checkoutOverlayPolicy("response-lost").architecture, undefined);
});

/**
 * The allowance edits that complete an allowed slot model: the database and
 * subscriptions the model needs, where the allowance offers them for the slot.
 */
function completion(allowance: LessonArchitectureAllowance, component: string, model: string, version: string) {
  const descriptor = commerceCatalog.find(model, version)!;
  return {
    resources: allowance.resources.filter(item => item.owner === component
      && ((item.resource === "database" && descriptor.storage.database) || (item.resource === "store" && descriptor.storage.store)))
      .map(item => ({ ...item, change: "attach" })),
    subscriptions: allowance.subscriptions.filter(item => item.consumer === component && descriptor.consumers.includes(item.destination))
      .map(item => ({ ...item, change: "subscribe" })),
  };
}

test("ARCH-AC-6 every allowed slot model, with the slot's allowed resource and subscription edits, gives a valid document", () => {
  for (const name of designed) {
    const allowance = commerceOverlayPolicy(name).architecture!;
    const packaged = commerceScenario(name) as Doc;
    for (const slot of allowance.slots) for (const { model, version } of slot.models) {
      const edits = completion(allowance, slot.component, model, version);
      const result = compose(name, { version: 1, architecture: { slots: [{ component: slot.component, model, version, options: [] }], ...edits } });
      assert.ok(result.ok, `${name}: ${slot.component} = ${model}: ${JSON.stringify(result)}`);
      // Substituted without them, the only diagnostics are the storage and subscriptions those edits supply.
      const alone = copy(packaged);
      const components = architectureOf(alone).components as unknown as Doc[];
      const at = components.findIndex(item => item.id === slot.component);
      components[at] = { ...components[at]!, model, version, configuration: {} };
      // (Composition rules such as STORAGE run only once the subscriptions read cleanly, so a missing subscription can hide them.)
      const diagnostics = engine.validate(alone);
      assert.equal(diagnostics.length === 0, edits.resources.length + edits.subscriptions.length === 0, `${name}: ${slot.component} = ${model} alone`);
      for (const { path, code } of diagnostics) {
        assert.ok((code === "STORAGE" && edits.resources.length > 0 && path === `/architecture/components/${at}`)
          || (code === "SUBSCRIPTION" && edits.subscriptions.length > 0 && path === "/architecture/subscriptions"), `${name}: ${slot.component} = ${model} alone: ${path} ${code}`);
      }
    }
  }
});

test("ARCH-AC-6 every binding candidate, resource owner, and subscription exists, and no parameter targets a slot", () => {
  for (const name of designed) {
    const policy = commerceOverlayPolicy(name);
    const allowance = policy.architecture!;
    const architecture = architectureOf(commerceScenario(name) as Doc);
    const byId = new Map(architecture.components.map(component => [component.id, component]));
    const slots = new Set(allowance.slots.map(slot => slot.component));
    for (const slot of allowance.slots) {
      assert.ok(byId.get(slot.component), `${name}: slot ${slot.component} exists`);
      for (const { model, version } of slot.models) assert.equal(commerceCatalog.find(model, version)?.kind, byId.get(slot.component)!.kind, `${name}: ${model} fits ${slot.component}`);
    }
    for (const binding of allowance.bindings) {
      assert.ok(byId.has(binding.component), `${name}: ${binding.component}`);
      for (const candidate of binding.candidates) assert.ok(byId.has(candidate), `${name}: candidate ${candidate}`);
    }
    for (const resource of allowance.resources) assert.equal(byId.get(resource.owner)?.kind, "service", `${name}: ${resource.owner} owns resources`);
    for (const subscription of allowance.subscriptions) {
      assert.equal(byId.get(subscription.consumer)?.kind, "service", `${name}: ${subscription.consumer}`);
      assert.ok(architecture.destinations.some(destination => destination.id === subscription.destination), `${name}: ${subscription.destination}`);
    }
    for (const parameter of policy.parameters) for (const target of parameter.targets) {
      assert.ok(resolveTarget(commerceScenario(name), target), `${name}.${parameter.key}`);
      assert.ok(target.kind !== "component" || !slots.has(target.component), `${name}.${parameter.key} targets slot ${target.kind === "component" ? target.component : ""}`);
    }
    assert.ok(allowance.maxEdits > 0);
  }
});

// --- The gap lesson -------------------------------------------------------------------

const slot = (options: { key: string; value: CanonicalValue }[] = []) => ({ component: "notifications", model: "commerce.notifications", version: "1.0.0", options });
const database = { owner: "notifications", resource: "database", change: "attach" };
const subscription = { consumer: "notifications", destination: "PaymentApproved", change: "subscribe" };
const reference = { version: 1, architecture: { slots: [slot([{ key: "idempotent", value: true }])], resources: [database], subscriptions: [subscription] } };

test("the gap lesson's empty overlay runs, replays deterministically, and reports the missing notification", async () => {
  const first = await runDocument(commerceScenario(GAP));
  const second = await runDocument(commerceScenario(GAP));
  assert.equal(first.status, "COMPLETED");
  assert.equal(first.history.runId, second.history.runId);
  assert.equal(encode(first), encode(second));
  const session = openHarness(engine.create(commerceScenario(GAP)));
  await session.run();
  await session.reset();
  await session.run();
  assert.equal(encode(session.inspect()), encode(first));
  // Every scenario expectation reproduces; the invariant about the missing consumer is VIOLATED.
  const expectations = commerceChecks(GAP).filter(check => check.kind === "expectation").map(check => check.id);
  assert.ok(expectations.every(id => verdicts(first)[id] === "PASS"));
  assert.deepEqual(verdicts(first), {
    "committed-before-crash": "PASS", "nothing-published-yet": "PASS", "durable-outbox": "PASS",
    "payment-survives-restart": "PASS", "one-notification-per-payment": "FAIL", "payment-event-published": "PASS",
  });
  // The event is published, but nothing is subscribed to receive it.
  assert.ok(first.history.observations.some(item => item.type === "message.published"));
  assert.ok(!first.history.observations.some(item => item.type === "message.delivered"));
});

test("the reference design fills the gap: every lesson check passes, and the design replays with its own runId", async () => {
  const result = compose(GAP, reference);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(JSON.parse(JSON.stringify(result.overlay.architecture)), { slots: [slot([{ key: "idempotent", value: true }])], bindings: [], resources: [database], subscriptions: [subscription] });
  const designedRun = await runDocument(result.document);
  assert.equal(designedRun.status, "COMPLETED");
  assert.ok(Object.values(verdicts(designedRun)).every(status => status === "PASS"), JSON.stringify(verdicts(designedRun)));
  assert.equal(encode(await runDocument(result.document)), encode(designedRun));
  assert.notEqual(designedRun.history.runId, (await runDocument(commerceScenario(GAP))).history.runId);
  // The filled slot keeps its ID, so history and assertions name the same component.
  assert.ok(designedRun.history.observations.some(item => item.type === "database.transaction.committed" && item.source === "notifications"));
});

test("a design without consumer idempotency fills the gap, but the duplicate delivery creates two notifications", async () => {
  const result = compose(GAP, { version: 1, architecture: { slots: [slot()], resources: [database], subscriptions: [subscription] } });
  assert.ok(result.ok, JSON.stringify(result));
  const run = await runDocument(result.document);
  assert.equal(verdicts(run)["one-notification-per-payment"], "FAIL");
  assert.equal(verdicts(run)["payment-event-published"], "PASS");
});

test("a design missing the subscription or the database is rejected at its overlay path", () => {
  const unsubscribed = compose(GAP, { version: 1, architecture: { slots: [slot()], resources: [database] } });
  assert.ok(!unsubscribed.ok);
  assert.equal(unsubscribed.code, "INVALID_OVERLAY");
  // The missing subscription is a location no edit names, so ADR-005 attributes it to /architecture.
  assert.deepEqual(codes(unsubscribed.diagnostics), ["/architecture SUBSCRIPTION"]);

  const homeless = compose(GAP, { version: 1, architecture: { slots: [slot()], subscriptions: [subscription] } });
  assert.ok(!homeless.ok);
  assert.equal(homeless.code, "INVALID_OVERLAY");
  assert.deepEqual(codes(homeless.diagnostics), ["/architecture/slots/0/model STORAGE"]);

  // A disallowed model or an edit beyond the allowance is rejected before the document is built.
  const disallowed = compose(GAP, { version: 1, architecture: { slots: [{ component: "payments", model: "commerce.notifications", version: "1.0.0", options: [] }] } });
  assert.ok(!disallowed.ok);
  assert.deepEqual(codes(disallowed.diagnostics), ["/architecture/slots/0/component OVERLAY_NOT_ALLOWED"]);
});
