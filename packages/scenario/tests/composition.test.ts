import { test } from "node:test";
import assert from "node:assert/strict";
import { DiagnosticCodes, normalizeScenario } from "@distlab/scenario";
import { assessmentOf, catalogOf, engineFor, model, truePredicate } from "./support.ts";

/**
 * ADR-005 composition rules (#109): peers, interfaces, peer links, published
 * destinations, and required storage. Each rejection names its document path.
 */
const table = (name: string) => ({ name, unique: [], checks: [] });
const models = [
  model({ model: "demo.client", kind: "client", actions: ["checkout"], peers: [{ name: "orders", kinds: ["service"], calls: ["POST /orders"], default: "orders" }] }),
  model({
    model: "demo.orders", kind: "service", endpoints: ["POST /orders"], publishes: ["OrderCreated"],
    peers: [{ name: "processor", kinds: ["external"], calls: ["authorize"], default: "processor" }],
    storage: { database: { tables: [table("orders")] } },
  }),
  model({ model: "demo.cache", kind: "service", endpoints: ["GET /price"], storage: { store: true } }),
  model({ model: "demo.processor", kind: "external", operations: ["authorize"] }),
  model({ model: "demo.other-processor", kind: "external", operations: ["refund"] }),
  model({ model: "demo.gap", kind: "external", placeholder: true }),
  // Workload-addressed (#121): `send` names its callee in `data.to` and its endpoint in `data.call`.
  model({ model: "demo.shopper", kind: "client", actions: ["send", "wait"], workloadCalls: [{ action: "send", target: "to", endpoint: "call" }] }),
];
const catalog = catalogOf(models);
const assessment = assessmentOf([truePredicate]);

interface Edits {
  components?: (components: Record<string, unknown>[]) => Record<string, unknown>[];
  links?: (links: Record<string, unknown>[]) => Record<string, unknown>[];
  databases?: Record<string, unknown>[];
  stores?: Record<string, unknown>[];
  destinations?: Record<string, unknown>[];
  actions?: Record<string, unknown>[];
}

/** A valid composition: app → orders → processor, orders owns `orders` and publishes OrderCreated, cache owns a store. */
function document(edits: Edits = {}) {
  const components = [
    { id: "app", kind: "client", model: "demo.client", version: "1" },
    { id: "orders", kind: "service", model: "demo.orders", version: "1" },
    { id: "processor", kind: "external", model: "demo.processor", version: "1" },
    { id: "cache", kind: "service", model: "demo.cache", version: "1" },
  ];
  const links = [{ source: "app", target: "orders" }, { source: "orders", target: "processor" }];
  return {
    version: 1, name: "composition", seed: "seed",
    architecture: {
      components: edits.components ? edits.components(components) : components,
      links: edits.links ? edits.links(links) : links,
      databases: edits.databases ?? [{ owner: "orders", tables: [table("orders")] }],
      stores: edits.stores ?? [{ owner: "cache", initial: [] }],
      destinations: edits.destinations ?? [{ id: "OrderCreated", kind: "topic" }],
    },
    ...(edits.actions ? { actions: edits.actions } : {}),
  };
}
const configure = (id: string, configuration: Record<string, unknown>) =>
  (components: Record<string, unknown>[]) => components.map(component => component.id === id ? { ...component, configuration } : component);
const codes = (input: unknown) => normalizeScenario(input as never, catalog, assessment).diagnostics.map(item => `${item.path} ${item.code}`);

test("a composition whose every call is reachable validates", () => {
  assert.deepEqual(codes(document()), []);
});

test("PEER: a peer bound to a missing component is rejected at its configuration field", () => {
  assert.deepEqual(codes(document({ components: configure("orders", { processor: "nowhere" }) })), ["/architecture/components/1/configuration/processor PEER"]);
});

test("PEER: the descriptor default must resolve when the configuration omits the peer", () => {
  const renamed = document({
    components: components => components.map(component => component.id === "processor" ? { ...component, id: "gateway" } : component),
    links: () => [{ source: "app", target: "orders" }, { source: "orders", target: "gateway" }],
  });
  assert.deepEqual(codes(renamed), ["/architecture/components/1/configuration/processor PEER"]);
  const rebound = document({
    components: components => configure("orders", { processor: "gateway" })(components.map(component => component.id === "processor" ? { ...component, id: "gateway" } : component)),
    links: () => [{ source: "app", target: "orders" }, { source: "orders", target: "gateway" }],
  });
  assert.deepEqual(codes(rebound), []);
});

test("PEER: a peer bound to a component of a kind it does not allow is rejected", () => {
  const toService = document({ components: configure("orders", { processor: "cache" }), links: links => [...links, { source: "orders", target: "cache" }] });
  assert.deepEqual(codes(toService), ["/architecture/components/1/configuration/processor PEER"]);
  const toClient = document({ components: configure("orders", { processor: "app" }), links: links => [...links, { source: "orders", target: "app" }] });
  assert.deepEqual(codes(toClient), ["/architecture/components/1/configuration/processor PEER"]);
});

test("a configured peer that is not a component ID string is a TYPE diagnostic", () => {
  assert.deepEqual(codes(document({ components: configure("orders", { processor: 7 }) })), ["/architecture/components/1/configuration/processor TYPE"]);
  assert.deepEqual(codes(document({ components: configure("orders", { processor: " " }) })), ["/architecture/components/1/configuration/processor TYPE"]);
});

test("INTERFACE: the bound component must expose every call the peer declares", () => {
  const input = document({
    components: components => [...configure("orders", { processor: "refunds" })(components), { id: "refunds", kind: "external", model: "demo.other-processor", version: "1" }],
    links: links => [...links, { source: "orders", target: "refunds" }],
  });
  assert.deepEqual(codes(input), ["/architecture/components/1/configuration/processor INTERFACE"]);
});

test("INTERFACE: a placeholder exposes exactly its configured interface", () => {
  const withGap = (configuration: Record<string, unknown> | undefined) => document({
    components: components => [
      ...configure("orders", { processor: "gap" })(components),
      { id: "gap", kind: "external", model: "demo.gap", version: "1", ...(configuration ? { configuration } : {}) },
    ],
    links: links => [...links, { source: "orders", target: "gap" }],
  });
  assert.deepEqual(codes(withGap({ interface: ["authorize"] })), []);
  assert.deepEqual(codes(withGap({ interface: ["refund"] })), ["/architecture/components/1/configuration/processor INTERFACE"]);
  assert.deepEqual(codes(withGap(undefined)), ["/architecture/components/1/configuration/processor INTERFACE"]);
});

test("LINK: a bound peer without a link from the caller is rejected", () => {
  assert.deepEqual(codes(document({ links: links => links.filter(link => link.target !== "processor") })), ["/architecture/components/1/configuration/processor LINK"]);
  assert.deepEqual(codes(document({ links: links => links.filter(link => link.source !== "app") })), ["/architecture/components/0/configuration/orders LINK"]);
  const reversed = document({ links: links => [links[0]!, { source: "processor", target: "orders" }] });
  assert.deepEqual(codes(reversed), ["/architecture/components/1/configuration/processor LINK"]);
});

test("PUBLISH: every destination a model publishes to must exist", () => {
  assert.deepEqual(codes(document({ destinations: [{ id: "OrderUpdated", kind: "topic" }] })), ["/architecture/components/1 PUBLISH"]);
});

test("STORAGE: a service that needs a database must own one with each required table", () => {
  assert.deepEqual(codes(document({ databases: [] })), ["/architecture/components/1 STORAGE"]);
  assert.deepEqual(codes(document({ databases: [{ owner: "orders", tables: [table("outbox")] }] })), ["/architecture/databases/0/tables STORAGE"]);
  assert.deepEqual(codes(document({ databases: [{ owner: "orders", tables: [table("outbox"), table("orders")] }] })), []);
});

test("STORAGE: a service that needs a key-value store must own one", () => {
  assert.deepEqual(codes(document({ stores: [] })), ["/architecture/components/3 STORAGE"]);
});

test("composition diagnostics are sorted by path, then code, across rules", () => {
  const input = document({
    components: configure("orders", { processor: "refunds" }),
    links: () => [],
    databases: [],
    stores: [],
    destinations: [],
  });
  assert.deepEqual(codes(input), [
    "/architecture/components/0/configuration/orders LINK",
    "/architecture/components/1 PUBLISH",
    "/architecture/components/1 STORAGE",
    "/architecture/components/1/configuration/processor PEER",
    "/architecture/components/3 STORAGE",
  ]);
});

test("composition is not checked over an architecture that already has diagnostics", () => {
  const input = document({ components: components => [{ ...components[0]!, model: "demo.unknown" }, ...components.slice(1)], links: () => [] });
  assert.deepEqual(codes(input), ["/architecture/components/0/model UNKNOWN_MODEL"]);
});

test("composition validation is pure: no model, predicate, or session is created", () => {
  let instantiated = 0;
  let evaluated = 0;
  const watched = models.map(item => ({ ...item, instantiate: (instance: Parameters<typeof item.instantiate>[0]) => { instantiated += 1; return item.instantiate(instance); } }));
  const engine = engineFor(watched, [{ ...truePredicate, evaluate: input => { evaluated += 1; return truePredicate.evaluate(input); } }]);
  const invalid = document({ links: () => [] });
  const first = engine.validate(invalid as never);
  assert.deepEqual(first.map(item => item.code), [DiagnosticCodes.LINK, DiagnosticCodes.LINK]);
  assert.deepEqual(engine.validate(invalid as never), first);
  assert.throws(() => engine.create(invalid as never), (error: unknown) => (error as { code?: string }).code === "INVALID_SCENARIO");
  assert.equal(instantiated, 0);
  assert.equal(evaluated, 0);
});

// --- Workload-addressed calls (#121) --------------------------------------------------

/** The base composition plus a `shopper` client linked to `orders` that sends one workload call. */
function workload(data: Record<string, unknown>, edits: Edits = {}) {
  return document({
    components: components => [...(edits.components ? edits.components(components) : components), { id: "shopper", kind: "client", model: "demo.shopper", version: "1" }],
    links: links => [...(edits.links ? edits.links(links) : links), { source: "shopper", target: "orders" }],
    actions: [{ id: "a1", at: 0, kind: "client", target: "shopper", action: "send", data }],
  });
}
const call = { to: "orders", call: "POST /orders" };

test("a workload call to a linked component that offers its endpoint validates", () => {
  assert.deepEqual(codes(workload(call)), []);
  // An external target offers its operations.
  assert.deepEqual(codes(workload({ to: "processor", call: "authorize" }, { links: links => [...links, { source: "shopper", target: "processor" }] })), []);
});

test("REQUIRED: a workload call without its target field is rejected at that data field", () => {
  assert.deepEqual(codes(workload({ call: "POST /orders" })), ["/actions/0/data/to REQUIRED"]);
});

test("TYPE: a workload target that is not a string is rejected at that data field", () => {
  assert.deepEqual(codes(workload({ to: 7, call: "POST /orders" })), ["/actions/0/data/to TYPE"]);
});

test("UNKNOWN_COMPONENT: a workload target must be an existing service or external component", () => {
  assert.deepEqual(codes(workload({ to: "nowhere", call: "POST /orders" })), ["/actions/0/data/to UNKNOWN_COMPONENT"]);
  const toClient = workload({ to: "app", call: "POST /orders" }, { links: links => [...links, { source: "shopper", target: "app" }] });
  assert.deepEqual(codes(toClient), ["/actions/0/data/to UNKNOWN_COMPONENT"]);
});

test("LINK: a workload target without a link from the client is rejected at the target field", () => {
  const unlinked = { ...workload(call) };
  unlinked.architecture = { ...unlinked.architecture, links: unlinked.architecture.links.filter(link => link.source !== "shopper") };
  assert.deepEqual(codes(unlinked), ["/actions/0/data/to LINK"]);
  // A link toward the client does not carry its call.
  unlinked.architecture = { ...unlinked.architecture, links: [...unlinked.architecture.links, { source: "orders", target: "shopper" }] };
  assert.deepEqual(codes(unlinked), ["/actions/0/data/to LINK"]);
  // A missing link does not hide a missing endpoint.
  const both = { ...workload({ to: "orders", call: "POST /chekout" }) };
  both.architecture = { ...both.architecture, links: both.architecture.links.filter(link => link.source !== "shopper") };
  assert.deepEqual(codes(both), ["/actions/0/data/call INTERFACE", "/actions/0/data/to LINK"]);
});

test("REQUIRED: a workload call without its endpoint field is rejected at that data field", () => {
  assert.deepEqual(codes(workload({ to: "orders" })), ["/actions/0/data/call REQUIRED"]);
});

test("TYPE: a workload endpoint that is not a string is rejected at that data field", () => {
  assert.deepEqual(codes(workload({ to: "orders", call: ["POST /orders"] })), ["/actions/0/data/call TYPE"]);
});

test("INTERFACE: the workload target must offer the endpoint", () => {
  assert.deepEqual(codes(workload({ to: "orders", call: "POST /chekout" })), ["/actions/0/data/call INTERFACE"]);
  // A service offers endpoints, not another model's operations.
  assert.deepEqual(codes(workload({ to: "orders", call: "authorize" })), ["/actions/0/data/call INTERFACE"]);
});

test("INTERFACE: a placeholder workload target offers exactly its configured interface", () => {
  const withGap = (configuration: Record<string, unknown> | undefined) => workload({ to: "gap", call: "authorize" }, {
    components: components => [...components, { id: "gap", kind: "external", model: "demo.gap", version: "1", ...(configuration ? { configuration } : {}) }],
    links: links => [...links, { source: "shopper", target: "gap" }],
  });
  assert.deepEqual(codes(withGap({ interface: ["authorize"] })), []);
  assert.deepEqual(codes(withGap({ interface: ["refund"] })), ["/actions/0/data/call INTERFACE"]);
  assert.deepEqual(codes(withGap(undefined)), ["/actions/0/data/call INTERFACE"]);
});

test("only the actions a descriptor declares as workload calls are checked, at the fields it names", () => {
  const waiting = workload({});
  waiting.actions = [{ id: "a1", at: 0, kind: "client", target: "shopper", action: "wait", data: {} }];
  assert.deepEqual(codes(waiting), []);
  // `target`/`endpoint` are not the field names demo.shopper declares.
  assert.deepEqual(codes(workload({ target: "orders", endpoint: "POST /orders" })), ["/actions/0/data/call REQUIRED", "/actions/0/data/to REQUIRED"]);
  // A client model without workloadCalls is not checked.
  const plain = document({ actions: [{ id: "a1", at: 0, kind: "client", target: "app", action: "checkout", data: { target: "nowhere" } }] });
  assert.deepEqual(codes(plain), []);
});

test("workload calls are not checked over an architecture that already has diagnostics", () => {
  const input = workload({ to: "nowhere", call: "POST /chekout" }, { links: links => [...links, links[0]!] });
  assert.deepEqual(codes(input), ["/architecture/links/2 LINK"]);
});
