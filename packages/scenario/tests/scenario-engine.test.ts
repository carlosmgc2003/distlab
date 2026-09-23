import { test } from "node:test";
import assert from "node:assert/strict";
import type { CanonicalValue, ClientDefinition, ExternalDefinition, ServiceDefinition } from "@distlab/contracts";
import type { ComponentInstance } from "@distlab/contracts";
import { compareExports, openHarness, type ScenarioModel } from "@distlab/scenario";
import { engineFor, falsePredicate, model, predicate, truePredicate } from "./support.ts";

const behavior = { latency: 0, degradedExtraLatency: 0, dropResponse: false, parameters: null };

function checkoutModels(): ScenarioModel[] {
  return [
    model({ model: "demo.customer", kind: "client", actions: ["checkout"], instantiate: instance => customer(instance) }),
    model({ model: "demo.orders", kind: "service", endpoints: ["POST /orders"], instantiate: instance => orders(instance) }),
    model({ model: "demo.billing", kind: "service", consumers: ["OrderPlaced"], instantiate: instance => billing(instance) }),
    model({ model: "demo.processor", kind: "external", operations: ["authorize"], instantiate: instance => processor(instance) }),
  ];
}

function customer(instance: ComponentInstance): ClientDefinition {
  return { id: instance.id, version: instance.version, initialState: { reply: null }, callbacks: {}, actions: {
    checkout: function* (data, ctx) {
      const reply = (yield ctx.http.request({ target: "orders", endpoint: "POST /orders", body: data })) as CanonicalValue;
      ctx.state.set("reply", reply);
      return reply;
    },
  } };
}
function orders(instance: ComponentInstance): ServiceDefinition {
  return { id: instance.id, version: instance.version, consumers: {}, background: {}, endpoints: {
    "POST /orders": function* (body, ctx) {
      const request = body as { orderId: string };
      const tx = ctx.db!.begin();
      tx.insert("orders", request.orderId, { orderId: request.orderId, state: "CREATED" });
      yield tx.commit();
      yield ctx.events.publish("OrderPlaced", { type: "OrderPlaced", body: { orderId: request.orderId } });
      return { status: "ok" as const, body: { orderId: request.orderId } };
    },
  } };
}
function billing(instance: ComponentInstance): ServiceDefinition {
  return { id: instance.id, version: instance.version, endpoints: {}, background: {}, consumers: {
    OrderPlaced: function* (delivery, ctx) {
      try {
        yield ctx.http.request({ target: "processor", endpoint: "authorize", body: delivery.message.body });
        ctx.kv!.set("outcome", "replied");
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "error";
        ctx.kv!.set("outcome", code);
      }
    },
  } };
}
function processor(instance: ComponentInstance): ExternalDefinition {
  return { id: instance.id, version: instance.version, initialState: { authorized: [] }, operations: { authorize: { apply: (body, state) => {
    const orderId = (body as { orderId: string }).orderId;
    const authorized = [...((state as { authorized: readonly string[] }).authorized), orderId];
    return { nextState: { authorized }, reply: { status: "ok", body: { authorizationId: "auth-1" } }, visibleChanges: { count: authorized.length }, callbacks: [] };
  } } } };
}

function checkoutScenario(): CanonicalValue {
  return {
    version: 1, name: "checkout", seed: "checkout-seed", startTime: 0,
    architecture: {
      components: [
        { id: "customer", kind: "client", model: "demo.customer", version: "1", configuration: {} },
        { id: "orders", kind: "service", model: "demo.orders", version: "1", configuration: {} },
        { id: "billing", kind: "service", model: "demo.billing", version: "1", configuration: {} },
        { id: "processor", kind: "external", model: "demo.processor", version: "1", configuration: {} },
      ],
      links: [{ source: "customer", target: "orders" }, { source: "billing", target: "processor" }],
      databases: [{ owner: "orders", tables: [{ name: "orders", unique: [["orderId"]], checks: [] }], initial: { orders: {} } }],
      stores: [{ owner: "billing", initial: [{ key: "boot", value: "ready", ttl: 5 }] }],
      destinations: [{ id: "OrderPlaced", kind: "topic", ackTimeout: 5000 }],
      subscriptions: [{ destination: "OrderPlaced", consumer: "billing" }],
    },
    external: [{ target: "processor", operation: "authorize", behavior }],
    faults: [{ id: "drop-authorize", point: "network.response", source: "processor", target: "billing", name: "authorize", from: 0, probability: 1, maxApplications: 1, effect: { kind: "drop" } }],
    actions: [
      { id: "start-orders", at: 0, kind: "service", target: "orders", state: "RUNNING" },
      { id: "start-billing", at: 0, kind: "service", target: "billing", state: "RUNNING" },
      { id: "checkout", at: 0, kind: "client", target: "customer", action: "checkout", data: { orderId: "o1" } },
    ],
    assertions: [
      { id: "steady", predicate: "demo.true", parameters: null, mode: "always" },
      { id: "saved", predicate: "demo.order-saved", parameters: { orderId: "o1" }, mode: "eventually", deadline: 5000 },
      { id: "unknown", predicate: "demo.billing-timeout", parameters: null, mode: "eventually", deadline: 5000 },
      { id: "effect", predicate: "demo.processor-effect", parameters: null, mode: "at", at: 5000 },
    ],
  };
}

const checkoutPredicates = [
  truePredicate,
  predicate("demo.order-saved", ({ projection }) => {
    const row = (((projection.databases as { orders?: { tables?: { orders?: Record<string, { state?: string }> } } }).orders)?.tables?.orders)?.["o1"];
    return { pass: row?.state === "CREATED", evidence: { state: row?.state ?? null } };
  }),
  predicate("demo.billing-timeout", ({ projection }) => {
    const entries = (projection.stores as { billing?: { key: string; value: string }[] }).billing ?? [];
    const outcome = entries.find(entry => entry.key === "outcome")?.value ?? null;
    return { pass: outcome === "NETWORK_TIMEOUT", evidence: { outcome } };
  }),
  predicate("demo.processor-effect", ({ projection }) => {
    const boundary = (projection.components as { processor?: { effectCount?: number; visible?: { count?: number } } }).processor;
    return { pass: boundary?.effectCount === 1 && boundary.visible?.count === 1, evidence: { effectCount: boundary?.effectCount ?? 0, count: boundary?.visible?.count ?? 0 } };
  }),
];

test("composed checkout orders startup, faults, and assertions without a UI", async () => {
  const engine = engineFor(checkoutModels(), checkoutPredicates);
  const scenario = checkoutScenario();
  assert.deepEqual(engine.validate(scenario), []);
  const session = engine.create(scenario);
  const harness = openHarness(session);
  const scheduled = session.simulation.history.export().observations.filter(item => item.type === "scheduler.event.scheduled").map(item => (item.data as { type: string }).type);
  assert.equal(scheduled[0], "kv.expiry.billing");
  assert.ok(scheduled.indexOf("scenario.action.orders") < scheduled.indexOf("service.orders.lifecycle"));
  assert.ok(scheduled.indexOf("scenario.action.billing") < scheduled.indexOf("scenario.action.customer"));
  assert.ok(scheduled.indexOf("scenario.action.customer") < scheduled.indexOf("scenario.assertion"));
  await harness.run();
  const finished = harness.inspect();
  assert.equal(finished.status, "COMPLETED");
  assert.deepEqual(finished.results.map(result => [result.id, result.status]), [["steady", "PASS"], ["saved", "PASS"], ["unknown", "PASS"], ["effect", "PASS"]]);
  const types = finished.history.observations.map(item => item.type);
  assert.equal(types.includes("fault.effect.selected"), true);
  assert.equal(types.includes("network.response.dropped"), true);
  assert.deepEqual(finished.history.observations.filter(item => item.type === "scenario.action.dispatched").map(item => (item.data as { actionId: string }).actionId), ["start-orders", "start-billing", "checkout"]);
  const again = openHarness(engine.create(scenario));
  const stepped = openHarness(engine.create(scenario));
  await again.run({ maxEventsPerYield: 1 });
  while (stepped.inspect().status !== "COMPLETED") await stepped.step();
  assert.equal(compareExports(finished, again.inspect()), true);
  assert.equal(compareExports(finished, stepped.inspect()), true);
  const touch = session.bindRuntime();
  touch();
  const completed = harness.results();
  await harness.reset();
  assert.throws(touch, { code: "STALE_CAPABILITY" });
  assert.equal(harness.results().some(result => result.status === "PENDING" || result.status === "PASS"), true);
  assert.notDeepEqual(harness.results(), completed);
  await harness.run();
  assert.equal(compareExports(harness.inspect(), finished), true);
  assert.equal(JSON.stringify(finished.history).includes("react"), false);
});

test("changed seed, input, and catalog version change the run fingerprint", () => {
  const engine = engineFor(checkoutModels(), checkoutPredicates);
  const scenario = checkoutScenario();
  const original = engine.create(scenario).simulation.history.export().runId;
  const reseeded = { ...(scenario as object), seed: "other-seed" } as CanonicalValue;
  assert.notEqual(engine.create(reseeded).simulation.history.export().runId, original);
  const engineVersion = engineFor(checkoutModels(), checkoutPredicates, { catalog: "2" });
  assert.notEqual(engineVersion.create(scenario).simulation.history.export().runId, original);
});

test("assertion boundaries, pause, predicate failure, and history failure", async () => {
  const app = model({ model: "demo.app", kind: "client", actions: ["go"], instantiate: instance => ({
    id: instance.id, version: instance.version, callbacks: {}, initialState: { done: false }, actions: {
      go: (_data, ctx) => { ctx.state.set("done", true); return true; },
    },
  }) });
  const done = predicate("demo.done", ({ projection }) => {
    const state = (projection.components as { app?: { state?: { done?: boolean } } }).app?.state;
    return { pass: state?.done === true, evidence: { done: state?.done === true } };
  });
  const boom = predicate("demo.boom", ({ projection }) => {
    if (projection.time >= 5) throw new Error("boom");
    return { pass: false, evidence: null };
  });
  const frozen = predicate("demo.frozen", ({ projection }) => {
    let rejected = false;
    try { (projection as { extra?: boolean }).extra = true; } catch { rejected = true; }
    return { pass: Object.isFrozen(projection) && rejected, evidence: { rejected } };
  });
  const deadline = engineFor([app], [done]);
  const session = deadline.create({
    version: 1, name: "deadline", seed: "deadline", architecture: { components: [{ id: "app", kind: "client", model: "demo.app", version: "1", configuration: {} }] },
    actions: [{ id: "go", at: 10, kind: "client", target: "app", action: "go", data: null }],
    assertions: [
      { id: "too-soon", predicate: "demo.done", parameters: null, mode: "eventually", deadline: 10 },
      { id: "in-time", predicate: "demo.done", parameters: null, mode: "eventually", deadline: 11 },
    ],
  });
  await session.simulation.run();
  assert.deepEqual(session.results().map(result => [result.id, result.status]), [["too-soon", "FAIL"], ["in-time", "PASS"]]);

  const worker = model({ model: "demo.worker", kind: "service" });
  const pausing = engineFor([worker], [falsePredicate]);
  const paused = openHarness(pausing.create({
    version: 1, name: "pause", seed: "pause", architecture: { components: [{ id: "worker", kind: "service", model: "demo.worker", version: "1", configuration: {} }] },
    actions: [{ id: "start", at: 0, kind: "service", target: "worker", state: "RUNNING" }],
    assertions: [{ id: "never", predicate: "demo.false", parameters: null, mode: "eventually", deadline: 50 }],
  }));
  assert.equal((await paused.run({ maxEvents: 1 })).reason, "EVENT_LIMIT");
  assert.equal(paused.results()[0]?.status, "PENDING");
  assert.equal(paused.inspect().status, "PAUSED");
  await paused.run();
  assert.equal(paused.results()[0]?.status, "FAIL");
  assert.equal(paused.inspect().status, "COMPLETED");

  const failing = engineFor([worker], [truePredicate, boom]);
  const failed = failing.create({
    version: 1, name: "boom", seed: "boom", architecture: { components: [{ id: "worker", kind: "service", model: "demo.worker", version: "1", configuration: {} }] },
    actions: [{ id: "later", at: 5, kind: "service", target: "worker", state: "RUNNING" }],
    assertions: [
      { id: "early", predicate: "demo.true", parameters: null, mode: "eventually", deadline: 9 },
      { id: "late", predicate: "demo.boom", parameters: null, mode: "eventually", deadline: 9 },
    ],
  });
  await assert.rejects(failed.simulation.run(), { code: "INVALID_ASSESSMENT_RESULT" });
  assert.equal(failed.simulation.status, "FAILED");
  assert.equal(failed.results().find(result => result.id === "early")?.status, "PASS");
  assert.equal(failed.results().find(result => result.id === "late")?.status, "INCOMPLETE");
  const sealed = failed.simulation.history.export().observations.length;
  failed.results();
  assert.equal(failed.simulation.history.export().observations.length, sealed);

  const host = engineFor([app], [frozen]);
  const withSubscriber = host.create({ version: 1, name: "frozen", seed: "frozen", architecture: { components: [{ id: "app", kind: "client", model: "demo.app", version: "1", configuration: {} }] }, assertions: [{ id: "frozen", predicate: "demo.frozen", parameters: null, mode: "always" }] });
  const without = host.create({ version: 1, name: "frozen", seed: "frozen", architecture: { components: [{ id: "app", kind: "client", model: "demo.app", version: "1", configuration: {} }] }, assertions: [{ id: "frozen", predicate: "demo.frozen", parameters: null, mode: "always" }] });
  withSubscriber.simulation.history.subscribe(() => { throw new Error("host"); });
  await withSubscriber.simulation.run();
  await without.simulation.run();
  assert.equal(compareExports(openHarness(withSubscriber).inspect(), openHarness(without).inspect()), true);
  assert.equal(withSubscriber.results()[0]?.status, "PASS");

  const counted = engineFor([], [truePredicate, predicate("demo.now", () => ({ pass: true, evidence: null }))]);
  const wide = counted.create({ version: 1, name: "limit", seed: "limit", architecture: { components: [] }, assertions: [
    { id: "always", predicate: "demo.true", parameters: null, mode: "always" },
    { id: "now", predicate: "demo.now", parameters: null, mode: "eventually", deadline: 5 },
  ] });
  const baseline = wide.simulation.history.export().observations.length;
  const limited = counted.create({ version: 1, name: "limit", seed: "limit", architecture: { components: [] }, configuration: { historyLimit: baseline }, assertions: [
    { id: "always", predicate: "demo.true", parameters: null, mode: "always" },
    { id: "now", predicate: "demo.now", parameters: null, mode: "eventually", deadline: 5 },
  ] });
  await assert.rejects(limited.simulation.run(), { code: "HISTORY_LIMIT_EXCEEDED" });
  assert.equal(limited.simulation.status, "FAILED");
  assert.equal(limited.results().find(result => result.id === "now")?.status, "PASS");
  assert.equal(limited.results().find(result => result.id === "always")?.status, "INCOMPLETE");
});

test("scheduled fault actions dispatch through the provider controller", async () => {
  const external = model({ model: "demo.external", kind: "external", operations: ["ping"], instantiate: instance => ({
    id: instance.id, version: instance.version, initialState: null, operations: {
      ping: { apply: () => ({ nextState: null, reply: { status: "ok" as const, body: null }, visibleChanges: null, callbacks: [] }) },
    },
  }) });
  const down = predicate("demo.down", ({ projection }) => {
    const availability = (projection.components as { provider?: { availability?: string } }).provider?.availability ?? null;
    return { pass: availability === "UNAVAILABLE", evidence: { availability } };
  });
  const session = engineFor([external], [down]).create({
    version: 1, name: "fault-action", seed: "fault",
    architecture: { components: [{ id: "provider", kind: "external", model: "demo.external", version: "1", configuration: {} }] },
    actions: [{ id: "down", at: 5, kind: "fault", fault: { id: "make-down", kind: "external-availability", target: "provider", state: "UNAVAILABLE" } }],
    assertions: [{ id: "down", predicate: "demo.down", parameters: null, mode: "at", at: 5 }],
  });
  await session.simulation.run();
  assert.deepEqual(session.results().map(result => [result.id, result.status]), [["down", "PASS"]]);
  assert.equal(session.simulation.history.export().observations.some(item => item.type === "scenario.action.dispatched"), true);
  assert.equal(session.simulation.history.export().observations.some(item => item.type === "fault.applied"), true);
});

test("illegal service transitions are terminal model errors and do not grade the run", async () => {
  const worker = model({ model: "demo.worker", kind: "service" });
  const session = engineFor([worker], [truePredicate]).create({
    version: 1, name: "transition", seed: "transition",
    architecture: { components: [{ id: "worker", kind: "service", model: "demo.worker", version: "1", configuration: {} }] },
    actions: [
      { id: "stop", at: 0, kind: "service", target: "worker", state: "STOPPED" },
      { id: "run", at: 1, kind: "service", target: "worker", state: "RUNNING" },
    ],
    assertions: [{ id: "steady", predicate: "demo.true", parameters: null, mode: "always" }],
  });
  await assert.rejects(session.simulation.run(), { code: "INVALID_SERVICE_TRANSITION" });
  assert.equal(session.simulation.status, "FAILED");
  assert.equal(session.results()[0]?.status, "INCOMPLETE");
});
