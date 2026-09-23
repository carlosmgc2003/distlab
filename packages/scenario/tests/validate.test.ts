import { test } from "node:test";
import assert from "node:assert/strict";
import { DeterministicScenarioEngine, DiagnosticCodes, normalizeScenario } from "@distlab/scenario";
import { assessmentOf, baseScenario, catalogOf, engineFor, model, truePredicate } from "./support.ts";

const catalog = catalogOf([
  model({ model: "demo.service", kind: "service", endpoints: ["POST /work"], checks: { nonnegative: row => typeof (row as { n?: unknown }).n === "number" && (row as { n: number }).n >= 0 } }),
  model({ model: "demo.service", kind: "service", version: "2" }),
  model({ model: "demo.client", kind: "client", actions: ["checkout"] }),
  model({ model: "demo.external", kind: "external", operations: ["authorize"] }),
  model({ model: "demo.billing", kind: "service", consumers: ["OrderPlaced"] }),
]);
const assessment = assessmentOf([truePredicate]);
const codes = (input: unknown) => normalizeScenario(input as never, catalog, assessment).diagnostics.map(item => `${item.path} ${item.code}`);

test("normalization fills defaults and keeps declared order", () => {
  const normalized = normalizeScenario({
    version: 1, name: "named", seed: "  seed  ",
    architecture: {
      components: [
        { id: "b", kind: "service", model: "demo.service", version: "1" },
        { id: "a", kind: "client", model: "demo.client", version: "1", configuration: { region: "south" } },
      ],
      links: [{ source: "a", target: "b" }],
      destinations: [{ id: "events", kind: "topic" }],
    },
    faults: [{ id: "lag", point: "network.request", source: "a", target: "b", name: "POST /work", from: 0, effect: { kind: "delay", duration: 5 } }],
  } as never, catalog, assessment);
  assert.deepEqual(normalized.diagnostics, []);
  const scenario = normalized.scenario;
  assert.ok(scenario);
  assert.equal(scenario.startTime, 0);
  assert.equal(scenario.seed, "seed");
  assert.deepEqual(scenario.architecture.components.map(component => component.id), ["b", "a"]);
  assert.equal(scenario.architecture.components[0]?.configuration && JSON.stringify(scenario.architecture.components[0].configuration), "{}");
  assert.equal(scenario.architecture.links[0]?.policy.timeout, 1000);
  assert.equal(scenario.architecture.links[0]?.policy.failureRate, 0);
  assert.equal(scenario.architecture.destinations[0]?.ackTimeout, 1000);
  assert.equal(scenario.architecture.destinations[0]?.capacity, 10000);
  assert.equal(scenario.faults[0]?.probability, 1);
  assert.equal(scenario.faults[0]?.maxApplications, 1);
  assert.equal(scenario.configuration.historyLimit, 100000);
  assert.equal(scenario.configuration.visibility.defaultMode, "visible");
  assert.deepEqual(scenario.actions, []);
});

test("diagnostics are sorted and invalid create does not instantiate behavior", () => {
  let instantiated = 0;
  let evaluated = 0;
  const watched = catalogOf([model({
    model: "demo.service", kind: "service", instantiate: () => { instantiated += 1; return { id: "a", version: "1", endpoints: {}, consumers: {}, background: {} }; },
  })]);
  const judging = assessmentOf([truePredicate]);
  const original = judging.find;
  judging.find = id => { evaluated += 1; return original(id); };
  const input = { version: 2, name: "", seed: " ", extra: true, architecture: { components: [] } };
  const engine = engineFor([]);
  const diagnostics = normalizeScenario(input as never, watched, judging).diagnostics;
  assert.deepEqual(diagnostics.map(item => item.path), ["/extra", "/name", "/seed", "/version"]);
  assert.deepEqual(diagnostics.map(item => item.code), [DiagnosticCodes.UNSUPPORTED, DiagnosticCodes.REQUIRED, DiagnosticCodes.SEED, DiagnosticCodes.VERSION]);
  assert.equal(instantiated, 0);
  assert.throws(() => new DeterministicScenarioEngine({ catalog: watched, assessment: judging }).create(input as never), (error: unknown) => {
    assert.equal((error as { code: string }).code, "INVALID_SCENARIO");
    assert.equal(JSON.stringify((error as { context: unknown }).context), JSON.stringify(diagnostics));
    return true;
  });
  assert.equal(instantiated, 0);
  assert.equal(evaluated, 0);
  assert.equal(engine.validate(baseScenario() as never).length, 0);
});

test("references, ownership, versions, times, and assertion modes are rejected", () => {
  const service = { id: "orders", kind: "service", model: "demo.service", version: "1", configuration: {} };
  const client = { id: "app", kind: "client", model: "demo.client", version: "1", configuration: {} };
  assert.ok(codes({ ...baseScenario(), architecture: { components: [{ ...service, model: "missing" }] } }).includes("/architecture/components/0/model UNKNOWN_MODEL"));
  assert.ok(codes({ ...baseScenario(), architecture: { components: [{ ...service, version: "9" }] } }).includes("/architecture/components/0/version VERSION"));
  assert.ok(codes({ ...baseScenario(), architecture: { components: [{ ...service, id: "app", kind: "client", model: "demo.service" }] } }).includes("/architecture/components/0/kind KIND"));
  assert.ok(codes({ ...baseScenario(), architecture: { components: [service, { ...service, id: "orders" }] } }).some(item => item.endsWith("DUPLICATE")));
  assert.ok(codes({ ...baseScenario(), startTime: 1, configuration: { startTime: 2 } }).filter(item => item.endsWith("START_TIME_MISMATCH")).length === 2);
  assert.ok(codes({
    ...baseScenario(), startTime: 10, architecture: { components: [service] },
    actions: [{ id: "early", at: 0, kind: "service", target: "orders", state: "RUNNING" }],
  }).includes("/actions/0/at BEFORE_START"));
  assert.ok(codes({
    ...baseScenario(), architecture: { components: [service] },
    actions: [{ id: "bad", at: -1, kind: "service", target: "orders", state: "RUNNING" }],
  }).includes("/actions/0/at TIME"));
  assert.ok(codes({
    ...baseScenario(), architecture: { components: [service] },
    actions: [{ id: "bad", at: 0, kind: "service", target: "orders", state: "SLEEPING" }],
  }).includes("/actions/0/state STATE"));
  assert.ok(codes({
    ...baseScenario(), assertions: [
      { id: "a", predicate: "missing", parameters: null, mode: "always", at: 1 },
      { id: "b", predicate: "demo.true", parameters: null, mode: "eventually" },
      { id: "c", predicate: "demo.true", parameters: null, mode: "at", deadline: 1 },
    ],
  }).join("\n").includes("UNKNOWN_PREDICATE") && codes({
    ...baseScenario(), assertions: [{ id: "a", predicate: "demo.true", parameters: null, mode: "always", at: 1 }],
  }).includes("/assertions/0 ASSERTION_TIMING"));
  assert.ok(codes({
    ...baseScenario(), architecture: { components: [client], databases: [{ owner: "app", tables: [], initial: {} }] },
  }).includes("/architecture/databases/0/owner OWNERSHIP"));
  assert.ok(codes({
    ...baseScenario(), architecture: { components: [service, client], links: [{ source: "app", target: "missing" }, { source: "app", target: "orders" }, { source: "app", target: "orders" }] },
  }).some(item => item.includes("UNKNOWN_COMPONENT")) && codes({
    ...baseScenario(), architecture: { components: [service, client], links: [{ source: "app", target: "orders" }, { source: "app", target: "orders" }] },
  }).some(item => item.endsWith("LINK")));
  assert.ok(codes({
    ...baseScenario(), architecture: {
      components: [service, { id: "billing", kind: "service", model: "demo.billing", version: "1", configuration: {} }],
      destinations: [{ id: "OrderPlaced", kind: "topic" }],
      subscriptions: [{ destination: "OrderPlaced", consumer: "orders" }],
    },
  }).some(item => item.endsWith("SUBSCRIPTION")));
  assert.ok(codes({
    ...baseScenario(), architecture: { components: [service, client] },
    faults: [{ id: "copy", point: "network.request", source: "app", target: "orders", from: 0, effect: { kind: "duplicate", additionalCopies: 1, spacing: 0 } }],
  }).some(item => item.endsWith("FAULT")));
  assert.ok(codes({
    ...baseScenario(), architecture: { components: [service] },
    actions: [{ id: "go", at: 1.5, kind: "client", target: "orders", action: "missing", data: Number.NaN }],
  }).some(item => item.endsWith("CANONICAL")));
});
