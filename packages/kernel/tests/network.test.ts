import { test } from "node:test";
import assert from "node:assert/strict";
import { ExecutionHistory, HeadlessSimulationFactory, SeededRandom } from "@distlab/kernel";
import { duration, simulationTime } from "@distlab/contracts/kernel";
import type { ControlledTask, RunInputs } from "@distlab/contracts/kernel";
import type { NetworkController, VirtualNetwork } from "@distlab/contracts";

const inputs: RunInputs = { contractVersion: 1, modelVersions: {}, architecture: {}, scenario: {}, configuration: {
  startTime: simulationTime(0), historyLimit: 1000, visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {},
}, seed: "network-test" };

test("scheduled request and response legs deliver a detached correlated reply", async () => {
  let client!: VirtualNetwork, controller!: NetworkController;
  const received: unknown[] = [], results: unknown[] = [];
  let flightSnapshot: readonly { readonly state: string }[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
    { source: "client", target: "service", policy: { requestLatency: duration(2), responseLatency: duration(3), timeout: duration(20) } },
  ] } }).createSimulation(inputs, setup => {
    client = setup.networkFor("client"); controller = setup.networkController();
    controller.register("service", { accept(id, request) { received.push(request); controller.reply(id, { status: "ok", body: { result: 42 } }); } });
    setup.registerHandler("start", "client", function* (): ControlledTask {
      const operation = client.request({ target: "service", endpoint: "GET /x", body: { a: 1 } });
      flightSnapshot = setup.networkInFlight();
      results.push(yield operation);
    });
    setup.schedule({ time: simulationTime(0), type: "start", payload: null });
  });
  assert.equal(received.length, 0);
  await sim.run();
  assert.equal(received.length, 1);
  assert.equal(JSON.stringify(results), JSON.stringify([{ status: "ok", body: { result: 42 } }]));
  const network = sim.history.all().filter(x => x.type.startsWith("network."));
  assert.deepEqual(network.map(x => [x.type, x.time]), [
    ["network.request.sent", 0], ["network.request.delivered", 2], ["network.response.sent", 2], ["network.response.received", 5],
  ]);
  assert.equal(new Set(network.map(x => x.traceId)).size, 1);
  assert.equal(new Set(network.map(x => x.spanId)).size, 1);
  assert.equal(Object.isFrozen(received[0]), true);
  assert.equal(Object.isFrozen(results[0]), true);
  assert.equal(flightSnapshot[0]?.state, "SENT");
  assert.equal(Object.isFrozen(flightSnapshot), true);
  assert.equal(Object.isFrozen(flightSnapshot[0]), true);
});

test("exact deadline wins, late receipt is inert, and duplicate replies are ignored", async () => {
  let client!: VirtualNetwork, controller!: NetworkController, pending = "";
  const outcomes: string[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
    { source: "client", target: "service", policy: { requestLatency: duration(1), responseLatency: duration(4), timeout: duration(5) } },
  ] } }).createSimulation(inputs, setup => {
    client = setup.networkFor("client"); controller = setup.networkController();
    controller.register("service", { accept(id) { pending = id; controller.reply(id, { status: "ok", body: "committed" }); } });
    setup.registerHandler("start", "client", function* (): ControlledTask {
      try { yield client.request({ target: "service", endpoint: "POST /x", body: null }); outcomes.push("success"); }
      catch (error) { outcomes.push((error as { code: string }).code); }
    });
    setup.registerHandler("late", "service", () => controller.reply(pending, { status: "ok", body: "duplicate" }));
    setup.schedule({ time: simulationTime(0), type: "start", payload: null });
    setup.schedule({ time: simulationTime(6), type: "late", payload: null });
  });
  await sim.run();
  assert.deepEqual(outcomes, ["NETWORK_TIMEOUT"]);
  assert.equal((sim.history.query({ type: "network.response.received" })[0]!.data as { late: boolean }).late, true);
  assert.equal(sim.history.query({ type: "network.response.sent" }).length, 1);
});

test("request loss, missing receiver and endpoint admission are distinct", async () => {
  for (const mode of ["loss", "missing", "endpoint"] as const) {
    let client!: VirtualNetwork, controller!: NetworkController;
    let outcome = "";
    const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
      { source: "client", target: "service", policy: { failureRate: mode === "loss" ? 1 : 0, timeout: duration(2) } },
    ] } }).createSimulation(inputs, setup => {
      client = setup.networkFor("client"); controller = setup.networkController();
      if (mode === "endpoint") controller.register("service", { admit: () => "ENDPOINT_NOT_FOUND", accept: () => assert.fail("not admitted") } as never);
      setup.registerHandler("start", "client", function* (): ControlledTask {
        try { const reply = yield client.request({ target: "service", endpoint: "missing", body: null }); outcome = (reply as { body: { code: string } }).body.code; }
        catch (error) { outcome = (error as { code: string }).code; }
      });
      setup.schedule({ time: simulationTime(0), type: "start", payload: null });
    });
    await sim.run();
    assert.equal(outcome, mode === "loss" ? "NETWORK_TIMEOUT" : mode === "missing" ? "TARGET_UNAVAILABLE" : "ENDPOINT_NOT_FOUND");
  }
});

test("response loss preserves remote effect, and reset reproduces IDs, draws and history", async () => {
  let client!: VirtualNetwork, controller!: NetworkController;
  let commits = 0;
  const failures: string[] = [];
  const probes: string[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
    { source: "client", target: "service", policy: { timeout: duration(3), jitter: duration(1), failureRate: 0.25 } },
  ], faults: { evaluate(probe) {
    probes.push(probe.point);
    return { ruleIds: [], extraDelay: duration(0), drop: probe.point === "network.response", additionalCopies: 0, copySpacing: duration(0), fail: false };
  } } } }).createSimulation(inputs, setup => {
    client = setup.networkFor("client"); controller = setup.networkController();
    controller.register("service", { accept(id) { commits++; controller.reply(id, { status: "ok", body: "done" }); } });
    setup.registerHandler("start", "client", function* (): ControlledTask {
      try { yield client.request({ target: "service", endpoint: "POST /commit", body: null }); }
      catch (error) { failures.push((error as { code: string }).code); }
    });
    setup.schedule({ time: simulationTime(0), type: "start", payload: null });
  });
  await sim.run();
  const first = sim.history.export();
  assert.equal(commits, 1);
  assert.deepEqual(failures, ["NETWORK_TIMEOUT"]);
  assert.deepEqual(probes, ["network.request", "network.response"]);
  assert.equal(sim.history.query({ type: "network.response.dropped" }).length, 1);
  const oldPort = client, oldController = controller;
  await sim.reset();
  assert.throws(() => oldPort.request({ target: "service", endpoint: "x", body: null }), { code: "STALE_CAPABILITY" });
  assert.throws(() => oldController.reply("unknown", { status: "ok", body: null }), { code: "STALE_CAPABILITY" });
  await sim.run();
  assert.deepEqual(sim.history.export(), first);
  assert.equal(commits, 2);
  assert.deepEqual(failures, ["NETWORK_TIMEOUT", "NETWORK_TIMEOUT"]);
});

test("malformed request and reply fail terminally", async () => {
  let client!: VirtualNetwork;
  const malformed = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
    { source: "client", target: "service" },
  ] } }).createSimulation(inputs, setup => {
    client = setup.networkFor("client");
    setup.registerHandler("start", "client", function* (): ControlledTask { yield client.request({ target: "service", endpoint: "", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "start", payload: null });
  });
  await assert.rejects(malformed.run(), { code: "INVALID_NETWORK_REQUEST" });
  assert.equal(malformed.history.export().terminalFailure?.code, "INVALID_NETWORK_REQUEST");
  let validPort!: VirtualNetwork, replyPort!: NetworkController;
  const badReply = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
    { source: "client", target: "service" },
  ] } }).createSimulation(inputs, setup => {
    validPort = setup.networkFor("client"); replyPort = setup.networkController();
    replyPort.register("service", { accept(id) { replyPort.reply(id, { status: "invalid", body: null } as never); } });
    setup.registerHandler("start", "client", function* (): ControlledTask { yield validPort.request({ target: "service", endpoint: "x", body: null }); });
    setup.schedule({ time: simulationTime(0), type: "start", payload: null });
  });
  await assert.rejects(badReply.run(), { code: "INVALID_NETWORK_REPLY" });
  assert.throws(() => new HeadlessSimulationFactory({ network: { targets: ["a", "b"], links: [
    { source: "a", target: "b", policy: { timeout: duration(0) } },
  ] } }).createSimulation(inputs, () => {}), { code: "INVALID_RUN_INPUT" });
});

test("jitter and loss are sampled in order once per leg", async () => {
  let client!: VirtualNetwork, controller!: NetworkController;
  const labels: string[] = [];
  const sim = new HeadlessSimulationFactory({
    createRandom: seed => {
      const seeded = new (class {
        readonly #random = new SeededRandom(seed);
        draw(label: string) { labels.push(label); return this.#random.draw(label); }
      })();
      return seeded;
    },
    network: { targets: ["client", "service"], links: [
      { source: "client", target: "service", policy: { jitter: duration(2), failureRate: 0.1 } },
    ] },
  }).createSimulation(inputs, setup => {
    client = setup.networkFor("client"); controller = setup.networkController();
    controller.register("service", { accept(id) { controller.reply(id, { status: "ok", body: null }); } });
    setup.registerHandler("start", "client", function* (): ControlledTask { try { yield client.request({ target: "service", endpoint: "x", body: null }); } catch {} });
    setup.schedule({ time: simulationTime(0), type: "start", payload: null });
  });
  await sim.run();
  assert.deepEqual(labels.slice(0, 2), ["network.request.jitter", "network.request.loss"]);
  if (labels.length > 2) assert.deepEqual(labels, ["network.request.jitter", "network.request.loss", "network.response.jitter", "network.response.loss"]);
});

test("client, service, external provider and callback cross scheduled network legs", async () => {
  let client!: VirtualNetwork, service!: VirtualNetwork, external!: VirtualNetwork, controller!: NetworkController;
  const order: string[] = [];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service", "external"], links: [
    { source: "client", target: "service" }, { source: "service", target: "external" }, { source: "external", target: "client" },
  ] } }).createSimulation(inputs, setup => {
    client = setup.networkFor("client"); service = setup.networkFor("service"); external = setup.networkFor("external");
    controller = setup.networkController();
    controller.register("service", { accept(id) { order.push("service-delivered"); setup.enqueueNetworkWork("service", "service.work", { id }); } });
    controller.register("external", { accept(id) { order.push("external-delivered"); setup.enqueueNetworkWork("external", "external.work", { id }); } });
    controller.register("client", { accept(id) { order.push("callback-delivered"); controller.reply(id, { status: "ok", body: null }); } });
    setup.registerHandler("client.start", "client", function* (): ControlledTask {
      order.push("client-sent"); yield client.request({ target: "service", endpoint: "POST /pay", body: null }); order.push("client-replied");
    });
    setup.registerHandler("service.work", "service", function* (event): ControlledTask {
      order.push("service-work"); yield service.request({ target: "external", endpoint: "POST /charge", body: null });
      controller.reply((event.payload as { id: string }).id, { status: "ok", body: null });
    });
    setup.registerHandler("external.work", "external", function* (event): ControlledTask {
      order.push("external-work"); controller.reply((event.payload as { id: string }).id, { status: "ok", body: null });
      yield external.request({ target: "client", endpoint: "POST /callback", body: null }); order.push("callback-ack");
    });
    setup.schedule({ time: simulationTime(0), type: "client.start", payload: null });
  });
  await sim.run();
  assert.deepEqual(order, ["client-sent", "service-delivered", "service-work", "external-delivered", "external-work", "callback-delivered", "client-replied", "callback-ack"]);
  const sent = sim.history.query({ type: "network.request.sent" });
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent.map(record => record.traceId)).size, 1);
  assert.equal(new Set(sent.map(record => record.spanId)).size, 3);
});

test("network sink failure seals the run instead of timing out", async () => {
  let caught = false;
  let remoteCommits = 0;
  const sim = new HeadlessSimulationFactory({
    createHistory: options => {
      const history = new ExecutionHistory(options);
      const record = history.record.bind(history);
      history.record = input => {
        if (input.type === "network.response.sent") throw Object.assign(new Error("HISTORY_LIMIT_EXCEEDED"), { code: "HISTORY_LIMIT_EXCEEDED", context: null });
        return record(input);
      };
      return history;
    },
    network: { targets: ["client", "service"], links: [{ source: "client", target: "service", policy: { timeout: duration(20) } }] },
  }).createSimulation(inputs, setup => {
    const client = setup.networkFor("client"), controller = setup.networkController();
    controller.register("service", { accept(id) { remoteCommits++; try { controller.reply(id, { status: "ok", body: null }); } catch { caught = true; } } });
    setup.registerHandler("start", "client", function* (): ControlledTask {
      yield client.request({ target: "service", endpoint: "x", body: null });
    });
    setup.schedule({ time: simulationTime(0), type: "start", payload: null });
  });
  await assert.rejects(sim.run(), { code: "HISTORY_LIMIT_EXCEEDED" });
  assert.equal(caught, true);
  assert.equal(remoteCommits, 1);
  const failure = sim.history.export().terminalFailure;
  assert.equal(failure?.code, "HISTORY_LIMIT_EXCEEDED");
  assert.equal(failure?.historyComplete, false);
  assert.equal((failure?.context as { rejectedObservationType: string }).rejectedObservationType, "network.response.sent");
  assert.equal(sim.history.query({ type: "network.request.timedout" }).length, 0);
  assert.equal(sim.history.query({ type: "simulation.event.failed" }).length, 0);
  assert.equal(sim.history.query({ type: "simulation.failed" }).length, 0);
  assert.equal(sim.history.query({ type: "simulation.completed" }).length, 0);
});
