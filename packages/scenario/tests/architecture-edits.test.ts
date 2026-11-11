import assert from "node:assert/strict";
import test from "node:test";
import type {
  ArchitectureEdits, CanonicalValue, ClientDefinition, ComponentInstance, ExternalDefinition, LessonOverlayPolicy, ScenarioDiagnostic, ServiceDefinition,
} from "@distlab/contracts";
import { OverlayDiagnosticCodes } from "@distlab/contracts";
import { canonicalEncode } from "@distlab/kernel";
import { applyOverlay, compareExports, composeOverlay, openHarness, overlayKey, validateOverlay, type ScenarioModel } from "@distlab/scenario";
import { catalogOf, engineFor, model, truePredicate } from "./support.ts";

/**
 * ADR-005 architecture edits in session overlays (#110): stage-3 checks against
 * the allowance, normalization, application, stage-4 attribution, and replay.
 */

type Doc = Record<string, CanonicalValue>;
const table = (name: string) => ({ name, unique: [], checks: [] });
let instantiated = 0;
const runtime = <T>(build: (instance: ComponentInstance) => T) => (instance: ComponentInstance): T => { instantiated += 1; return build(instance); };
const peer = (instance: ComponentInstance, name: string, fallback: string) => {
  const value = (instance.configuration as Record<string, CanonicalValue> | null)?.[name];
  return typeof value === "string" ? value : fallback;
};
const external = (operation: string) => runtime((instance): ExternalDefinition => ({
  id: instance.id, version: instance.version, initialState: { calls: 0 }, operations: { [operation]: { apply: (_body, state) => {
    const calls = (state as { calls: number }).calls + 1;
    return { nextState: { calls }, reply: { status: "ok", body: { calls } }, visibleChanges: { calls }, callbacks: [] };
  } } },
}));
const consumer = (body: (instance: ComponentInstance) => ServiceDefinition["consumers"][string]) => runtime((instance): ServiceDefinition => ({
  id: instance.id, version: instance.version, background: {}, endpoints: { "POST /notify": function* () { return { status: "ok" as const, body: null }; } },
  consumers: { OrderCreated: body(instance) },
}));

const models: ScenarioModel[] = [
  model({ model: "demo.client", kind: "client", actions: ["checkout"], peers: [{ name: "orders", kinds: ["service"], calls: ["POST /orders"], default: "orders" }],
    instantiate: runtime((instance): ClientDefinition => ({ id: instance.id, version: instance.version, initialState: {}, callbacks: {}, actions: {
      checkout: function* (data, ctx) {
        const reply = (yield ctx.http.request({ target: peer(instance, "orders", "orders"), endpoint: "POST /orders", body: data })) as CanonicalValue;
        ctx.state.set("reply", reply);
        return reply;
      },
    } })) }),
  model({
    model: "demo.orders", kind: "service", endpoints: ["POST /orders"], publishes: ["OrderCreated"],
    peers: [{ name: "processor", kinds: ["external"], calls: ["authorize"], default: "processor" }],
    storage: { database: { tables: [table("orders")] } },
    options: [{ key: "audit", domain: { type: "boolean", default: false } }, { key: "tier", domain: { type: "choice", default: "basic", choices: ["basic", "gold"] } }],
    instantiate: runtime((instance): ServiceDefinition => ({ id: instance.id, version: instance.version, consumers: {}, background: {}, endpoints: {
      "POST /orders": function* (body, ctx) {
        const orderId = (body as { orderId: string }).orderId;
        const tx = ctx.db!.begin();
        tx.insert("orders", orderId, { orderId });
        yield tx.commit();
        yield ctx.http.request({ target: peer(instance, "processor", "processor"), endpoint: "authorize", body: { orderId } });
        yield ctx.events.publish("OrderCreated", { type: "OrderCreated", body: { orderId } });
        return { status: "ok" as const, body: { orderId } };
      },
    } })),
  }),
  model({ model: "demo.processor", kind: "external", operations: ["authorize"], instantiate: external("authorize") }),
  model({ model: "demo.refunds", kind: "external", operations: ["refund"], instantiate: external("refund") }),
  model({ model: "demo.provider", kind: "external", operations: ["send"], instantiate: external("send") }),
  model({ model: "demo.gap", kind: "service", placeholder: true }),
  model({
    model: "demo.mailer", kind: "service", endpoints: ["POST /notify"], consumers: ["OrderCreated"],
    peers: [{ name: "provider", kinds: ["external"], calls: ["send"], default: "provider" }],
    options: [{ key: "retries", domain: { type: "integer", default: 1, minimum: 0, maximum: 3 } }],
    instantiate: consumer(instance => function* (delivery, ctx) {
      yield ctx.http.request({ target: peer(instance, "provider", "provider"), endpoint: "send", body: delivery.message.body });
    }),
  }),
  model({
    model: "demo.inbox", kind: "service", endpoints: ["POST /notify"], consumers: ["OrderCreated"], storage: { store: true },
    instantiate: consumer(() => function* (delivery, ctx) { ctx.kv!.set("last", delivery.message.body); }),
  }),
  model({ model: "demo.broadcaster", kind: "service", publishes: ["Missing"] }),
  model({ model: "demo.linkless", kind: "service", endpoints: ["POST /notify"], peers: [{ name: "target", kinds: ["external"], calls: ["authorize"], default: "processor" }] }),
  model({ model: "demo.audit", kind: "service", peers: [{ name: "sink", kinds: ["service"], calls: ["POST /notify"], default: "notify" }] }),
];
const catalog = catalogOf(models);
const engine = engineFor(models, [truePredicate]);
const validate = (value: CanonicalValue) => engine.validate(value);

const policyLink = { requestLatency: 2, responseLatency: 2, jitter: 0, timeout: 50, failureRate: 0 };
const packaged = {
  version: 1, name: "design-fixture@1", seed: "design-seed", startTime: 0,
  architecture: {
    components: [
      { id: "app", kind: "client", model: "demo.client", version: "1", configuration: {} },
      { id: "orders", kind: "service", model: "demo.orders", version: "1", configuration: {} },
      { id: "processor", kind: "external", model: "demo.processor", version: "1", configuration: {} },
      { id: "backup", kind: "external", model: "demo.processor", version: "1", configuration: {} },
      { id: "refunds", kind: "external", model: "demo.refunds", version: "1", configuration: {} },
      { id: "provider", kind: "external", model: "demo.provider", version: "1", configuration: {} },
      { id: "notify", kind: "service", model: "demo.gap", version: "1", configuration: { interface: ["POST /notify"] } },
      { id: "audit", kind: "service", model: "demo.audit", version: "1", configuration: {} },
    ],
    links: [
      { source: "app", target: "orders", policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout: 100, failureRate: 0 } },
      { source: "orders", target: "processor", policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout: 100, failureRate: 0 } },
      { source: "notify", target: "provider", policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout: 100, failureRate: 0 } },
      { source: "audit", target: "notify", policy: { requestLatency: 1, responseLatency: 1, jitter: 0, timeout: 100, failureRate: 0 } },
    ],
    databases: [
      { owner: "audit", tables: [table("log")], initial: { log: {} } },
      { owner: "orders", tables: [table("orders")], initial: { orders: {} } },
    ],
    stores: [],
    destinations: [{ id: "OrderCreated", kind: "topic", deliveryDelay: 1, ackTimeout: 50, retryDelay: 1, maxAttempts: 3, capacity: 100 }],
    subscriptions: [],
  },
  external: [],
  faults: [],
  actions: [
    { id: "start-orders", at: 0, kind: "service", target: "orders", state: "RUNNING" },
    { id: "start-notify", at: 0, kind: "service", target: "notify", state: "RUNNING" },
    { id: "start-audit", at: 0, kind: "service", target: "audit", state: "RUNNING" },
    { id: "checkout", at: 1, kind: "client", target: "app", action: "checkout", data: { orderId: "o1" } },
  ],
  assertions: [{ id: "ok", predicate: "demo.true", parameters: {}, mode: "always" }],
  configuration: { startTime: 0, historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} },
};
const document = packaged as unknown as CanonicalValue;

const policy: LessonOverlayPolicy = {
  version: 1, lesson: "design-fixture@1",
  faults: { rules: [{ point: "network.response", effects: ["drop"] }], scheduled: [], maxEntries: 1 },
  parameters: [],
  architecture: {
    slots: [{ component: "notify", models: ["demo.gap", "demo.mailer", "demo.inbox", "demo.broadcaster", "demo.linkless"].map(name => ({ model: name, version: "1" })) }],
    bindings: [
      { component: "orders", peer: "processor", candidates: ["processor", "backup", "refunds", "app"] },
      { component: "notify", peer: "provider", candidates: ["provider", "backup"] },
    ],
    resources: [
      { owner: "notify", resource: "store" }, { owner: "orders", resource: "database" }, { owner: "orders", resource: "store" },
      { owner: "app", resource: "database" }, { owner: "audit", resource: "database" },
    ],
    subscriptions: [{ consumer: "notify", destination: "OrderCreated" }, { consumer: "orders", destination: "OrderCreated" }],
    linkPolicy: policyLink as unknown as NonNullable<LessonOverlayPolicy["architecture"]>["linkPolicy"],
    maxEdits: 4,
  },
};

const mailer = { component: "notify", model: "demo.mailer", version: "1", options: [] };
const subscribeNotify = { consumer: "notify", destination: "OrderCreated", change: "subscribe" };
/** The "fill the gap" solution: a mailer subscribed to OrderCreated. */
const mailerDesign = { slots: [mailer], subscriptions: [subscribeNotify] };
const overlay = (architecture: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) =>
  ({ version: 1, ...(architecture === undefined ? {} : { architecture }), ...extra }) as unknown as CanonicalValue;
const compose = (input: CanonicalValue) => composeOverlay(document, policy, input, validate, catalog);
const codes = (diagnostics: readonly ScenarioDiagnostic[]) => diagnostics.map(item => `${item.path} ${item.code}`);
const applied = (input: CanonicalValue) => {
  const result = compose(input);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
};
const rejected = (input: CanonicalValue) => {
  const result = compose(input);
  assert.ok(!result.ok, "expected a rejection");
  return result;
};

/**
 * The test's own reading of a design: which architecture edits turn the
 * packaged document into the applied one. Independent of the application code.
 */
function diff(before: CanonicalValue, after: CanonicalValue): ArchitectureEdits {
  const left = (before as Doc).architecture as Doc;
  const right = (after as Doc).architecture as Doc;
  const items = (side: Doc, name: string) => side[name] as Doc[];
  const leftComponents = new Map(items(left, "components").map(item => [item.id as string, item]));
  const slots = [];
  const bindings = [];
  for (const component of items(right, "components")) {
    const original = leftComponents.get(component.id as string)!;
    const descriptor = catalog.find(component.model as string, component.version as string)!;
    const peers = new Set(descriptor.peers.map(item => item.name));
    const configuration = component.configuration as Doc;
    const options = Object.entries(configuration).filter(([key]) => !peers.has(key)).sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => ({ key, value }));
    const before = original.configuration as Doc;
    if (original.model !== component.model || original.version !== component.version || canonicalEncode(Object.fromEntries(options.map(item => [item.key, item.value])) as CanonicalValue) !== canonicalEncode(Object.fromEntries(Object.entries(before).filter(([key]) => !peers.has(key))) as CanonicalValue)) {
      slots.push({ component: component.id as string, model: component.model as string, version: component.version as string, options });
    }
    for (const name of [...peers].sort()) {
      if (configuration[name] !== undefined && configuration[name] !== before[name]) bindings.push({ component: component.id as string, peer: name, target: configuration[name] as string });
    }
  }
  const owners = (side: Doc, name: string) => new Set(items(side, name).map(item => item.owner as string));
  const resources = [];
  for (const [name, resource] of [["databases", "database"], ["stores", "store"]] as const) {
    const was = owners(left, name);
    const now = owners(right, name);
    for (const owner of [...was].filter(item => !now.has(item))) resources.push({ owner, resource, change: "detach" as const });
    for (const owner of [...now].filter(item => !was.has(item))) resources.push({ owner, resource, change: "attach" as const });
  }
  resources.sort((a, b) => a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : a.resource < b.resource ? -1 : 1);
  const pairs = (side: Doc) => new Set(items(side, "subscriptions").map(item => `${item.consumer as string}\u0000${item.destination as string}`));
  const wasSubscribed = pairs(left);
  const nowSubscribed = pairs(right);
  const subscriptions = [
    ...[...wasSubscribed].filter(item => !nowSubscribed.has(item)).map(item => ({ item, change: "unsubscribe" as const })),
    ...[...nowSubscribed].filter(item => !wasSubscribed.has(item)).map(item => ({ item, change: "subscribe" as const })),
  ].sort((a, b) => a.item < b.item ? -1 : 1).map(({ item, change }) => {
    const [consumer, destination] = item.split("\u0000") as [string, string];
    return { consumer, destination, change };
  });
  return { slots, bindings, resources, subscriptions };
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("the packaged fixture is valid and the gap lesson runs", async () => {
  assert.deepEqual(validate(document), []);
  const session = openHarness(engine.create(document));
  await session.run();
  assert.equal(session.inspect().status, "COMPLETED");
});

test("ARCH-AC-1: no overlay, no architecture, and an empty architecture give the packaged document and runId", () => {
  const runIds = new Set<string>();
  for (const input of [undefined, overlay(undefined), overlay({}), overlay({ slots: [], bindings: [], resources: [], subscriptions: [] })]) {
    const result = composeOverlay(document, policy, input, validate, catalog);
    assert.ok(result.ok);
    assert.equal(Object.hasOwn(result.overlay, "architecture"), false, "an empty architecture normalizes to absent");
    assert.equal(canonicalEncode(result.document), canonicalEncode(document));
    runIds.add(engine.create(result.document).simulation.history.export().runId);
  }
  assert.equal(runIds.size, 1);
  // A lesson without an allowance accepts the empty architecture too.
  const { architecture: _closedAllowance, ...closed } = policy;
  const result = composeOverlay(document, closed, overlay({ slots: [] }), validate);
  assert.ok(result.ok);
  assert.equal(result.document, document);
});

test("entries that leave the document unchanged are removed, so the overlay is empty", () => {
  const result = applied(overlay({
    bindings: [{ component: "orders", peer: "processor", target: "processor" }],
    resources: [{ owner: "notify", resource: "store", change: "detach" }],
    subscriptions: [{ consumer: "orders", destination: "OrderCreated", change: "unsubscribe" }],
  }));
  assert.equal(result.overlay.architecture, undefined);
  assert.equal(canonicalEncode(result.document), canonicalEncode(document));
  // A slot entry is a no-op only when it gives the packaged model and the packaged configuration.
  const filled = structuredClone(packaged);
  filled.architecture.components[6] = { id: "notify", kind: "service", model: "demo.mailer", version: "1", configuration: { retries: 2 } as never };
  filled.architecture.subscriptions = [{ destination: "OrderCreated", consumer: "notify" }] as never;
  const filledDocument = filled as unknown as CanonicalValue;
  assert.deepEqual(validate(filledDocument), []);
  const same = composeOverlay(filledDocument, policy, overlay({ slots: [{ ...mailer, options: [{ key: "retries", value: 2 }] }] }), validate, catalog);
  assert.ok(same.ok);
  assert.equal(same.overlay.architecture, undefined);
  const other = composeOverlay(filledDocument, policy, overlay({ slots: [mailer] }), validate, catalog);
  assert.ok(other.ok);
  assert.deepEqual(plain(other.overlay.architecture!.slots), [mailer]);
});

test("choosing the packaged placeholder again replaces its configuration, so it is an edit (#122)", () => {
  // ADR-005 step 1 replaces the configuration with the options; the placeholder's `interface` is not an option.
  const result = rejected(overlay({ slots: [{ component: "notify", model: "demo.gap", version: "1", options: [] }] }));
  assert.deepEqual(codes(result.diagnostics), ["/architecture/slots/0/model INTERFACE"]);
});

test("normalization sorts every list and option, and drops options equal to the model default", () => {
  const checked = validateOverlay(overlay({
    subscriptions: [subscribeNotify],
    resources: [{ owner: "orders", resource: "store", change: "attach" }, { owner: "notify", resource: "store", change: "attach" }],
    bindings: [{ component: "orders", peer: "processor", target: "backup" }],
    slots: [{ component: "notify", model: "demo.mailer", version: "1", options: [{ key: "retries", value: 1 }] }],
  }), { ...policy, architecture: { ...policy.architecture!, maxEdits: 6 } }, { packaged: document, catalog });
  assert.deepEqual(checked.diagnostics, []);
  assert.deepEqual(plain(checked.overlay!.architecture), {
    slots: [{ component: "notify", model: "demo.mailer", version: "1", options: [] }],
    bindings: [{ component: "orders", peer: "processor", target: "backup" }],
    resources: [{ owner: "notify", resource: "store", change: "attach" }, { owner: "orders", resource: "store", change: "attach" }],
    subscriptions: [subscribeNotify],
  });
  const options = validateOverlay(overlay({ slots: [{ component: "notify", model: "demo.mailer", version: "1", options: [{ key: "retries", value: 3 }] }] }), policy, { packaged: document, catalog });
  assert.deepEqual(plain(options.overlay!.architecture!.slots[0]!.options), [{ key: "retries", value: 3 }]);
});

test("application follows ADR-005: slots in place, resources, subscriptions, then bindings with derived links", () => {
  const generous = { ...policy, architecture: { ...policy.architecture!, maxEdits: 6 } };
  const result = composeOverlay(document, generous, overlay({
    slots: [{ component: "notify", model: "demo.inbox", version: "1", options: [] }],
    resources: [{ owner: "notify", resource: "store", change: "attach" }, { owner: "audit", resource: "database", change: "detach" }, { owner: "orders", resource: "store", change: "attach" }],
    subscriptions: [subscribeNotify],
    bindings: [{ component: "orders", peer: "processor", target: "backup" }],
  }), validate, catalog);
  assert.ok(result.ok, JSON.stringify(result));
  const architecture = (result.document as unknown as typeof packaged).architecture;
  assert.deepEqual(architecture.components.map(item => item.id), packaged.architecture.components.map(item => item.id), "a filled slot keeps its position");
  assert.deepEqual(plain(architecture.components[6]), { id: "notify", kind: "service", model: "demo.inbox", version: "1", configuration: {} }, "the placeholder interface is not carried over");
  assert.deepEqual(plain(architecture.components[1]!.configuration), { processor: "backup" });
  assert.deepEqual(architecture.databases.map(item => item.owner), ["orders"], "a detached database is removed in place");
  assert.deepEqual(plain(architecture.stores), [{ owner: "notify", initial: [] }, { owner: "orders", initial: [] }]);
  assert.deepEqual(plain(architecture.subscriptions), [{ destination: "OrderCreated", consumer: "notify" }]);
  assert.deepEqual(plain(architecture.links.slice(4)), [{ source: "orders", target: "backup", policy: policyLink }]);
  assert.deepEqual(architecture.links.slice(0, 4).map(link => `${link.source}->${link.target}`), packaged.architecture.links.map(link => `${link.source}->${link.target}`), "links are never removed");
  // An attached database has the owner's declared tables and no initial rows.
  const attach = composeOverlay(document, generous, overlay({ resources: [{ owner: "orders", resource: "database", change: "detach" }] }), validate, catalog);
  assert.ok(!attach.ok);
  const reattached = applyOverlay(document, generous, { version: 1, faults: [], scheduledFaults: [], parameters: [], architecture: {
    slots: [], bindings: [], subscriptions: [], resources: [{ owner: "audit", resource: "database", change: "detach" }, { owner: "notify", resource: "database", change: "attach" }],
  } }, catalog) as unknown as typeof packaged;
  assert.deepEqual(plain(reattached.architecture.databases.at(-1)), { owner: "notify", tables: [], initial: {} });
  // The packaged document is never mutated.
  assert.deepEqual(packaged.architecture.components[1]!.configuration, {});
  assert.equal(packaged.architecture.links.length, 4);
});

test("ARCH-AC-2: diff(packaged, apply(overlay)) equals the normalized edits, and edit order does not change identity", () => {
  const designs: Record<string, unknown[]>[] = [
    mailerDesign,
    { slots: [{ ...mailer, options: [{ key: "retries", value: 2 }] }], subscriptions: [subscribeNotify], bindings: [{ component: "notify", peer: "provider", target: "provider" }] },
    { slots: [{ component: "notify", model: "demo.inbox", version: "1", options: [] }], subscriptions: [subscribeNotify], resources: [{ owner: "notify", resource: "store", change: "attach" }] },
    { bindings: [{ component: "orders", peer: "processor", target: "backup" }], resources: [{ owner: "audit", resource: "database", change: "detach" }, { owner: "orders", resource: "store", change: "attach" }] },
  ];
  for (const design of designs) {
    const result = applied(overlay(design));
    assert.deepEqual(plain(diff(document, result.document)), plain(result.overlay.architecture), JSON.stringify(design));
    const reversed = Object.fromEntries(Object.entries(design).reverse().map(([key, list]) => [key, [...list].reverse()]));
    const again = applied(overlay(reversed));
    assert.equal(overlayKey(again.overlay), overlayKey(result.overlay));
    assert.equal(engine.create(again.document).simulation.history.export().runId, engine.create(result.document).simulation.history.export().runId);
  }
});

test("ARCH-AC-3: a design replays identically, Reset reproduces it, and any single edit changes runId", async () => {
  const design = overlay({ slots: [{ ...mailer, options: [{ key: "retries", value: 2 }] }], subscriptions: [subscribeNotify], bindings: [{ component: "orders", peer: "processor", target: "backup" }] });
  const exports = [];
  for (let index = 0; index < 2; index++) {
    const session = openHarness(engine.create(applied(design).document));
    await session.run();
    exports.push(session.inspect());
    if (index === 1) {
      await session.reset();
      await session.run();
      exports.push(session.inspect());
    }
  }
  assert.equal(exports[0]!.status, "COMPLETED");
  assert.ok(compareExports(exports[0]!, exports[1]!));
  assert.ok(compareExports(exports[0]!, exports[2]!));
  const sent = exports[0]!.history.observations.filter(item => item.type === "network.request.sent").map(item => `${item.source}->${item.target}`);
  assert.ok(sent.includes("orders->backup") && sent.includes("notify->provider"), "the design's bindings carry the calls");

  const runId = (input: CanonicalValue) => engine.create(applied(input).document).simulation.history.export().runId;
  const base = runId(design);
  const variants = [
    overlay({ slots: [{ ...mailer, options: [{ key: "retries", value: 3 }] }], subscriptions: [subscribeNotify], bindings: [{ component: "orders", peer: "processor", target: "backup" }] }),
    overlay({ slots: [mailer], subscriptions: [subscribeNotify], bindings: [{ component: "orders", peer: "processor", target: "backup" }] }),
    overlay({ slots: [{ ...mailer, options: [{ key: "retries", value: 2 }] }], subscriptions: [subscribeNotify] }),
    overlay({ slots: [{ ...mailer, options: [{ key: "retries", value: 2 }] }], subscriptions: [subscribeNotify], bindings: [{ component: "orders", peer: "processor", target: "backup" }],
      resources: [{ owner: "orders", resource: "store", change: "attach" }] }),
  ];
  const ids = variants.map(runId);
  assert.equal(new Set([base, ...ids]).size, ids.length + 1);
});

test("stage 3 checks the allowance, option domains, conflicting edits, and the limit before the overlay is applied", () => {
  let validated = 0;
  const counting = (value: CanonicalValue) => { validated++; return validate(value); };
  const cases: [Record<string, unknown>, string[]][] = [
    [{ slots: [{ component: "orders", model: "demo.mailer", version: "1", options: [] }] }, ["/architecture/slots/0/component OVERLAY_NOT_ALLOWED"]],
    [{ slots: [{ component: "notify", model: "demo.orders", version: "1", options: [] }] }, ["/architecture/slots/0/model OVERLAY_NOT_ALLOWED"]],
    [{ slots: [{ component: "notify", model: "demo.mailer", version: "2", options: [] }] }, ["/architecture/slots/0/version OVERLAY_NOT_ALLOWED"]],
    [{ slots: [{ ...mailer, options: [{ key: "tier", value: "gold" }] }] }, ["/architecture/slots/0/options/0/key OVERLAY_NOT_ALLOWED"]],
    [{ slots: [{ ...mailer, options: [{ key: "retries", value: 9 }, { key: "retries", value: 2 }] }] },
      ["/architecture/slots/0/options/0/value PARAMETER_VALUE", "/architecture/slots/0/options/1/key DUPLICATE"]],
    [{ bindings: [{ component: "app", peer: "orders", target: "orders" }] }, ["/architecture/bindings/0/component OVERLAY_NOT_ALLOWED"]],
    [{ bindings: [{ component: "orders", peer: "ledger", target: "backup" }] }, ["/architecture/bindings/0/peer OVERLAY_NOT_ALLOWED"]],
    [{ bindings: [{ component: "orders", peer: "processor", target: "provider" }] }, ["/architecture/bindings/0/target OVERLAY_NOT_ALLOWED"]],
    // The slot's packaged placeholder declares no `provider` peer, so the binding needs a model that does.
    [{ bindings: [{ component: "notify", peer: "provider", target: "backup" }] }, ["/architecture/bindings/0/peer OVERLAY_NOT_ALLOWED"]],
    [{ resources: [{ owner: "processor", resource: "store", change: "attach" }] }, ["/architecture/resources/0 OVERLAY_NOT_ALLOWED"]],
    [{ subscriptions: [{ consumer: "audit", destination: "OrderCreated", change: "subscribe" }] }, ["/architecture/subscriptions/0 OVERLAY_NOT_ALLOWED"]],
    [{ resources: [{ owner: "orders", resource: "store", change: "attach" }, { owner: "orders", resource: "store", change: "detach" }],
      subscriptions: [subscribeNotify, { ...subscribeNotify, change: "unsubscribe" }] }, ["/architecture/resources/1 DUPLICATE", "/architecture/subscriptions/1 DUPLICATE"]],
    [{ slots: [mailer, { ...mailer, model: "demo.inbox" }] }, ["/architecture/slots/1 DUPLICATE"]],
    [{ slots: [mailer], subscriptions: [subscribeNotify], bindings: [{ component: "orders", peer: "processor", target: "backup" }],
      resources: [{ owner: "orders", resource: "store", change: "attach" }, { owner: "notify", resource: "store", change: "attach" }] }, ["/architecture/subscriptions/0 OVERLAY_LIMIT"]],
    [{ slots: [{ component: "notify" }], bindings: [{ component: 7 }], resources: [{ owner: "orders", resource: "disk", change: "move" }], extra: [] },
      ["/architecture/bindings/0/component TYPE", "/architecture/bindings/0/peer REQUIRED", "/architecture/bindings/0/target REQUIRED", "/architecture/extra UNSUPPORTED",
        "/architecture/resources/0/change TYPE", "/architecture/resources/0/resource TYPE", "/architecture/slots/0/model REQUIRED", "/architecture/slots/0/version REQUIRED"]],
    [{ slots: {}, subscriptions: [{ ...subscribeNotify, why: "x" }] }, ["/architecture/slots TYPE", "/architecture/subscriptions/0/why UNSUPPORTED"]],
  ];
  for (const [body, expected] of cases) {
    const result = composeOverlay(document, policy, overlay(body), counting, catalog);
    assert.ok(!result.ok);
    assert.equal(result.code, "INVALID_OVERLAY");
    assert.deepEqual(codes(result.diagnostics), expected, JSON.stringify(body));
  }
  // No-op entries do not count toward the limit: six entries, four edits.
  assert.ok(compose(overlay({ ...mailerDesign, bindings: [{ component: "orders", peer: "processor", target: "processor" }, { component: "notify", peer: "provider", target: "provider" }],
    resources: [{ owner: "notify", resource: "store", change: "attach" }, { owner: "orders", resource: "store", change: "attach" }] })).ok);
  assert.equal(validated, 0, "stage-3 failures stop before the overlay is applied");
  const root = composeOverlay(document, policy, overlay(undefined, { architecture: [] }), counting, catalog);
  assert.ok(!root.ok);
  assert.deepEqual(codes(root.diagnostics), ["/architecture TYPE"]);
});

test("a lesson without an allowance accepts no architecture edit", () => {
  const { architecture: _closedAllowance, ...closed } = policy;
  const result = composeOverlay(document, closed, overlay(mailerDesign), validate);
  assert.ok(!result.ok);
  assert.deepEqual(codes(result.diagnostics), [
    "/architecture/slots/0 OVERLAY_LIMIT", "/architecture/slots/0/component OVERLAY_NOT_ALLOWED",
    "/architecture/subscriptions/0 OVERLAY_LIMIT", "/architecture/subscriptions/0 OVERLAY_NOT_ALLOWED",
  ]);
  assert.deepEqual(Object.values(OverlayDiagnosticCodes).sort(), ["OVERLAY_ID_PREFIX", "OVERLAY_LIMIT", "OVERLAY_NOT_ALLOWED", "PARAMETER_VALUE", "UNKNOWN_PARAMETER"]);
});

test("ARCH-AC-4: each composition code is reachable through an edit and attributed to it", () => {
  const cases: [string, Record<string, unknown>, string[]][] = [
    ["PEER", { bindings: [{ component: "orders", peer: "processor", target: "app" }] }, ["/architecture/bindings/0/target PEER"]],
    ["INTERFACE", { bindings: [{ component: "orders", peer: "processor", target: "refunds" }] }, ["/architecture/bindings/0/target INTERFACE"]],
    ["LINK", { slots: [{ component: "notify", model: "demo.linkless", version: "1", options: [] }] }, ["/architecture/slots/0/model LINK"]],
    // The broadcaster also drops POST /notify, which audit's packaged peer calls: that packaged location names the slot through the peer.
    ["PUBLISH", { slots: [{ component: "notify", model: "demo.broadcaster", version: "1", options: [] }] }, ["/architecture/slots/0/model INTERFACE", "/architecture/slots/0/model PUBLISH"]],
    ["STORAGE", { resources: [{ owner: "orders", resource: "database", change: "detach" }] }, ["/architecture/resources/0 STORAGE"]],
    ["STORAGE", { slots: [{ component: "notify", model: "demo.inbox", version: "1", options: [] }], subscriptions: [subscribeNotify] }, ["/architecture/slots/0/model STORAGE"]],
    ["OWNERSHIP", { resources: [{ owner: "app", resource: "database", change: "attach" }] }, ["/architecture/resources/0 OWNERSHIP"]],
    ["DUPLICATE", { resources: [{ owner: "orders", resource: "database", change: "attach" }] }, ["/architecture/resources/0 DUPLICATE"]],
    ["SUBSCRIPTION", { subscriptions: [{ consumer: "orders", destination: "OrderCreated", change: "subscribe" }] }, ["/architecture/subscriptions/0 SUBSCRIPTION"]],
  ];
  const reached = new Set<string>();
  for (const [code, body, expected] of cases) {
    const result = rejected(overlay(body));
    assert.equal(result.code, "INVALID_OVERLAY", code);
    assert.deepEqual(codes(result.diagnostics), expected, code);
    reached.add(code);
  }
  assert.deepEqual([...reached].sort(), ["DUPLICATE", "INTERFACE", "LINK", "OWNERSHIP", "PEER", "PUBLISH", "STORAGE", "SUBSCRIPTION"]);
  // Paths are sorted by path, then code, across edits.
  const mixed = rejected(overlay({
    slots: [{ component: "notify", model: "demo.broadcaster", version: "1", options: [] }],
    bindings: [{ component: "orders", peer: "processor", target: "refunds" }],
  }));
  assert.deepEqual(codes(mixed.diagnostics), ["/architecture/bindings/0/target INTERFACE", "/architecture/slots/0/model INTERFACE", "/architecture/slots/0/model PUBLISH"]);
});

test("#131 a slot fill with an unsubscribed consumer model is attributed to that slot edit", () => {
  // The mailer consumes OrderCreated, but nothing subscribes it: the location is the consumer component, which the slot replaced.
  const result = rejected(overlay({ slots: [mailer] }));
  assert.equal(result.code, "INVALID_OVERLAY");
  assert.deepEqual(codes(result.diagnostics), ["/architecture/slots/0/model SUBSCRIPTION"]);
});

test("#131 an unsubscribe edit that removes a declared consumer's subscription is attributed to that edit", () => {
  // A variant whose packaged notify is already the subscribed mailer.
  const architecture = packaged.architecture;
  const subscribed = {
    ...packaged,
    architecture: {
      ...architecture,
      components: architecture.components.map(item => item.id === "notify" ? { ...item, model: "demo.mailer", configuration: {} } : item),
      subscriptions: [{ destination: "OrderCreated", consumer: "notify" }],
    },
  } as unknown as CanonicalValue;
  assert.deepEqual(validate(subscribed), []);
  const composeSubscribed = (input: CanonicalValue) => composeOverlay(subscribed, policy, input, validate, catalog);
  const unsubscribe = { ...subscribeNotify, change: "unsubscribe" };
  const result = composeSubscribed(overlay({ subscriptions: [unsubscribe] }));
  assert.ok(!result.ok);
  assert.equal(result.code, "INVALID_OVERLAY");
  assert.deepEqual(codes(result.diagnostics), ["/architecture/subscriptions/0 SUBSCRIPTION"]);
  // The existing rule, accepted in triage: an earlier edit on the same component, in normalized order, wins.
  const stored = composeSubscribed(overlay({ resources: [{ owner: "notify", resource: "store", change: "attach" }], subscriptions: [unsubscribe] }));
  assert.ok(!stored.ok);
  assert.deepEqual(codes(stored.diagnostics), ["/architecture/resources/0 SUBSCRIPTION"]);
});

test("#183 a slot edit that removes the endpoint a workload calls is attributed to that slot edit", () => {
  // A workload-addressed client (#121) calls notify's POST /notify through its action data. Audit is
  // left out so that its packaged peer, which also calls POST /notify, cannot name the slot instead.
  const shopper = model({ model: "demo.shopper", kind: "client", actions: ["send"], workloadCalls: [{ action: "send", target: "to", endpoint: "call" }] });
  const architecture = packaged.architecture;
  const withWorkload = {
    ...packaged,
    architecture: {
      ...architecture,
      components: [...architecture.components.filter(item => item.id !== "audit"), { id: "shopper", kind: "client", model: "demo.shopper", version: "1", configuration: {} }],
      links: [...architecture.links.filter(item => item.source !== "audit"), { source: "shopper", target: "notify", policy: policyLink }],
      databases: architecture.databases.filter(item => item.owner !== "audit"),
    },
    actions: [
      ...packaged.actions.filter(item => item.target !== "audit"),
      { id: "send", at: 2, kind: "client", target: "shopper", action: "send", data: { to: "notify", call: "POST /notify" } },
    ],
  } as unknown as CanonicalValue;
  const workloadEngine = engineFor([...models, shopper], [truePredicate]);
  const workloadPolicy = { ...policy, architecture: { ...policy.architecture!, resources: policy.architecture!.resources.filter(item => item.owner !== "audit") } };
  const composeWorkload = (input: CanonicalValue) => composeOverlay(withWorkload, workloadPolicy, input, value => workloadEngine.validate(value), catalogOf([...models, shopper]));
  assert.deepEqual(workloadEngine.validate(withWorkload), []);
  // The broadcaster offers no POST /notify, so the packaged workload call breaks: INTERFACE at /actions/3/data/call.
  const result = composeWorkload(overlay({ slots: [{ component: "notify", model: "demo.broadcaster", version: "1", options: [] }] }));
  assert.ok(!result.ok);
  assert.equal(result.code, "INVALID_OVERLAY");
  assert.deepEqual(codes(result.diagnostics), ["/architecture/slots/0/model INTERFACE", "/architecture/slots/0/model PUBLISH"]);
  // Only the fields a workloadCalls entry declares name its target: another data field of the same action does not.
  const injected = (path: string) => composeOverlay(withWorkload, workloadPolicy, overlay({ slots: [mailer] }),
    value => value === withWorkload ? [] : [{ path, code: "INTERFACE" }], catalogOf([...models, shopper]));
  for (const [path, expected] of [["/actions/3/data/to", "/architecture/slots/0/model"], ["/actions/3/data/call", "/architecture/slots/0/model"], ["/actions/3/data/note", "/architecture"]]) {
    const result = injected(path!);
    assert.ok(!result.ok);
    assert.deepEqual(codes(result.diagnostics), [`${expected} INTERFACE`], path);
  }
});

test("a diagnostic that also occurs for the packaged document alone is a catalog defect, even after indexes shift", () => {
  const defect = { path: "/architecture/databases/1/tables", code: "STORAGE" };
  // Detaching audit's database moves orders' database from index 1 to index 0.
  const shifted = (value: CanonicalValue) => value === document ? [defect] : [{ path: "/architecture/databases/0/tables", code: "STORAGE" }];
  const input = overlay({ resources: [{ owner: "audit", resource: "database", change: "detach" }] });
  const result = composeOverlay(document, policy, input, shifted, catalog);
  assert.ok(!result.ok);
  assert.equal(result.code, "INVALID_SCENARIO");
  // Without the packaged diagnostic the overlay caused it. The location names orders, which no edit changed: /architecture.
  const caused = composeOverlay(document, policy, input, value => value === document ? [] : [{ path: "/architecture/databases/0/tables", code: "STORAGE" }], catalog);
  assert.ok(!caused.ok);
  assert.deepEqual([caused.code, ...codes(caused.diagnostics)], ["INVALID_OVERLAY", "/architecture STORAGE"]);
  // A location that names the detached owner is attributed to the detach.
  const named = composeOverlay(document, policy, input, value => value === document ? [] : [{ path: "/architecture/components/7", code: "STORAGE" }], catalog);
  assert.ok(!named.ok);
  assert.deepEqual([named.code, ...codes(named.diagnostics)], ["INVALID_OVERLAY", "/architecture/resources/0 STORAGE"]);
});

test("architecture edits combine with ADR-004 faults, and fault diagnostics keep their overlay paths", () => {
  const drop = { id: "student-drop", point: "network.response", source: "processor", target: "orders", from: 0, effect: { kind: "drop" } };
  const result = applied(overlay(mailerDesign, { faults: [drop] }));
  assert.deepEqual(((result.document as Doc).faults as Doc[]).map(item => item.id), ["student-drop"]);
  const ghost = rejected(overlay(mailerDesign, { faults: [{ ...drop, target: "nobody" }] }));
  assert.deepEqual(codes(ghost.diagnostics), ["/faults/0/target UNKNOWN_COMPONENT"]);
});

test("rejected designs are pure: no model is instantiated and no randomness is drawn", () => {
  instantiated = 0;
  for (const body of [{ slots: [mailer] }, { bindings: [{ component: "orders", peer: "processor", target: "app" }] }, { slots: [{ component: "orders" }] }]) rejected(overlay(body));
  assert.equal(instantiated, 0);
});
