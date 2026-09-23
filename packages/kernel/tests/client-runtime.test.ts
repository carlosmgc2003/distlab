import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DeterministicClientRuntime, DeterministicServiceRuntime, ExecutionHistory, HeadlessSimulationFactory } from "@distlab/kernel";
import { duration, simulationTime, throwSimulationError } from "@distlab/contracts/kernel";
import type { RunInputs } from "@distlab/contracts/kernel";
import type { ClientContext, ClientDefinition, MessageBus, ServiceDefinition } from "@distlab/contracts";
import { createGolden02, golden02Result } from "../examples/golden-02.ts";

const inputs: RunInputs = { contractVersion: 1, modelVersions: { client: "1", service: "1" }, architecture: {}, scenario: {},
  configuration: { startTime: simulationTime(0), historyLimit: 1000,
    visibility: { defaultMode: "visible", byType: {}, summaryFields: {} }, models: {} }, seed: "client-test" };
const events: MessageBus = { publish: () => throwSimulationError("INVALID_MESSAGE_OPERATION") };
const service = (endpoints: ServiceDefinition["endpoints"]): ServiceDefinition =>
  ({ id: "service", version: "1", endpoints, consumers: {}, background: {} });
const client = (actions: ClientDefinition["actions"], callbacks: ClientDefinition["callbacks"] = {}, initialState: ClientDefinition["initialState"] = {}): ClientDefinition =>
  ({ id: "client", version: "1", actions, callbacks, initialState });

test("action, callback, logs, detached state and root/child correlation", async () => {
  let runtime!: DeterministicClientRuntime;
  const input = { order: "o1" };
  const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
    { source: "client", target: "service" }, { source: "service", target: "client" },
  ] } }).createSimulation(inputs, setup => {
    new DeterministicServiceRuntime({ id: "service", version: "1", setup, resolve: () => service({
      place: function* (body, ctx) {
        const result = yield ctx.http.request({ target: "client", endpoint: "notice", body });
        return { status: "ok", body: result as never };
      },
    }), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    runtime = new DeterministicClientRuntime({ id: "client", version: "1", setup, scenarioEventType: "scenario.action",
      resolve: () => client({ place: function* (data, ctx) {
        ctx.state.set("pending", data);
        ctx.log.write("info", "sending", data);
        return (yield ctx.http.request({ target: "service", endpoint: "place", body: data })) as never;
      } }, { notice: (body, ctx) => {
        ctx.state.set("notice", body);
        return { status: "ok", body: "received" };
      } }, { pending: null }), activeOwner: () => sim.activeTaskOwner });
    setup.registerHandler("scenario.action", "client", (event, ctx) => runtime.dispatch(event, ctx, controller => controller.start("a1", "place", input)));
    setup.schedule({ time: simulationTime(0), type: "service.service.lifecycle", payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: "scenario.action", payload: null });
  });
  await sim.run();
  input.order = "changed";
  const view = runtime.inspect();
  assert.equal((view.state.notice as { order: string }).order, "o1");
  assert.equal(view.actions[0]?.status, "COMPLETED");
  assert.equal(Object.isFrozen(view.state), true);
  assert.equal(Object.isFrozen(view.actions[0]), true);
  assert.deepEqual(view.callbacks, []);
  assert.equal(sim.history.query({ type: "client.callback.completed" }).length, 1);
  assert.equal(sim.history.query({ type: "runtime.log" }).length, 1);
  const root = sim.history.query({ type: "client.action.started" })[0]!;
  const request = sim.history.query({ type: "network.request.sent" })[0]!;
  assert.equal(request.traceId, root.traceId);
  assert.equal(request.parentSpanId, root.spanId);
});

test("shared log schema works with a lone client and client-first construction", async () => {
  for (const withService of [false, true]) {
    let runtime!: DeterministicClientRuntime;
    const sim = new HeadlessSimulationFactory({ network: { targets: ["client", ...(withService ? ["service"] : [])], links: [] } })
      .createSimulation(inputs, setup => {
        runtime = new DeterministicClientRuntime({ id: "client", version: "1", setup, scenarioEventType: "scenario.action",
          resolve: () => client({ log: (_body, ctx) => { ctx.log.write("info", "client only"); return null; } }),
          activeOwner: () => sim.activeTaskOwner });
        if (withService) new DeterministicServiceRuntime({ id: "service", version: "1", setup,
          resolve: () => service({}), taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
        setup.registerHandler("scenario.action", "client", (event, ctx) => runtime.dispatch(event, ctx, controller => controller.start("log", "log", null)));
        setup.schedule({ time: simulationTime(0), type: "scenario.action", payload: null });
      });
    await sim.run();
    assert.equal(sim.history.query({ type: "runtime.log" }).length, 1);
  }
});

test("lost response leaves server effects distinct from an explicit bounded retry", async () => {
  let runtime!: DeterministicClientRuntime;
  let effects = 0;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [
    { source: "client", target: "service", policy: { timeout: duration(2) } },
  ], faults: { evaluate(probe) { return { ruleIds: [], extraDelay: duration(0), drop: probe.point === "network.response",
    additionalCopies: 0, copySpacing: duration(0), fail: false }; } } } }).createSimulation(inputs, setup => {
    new DeterministicServiceRuntime({ id: "service", version: "1", setup,
      resolve: () => service({ place: body => { effects++; return { status: "ok", body }; } }),
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    runtime = new DeterministicClientRuntime({ id: "client", version: "1", setup, scenarioEventType: "scenario.action",
      resolve: () => client({ place: function* (data, ctx) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try { return (yield ctx.http.request({ target: "service", endpoint: "place", body: data })) as never; }
          catch (error) {
            if ((error as { code: string }).code !== "NETWORK_TIMEOUT" || attempt === 2) throw error;
            yield ctx.clock.sleep(duration(3));
          }
        }
        return null;
      } }), activeOwner: () => sim.activeTaskOwner });
    setup.registerHandler("scenario.action", "client", (event, ctx) => runtime.dispatch(event, ctx, controller => controller.start("a1", "place", { key: "k1" })));
    setup.schedule({ time: simulationTime(0), type: "service.service.lifecycle", payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: "scenario.action", payload: null });
  });
  await sim.run();
  assert.equal(effects, 2);
  assert.equal(runtime.inspect().actions[0]?.code, "NETWORK_TIMEOUT");
  assert.equal(JSON.stringify(sim.history.query({ type: "network.request.sent" }).map(x => (x.data as { body: unknown }).body)), JSON.stringify([{ key: "k1" }, { key: "k1" }]));
  const requests = sim.history.query({ type: "network.request.sent" });
  assert.equal(requests[0]?.traceId, requests[1]?.traceId);
  assert.notEqual(requests[0]?.spanId, requests[1]?.spanId);
  assert.equal(requests[0]?.parentSpanId, requests[1]?.parentSpanId);
});

test("concurrent state follows scheduler order and reset recreates history and capabilities", async () => {
  let runtime!: DeterministicClientRuntime;
  let stale!: ClientContext;
  const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [] } }).createSimulation(inputs, setup => {
    new DeterministicServiceRuntime({ id: "service", version: "1", setup, resolve: () => service({}),
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    runtime = new DeterministicClientRuntime({ id: "client", version: "1", setup, scenarioEventType: "scenario.action",
      resolve: () => client({ write: function* (data, ctx) { if (!stale) stale = ctx; yield ctx.clock.sleep(duration(data as number)); ctx.state.set("last", data); return data; } }, {}, { last: 0 }),
      activeOwner: () => sim.activeTaskOwner });
    setup.registerHandler("scenario.action", "client", (event, ctx) => {
      const data = event.payload as { id: string; delay: number };
      runtime.dispatch(event, ctx, controller => controller.start(data.id, "write", data.delay));
    });
    setup.schedule({ time: simulationTime(0), type: "scenario.action", payload: { id: "slow", delay: 4 } });
    setup.schedule({ time: simulationTime(0), type: "scenario.action", payload: { id: "fast", delay: 1 } });
  });
  await sim.run();
  const first = sim.history.export();
  assert.equal(runtime.inspect().state.last, 4);
  await sim.reset();
  assert.equal(runtime.inspect().state.last, 0);
  await sim.run();
  assert.deepEqual(sim.history.export(), first);
  assert.throws(() => stale.state.set("last", 9), { code: "INVALID_OPERATION" });
});

test("invalid dispatch, native async and bad state seal the run", async () => {
  for (const mode of ["duplicate", "unknown", "async", "state", "return"] as const) {
    let runtime!: DeterministicClientRuntime;
    const sim = new HeadlessSimulationFactory({ network: { targets: ["client", "service"], links: [] } }).createSimulation(inputs, setup => {
      new DeterministicServiceRuntime({ id: "service", version: "1", setup, resolve: () => service({}),
        taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
      runtime = new DeterministicClientRuntime({ id: "client", version: "1", setup, scenarioEventType: "scenario.action",
        resolve: () => client({ work: (_data, ctx) => mode === "async" ? Promise.resolve(null) as never :
          mode === "state" ? (ctx.state.set("x", { bad: 1n } as never), null) :
          mode === "return" ? { bad: 1n } as never : null }), activeOwner: () => sim.activeTaskOwner });
      setup.registerHandler("scenario.action", "client", (event, ctx) => {
        runtime.dispatch(event, ctx, controller => {
          controller.start("a", mode === "unknown" ? "missing" : "work", null);
          if (mode === "duplicate") controller.start("a", "work", null);
        });
      });
      setup.schedule({ time: simulationTime(0), type: "scenario.action", payload: null });
    });
    await assert.rejects(sim.run(), { code: mode === "async" ? "UNCONTROLLED_ASYNC" : mode === "state" ? "INVALID_CLIENT_STATE" :
      mode === "return" ? "INVALID_OPERATION" : "INVALID_CLIENT_ACTION" });
  }
});

test("saved controller cannot start outside scenario dispatch", async () => {
  let runtime!: DeterministicClientRuntime;
  let controller!: Parameters<Parameters<DeterministicClientRuntime["dispatch"]>[2]>[0];
  const sim = new HeadlessSimulationFactory({ network: { targets: ["client"], links: [] } }).createSimulation(inputs, setup => {
    runtime = new DeterministicClientRuntime({ id: "client", version: "1", setup, scenarioEventType: "scenario.action",
      resolve: () => client({ work: () => null }), activeOwner: () => sim.activeTaskOwner });
    setup.registerHandler("scenario.action", "client", (event, ctx) => runtime.dispatch(event, ctx, value => { controller = value; }));
    setup.registerHandler("client.later", "client", () => controller.start("late", "work", null));
    setup.schedule({ time: simulationTime(0), type: "scenario.action", payload: null });
    setup.schedule({ time: simulationTime(1), type: "client.later", payload: null });
  });
  await assert.rejects(sim.run(), { code: "INVALID_CLIENT_ACTION" });
  assert.equal(sim.history.query({ type: "client.action.started" }).length, 0);
});

test("sink failure after service effect seals run without client completion", async () => {
  let effects = 0;
  const sim = new HeadlessSimulationFactory({ createHistory: options => {
    const history = new ExecutionHistory(options);
    const record = history.record.bind(history);
    history.record = input => input.type === "runtime.log" ? throwSimulationError("HISTORY_LIMIT_EXCEEDED") : record(input);
    return history;
  }, network: { targets: ["client", "service"], links: [{ source: "client", target: "service" }] } }).createSimulation(inputs, setup => {
    new DeterministicServiceRuntime({ id: "service", version: "1", setup,
      resolve: () => service({ commit: () => { effects++; return { status: "ok", body: true }; } }),
      taskLifecycle: () => sim.taskLifecycle, activeOwner: () => sim.activeTaskOwner, events });
    const runtime = new DeterministicClientRuntime({ id: "client", version: "1", setup, scenarioEventType: "scenario.action",
      resolve: () => client({ commit: function* (_data, ctx) {
        const result = yield ctx.http.request({ target: "service", endpoint: "commit", body: null });
        try { ctx.log.write("info", "committed"); } catch { /* terminal latch wins */ }
        return result as never;
      } }), activeOwner: () => sim.activeTaskOwner });
    setup.registerHandler("scenario.action", "client", (event, ctx) => runtime.dispatch(event, ctx, controller => controller.start("a", "commit", null)));
    setup.schedule({ time: simulationTime(0), type: "service.service.lifecycle", payload: { next: "RUNNING" } });
    setup.schedule({ time: simulationTime(1), type: "scenario.action", payload: null });
  });
  await assert.rejects(sim.run(), { code: "HISTORY_LIMIT_EXCEEDED" });
  assert.equal(effects, 1);
  assert.equal(sim.history.query({ type: "client.action.completed" }).length, 0);
});

test("golden 02 is reproducible and executable headlessly", async () => {
  const fixture = createGolden02();
  await fixture.simulation.run();
  const first = golden02Result(fixture);
  const fresh = createGolden02();
  await fresh.simulation.run();
  assert.deepEqual(golden02Result(fresh), first);
  await fixture.simulation.reset();
  await fixture.simulation.run();
  assert.deepEqual(golden02Result(fixture), first);
  const expected = JSON.parse(readFileSync(new URL("../examples/golden-02.expected.json", import.meta.url), "utf8"));
  assert.equal(first.digest, expected.digest);
  assert.equal(JSON.stringify(first.state), JSON.stringify(expected.state));
  assert.equal(first.history.observations.length, expected.observationCount);
  const script = fileURLToPath(new URL("../examples/golden-02.ts", import.meta.url));
  const cli = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8" }));
  assert.equal(cli.digest, first.digest);
});
