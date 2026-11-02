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
];
const catalog = catalogOf(models);
const assessment = assessmentOf([truePredicate]);

interface Edits {
  components?: (components: Record<string, unknown>[]) => Record<string, unknown>[];
  links?: (links: Record<string, unknown>[]) => Record<string, unknown>[];
  databases?: Record<string, unknown>[];
  stores?: Record<string, unknown>[];
  destinations?: Record<string, unknown>[];
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
