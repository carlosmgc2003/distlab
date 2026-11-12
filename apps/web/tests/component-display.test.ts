import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentNodeProjection, Observation, RuntimeProjectionSet, ScenarioDefinition } from "@distlab/contracts";
import { activityAt, activityChanges, activityDescription } from "../src/activity.ts";
import { messages } from "../src/i18n/catalog.ts";
import { mapArchitecture, movementEdges } from "../src/architecture-view.ts";
import { componentNames, commerceComponentNames, displayName } from "../src/component-display.ts";
import type { ComponentNames } from "../src/component-display.ts";
import { flightSteps } from "../src/flight.ts";
import { assessments, packagedMetadata, scenarios } from "../src/scenarios.ts";
import { targetOptions, faultKindOptions } from "../src/break-faults.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";

const m = messages("en");

/** The display-name table of issue #103, verbatim. */
const ISSUE_TABLE: Readonly<Record<string, string>> = {
  client: "Customer App",
  "customer-app": "Customer App",
  "partner-api": "Partner API",
  backoffice: "Backoffice",
  scheduler: "Scheduler",
  "editor-eu": "Editor (EU)",
  "editor-us": "Editor (US)",
  orders: "Orders",
  payments: "Payments",
  inventory: "Inventory",
  notifications: "Notifications",
  reporting: "Reporting",
  catalog: "Catalog",
  cart: "Cart",
  storage: "Storage",
  api: "API",
  kv: "Key-Value Store",
  "worker-1": "Worker 1",
  "worker-2": "Worker 2",
  eu: "Region EU",
  us: "Region US",
  carrier: "Shipping Carrier",
  messaging: "Messaging Provider",
  risk: "Risk Provider",
  "payment-processor": "Payment Processor",
};

const commerceLessons = scenarios.filter(choice => choice.family === "commerce");
const checkoutLessons = scenarios.filter(choice => choice.family === "checkout");
const reliableCheckout = assessments.find(item => item.id === "reliable-checkout")!;

function definition(scenario: unknown): ScenarioDefinition {
  return scenario as ScenarioDefinition;
}

/** The components a session projects: the packaged components and, as infrastructure, its destinations. */
function projected(scenario: ScenarioDefinition): ComponentNodeProjection[] {
  return [
    ...scenario.architecture.components.map(component => ({ id: component.id, kind: component.kind, label: component.id, model: component.model, version: component.version })),
    ...scenario.architecture.destinations.map(destination => ({ id: destination.id, kind: "infrastructure" as const, label: destination.id })),
  ];
}

const commerceDocuments = [...commerceLessons.map(choice => packagedMetadata(choice)), definition(reliableCheckout.scenario)];

test("#103 table: every packaged commerce and Reliable Checkout component has an entry, no entry is unused, and the values are the issue's", () => {
  assert.equal(commerceLessons.length, 21);
  const used = new Set<string>();
  for (const scenario of commerceDocuments) {
    for (const component of scenario.architecture.components) {
      assert.ok(Object.hasOwn(commerceComponentNames, component.id), `${scenario.name}: ${component.id} has a display name`);
      used.add(component.id);
    }
  }
  // The checkout lessons are packaged too; their names come from checkout-display.ts and agree with the table.
  for (const choice of checkoutLessons) for (const component of packagedMetadata(choice).architecture.components) used.add(component.id);
  assert.deepEqual(Object.keys(commerceComponentNames).filter(id => !used.has(id)), []);
  assert.deepEqual({ ...commerceComponentNames }, ISSUE_TABLE);
  assert.ok(Object.isFrozen(commerceComponentNames));
});

test("#103 resolver: checkout names for the checkout lessons, the table for commerce, IDs for imported sessions and unknown IDs", () => {
  for (const choice of checkoutLessons) {
    const scenario = packagedMetadata(choice);
    const names = componentNames({ source: "checkout", scenarioName: scenario.name }, projected(scenario), m);
    assert.deepEqual([...names.entries()].sort(), [
      ["customer-app", "Customer App"], ["orders", "Orders"], ["payment-processor", "Payment Processor"], ["payments", "Payments"],
    ], choice.id);
    // Destinations keep their IDs: they are event names.
    assert.equal(displayName(names, "OrderCreated"), "OrderCreated");
    // A checkout starter file is imported with its author's IDs.
    assert.equal(componentNames({ source: "imported" }, projected(scenario), m).size, 0);
  }
  for (const scenario of commerceDocuments) {
    const components = projected(scenario);
    const names = componentNames({ source: "commerce" }, components, m);
    for (const component of components) {
      assert.equal(displayName(names, component.id), component.kind === "infrastructure" ? component.id : ISSUE_TABLE[component.id], `${scenario.name}: ${component.id}`);
    }
    const imported = componentNames({ source: "imported" }, components, m);
    for (const component of components) assert.equal(displayName(imported, component.id), component.id);
  }
  const unknown = componentNames({ source: "commerce" }, [
    { id: "ledger", kind: "service", label: "ledger" }, { id: "constructor", kind: "service", label: "constructor" },
  ], m);
  assert.equal(displayName(unknown, "ledger"), "ledger");
  assert.equal(displayName(unknown, "constructor"), "constructor");
  assert.equal(displayName(undefined, "orders"), "orders");
});

async function run(id: string): Promise<RuntimeProjectionSet> {
  const choice = scenarios.find(item => item.id === id)!;
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: choice.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const last = events.filter(event => event.type === "projection.updated").at(-1);
  assert.ok(last?.projection);
  return last.projection;
}

/** Escapes every regular-expression metacharacter, backslash included. */
function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&");
}

/** Fails when a sentence names a component by its raw ID instead of its display name. */
function assertNoRawId(text: string, names: ComponentNames): void {
  for (const [id, name] of names) {
    if (id === name) continue;
    assert.doesNotMatch(text, new RegExp(`(^|[^\\w-])${escapeRegExp(id)}($|[^\\w-])`), `"${text}" names ${id} by its ID`);
  }
}

test("#103 narration and activity: one request, one response, and one message movement use display names and no raw ID", async () => {
  const cases = [
    { lesson: "saga-uncompensated", type: "network.request.sent" },
    { lesson: "saga-uncompensated", type: "network.response.received" },
    { lesson: "outbox-idempotent", type: "message.delivered" },
  ] as const;
  for (const { lesson, type } of cases) {
    const choice = scenarios.find(item => item.id === lesson)!;
    const projection = await run(lesson);
    const names = componentNames({ source: "commerce" }, projection.architecture.components, m);
    const graph = mapArchitecture(projection.architecture, packagedMetadata(choice).architecture, packagedMetadata(choice).name, m, names);
    const steps = flightSteps(projection.history.observations, movementEdges(graph.edges), m, names);
    const index = steps.findIndex(step => projection.history.observations.find(item => item.id === step.observationId)?.type === type);
    assert.ok(index >= 0, `${lesson} records ${type}`);
    const step = steps[index]!;
    const observation = projection.history.observations.find(item => item.id === step.observationId) as Observation;
    // The step keeps the stored IDs for graph identity; only its sentences carry names.
    assert.ok(step.nodeIds.includes(step.from));
    assert.ok(projection.architecture.components.some(component => component.id === step.from));
    for (const text of [step.announcement, step.route, step.transit]) {
      // An arrival's transit names only where the token arrives.
      const named = [step.from, ...(step.to !== undefined ? [step.to] : [])].map(id => displayName(names, id));
      assert.ok(named.some(name => text.includes(name)), `${type}: "${text}" names the movement's components`);
      assertNoRawId(text, names);
    }
    const activity = activityAt(projection.history.observations, observation.id);
    const lines = [...activity.values()].map(item => activityDescription(item, m, names));
    assert.ok(lines.length > 0, `${type}: some component has activity`);
    for (const line of [...lines, ...activityChanges(activityAt(projection.history.observations, steps[index - 1]?.observationId), activity, m, names)]) {
      assertNoRawId(line, names);
      assert.ok([...names.values()].some(name => line.startsWith(name)), `"${line}" starts with a display name`);
    }
    // Without names the same step reads the stored IDs, so the names add no fact.
    const plain = flightSteps(projection.history.observations, movementEdges(graph.edges), m)[index]!;
    assert.equal(plain.announcement.replaceAll(step.from, displayName(names, step.from)).replaceAll(step.to ?? "\u0000", displayName(names, step.to ?? "\u0000")), step.announcement);
  }
});

test("#103 saga-uncompensated: the first request reads from Customer App to Orders", async () => {
  const projection = await run("saga-uncompensated");
  const names = componentNames({ source: "commerce" }, projection.architecture.components, m);
  const steps = flightSteps(projection.history.observations, [], m, names);
  assert.match(steps[0]!.announcement, /^Request sent from Customer App to Orders at virtual time 0\.$/);
  const activity = activityAt(projection.history.observations, steps[0]!.observationId);
  assert.match(activityDescription(activity.get("client")!, m, names), /^Customer App is waiting on Orders/);
});

test("#103 graph and fault targets: titles, accessible names, resource captions, and target labels use names; values keep IDs", () => {
  const choice = scenarios.find(item => item.id === "saga-uncompensated")!;
  const scenario = packagedMetadata(choice);
  const architecture = { components: projected(scenario), links: scenario.architecture.links.map(link => ({ source: link.source, target: link.target })) };
  const names = componentNames({ source: "commerce" }, architecture.components, m);
  const graph = mapArchitecture(architecture, scenario.architecture, scenario.name, m, names);
  for (const node of graph.nodes) {
    const name = displayName(names, node.id);
    assert.equal(node.data.title, name);
    assert.ok(node.ariaLabel?.startsWith(`${name}, `));
  }
  const orders = graph.nodes.find(node => node.id === "orders")!;
  assert.ok(orders.data.resources.some(resource => resource.startsWith("Database owned by Orders: ")));
  const database = graph.resourceNodes.find(node => node.data.owner === "orders")!;
  assert.equal(database.ariaLabel, "Database owned by Orders");
  assert.equal(database.data.ownerName, "Orders");
  for (const edge of graph.edges) assertNoRawId(String(edge.ariaLabel), names);
  for (const option of faultKindOptions(choice.policy, m)) {
    for (const target of targetOptions(option, scenario.architecture, m, names)) {
      assertNoRawId(target.label, names);
      assert.match(target.value, /^(link|destination|database|component):/);
    }
  }
});

test("#103 and ADR-007: display names follow the interface language, and IDs never do", () => {
  const choice = scenarios.find(item => item.id === "saga-uncompensated")!;
  const components = projected(packagedMetadata(choice));
  const spanish = componentNames({ source: "commerce" }, components, messages("es"));
  assert.equal(displayName(spanish, "orders"), "Pedidos");
  assert.equal(displayName(spanish, "client"), "App del cliente");
  for (const component of components) if (component.kind === "infrastructure") assert.equal(displayName(spanish, component.id), component.id);
  const checkout = scenarios.find(item => item.id === "response-lost")!;
  const names = componentNames({ source: "checkout", scenarioName: packagedMetadata(checkout).name }, projected(packagedMetadata(checkout)), messages("es"));
  assert.equal(displayName(names, "payment-processor"), "Procesador de pagos");
});
