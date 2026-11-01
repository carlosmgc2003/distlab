import assert from "node:assert/strict";
import test from "node:test";
import type { Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { activityAt, activityChanges, activityOf } from "../src/activity.ts";
import { flightSteps } from "../src/flight.ts";
import { scenarios } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import type { MovementEdge } from "../src/records.ts";

const edges: readonly MovementEdge[] = [
  { id: "request:customer-app:orders:0", source: "customer-app", target: "orders", relationship: "request" },
  { id: "request:payments:payment-processor:1", source: "payments", target: "payment-processor", relationship: "request" },
  { id: "subscription:OrderCreated:payments:2", source: "OrderCreated", target: "payments", relationship: "subscription" },
  { id: "publication:orders:OrderCreated", source: "orders", target: "OrderCreated", relationship: "publication" },
];

let sequence = 0;
function record(type: string, source: string, target: string | undefined, data: Observation["data"], time = 0): Observation {
  sequence += 1;
  return {
    schemaVersion: 1, id: `o${sequence}`, time: simulationTime(time), sequence, type, source,
    ...(target !== undefined ? { target } : {}), data,
  } as Observation;
}

async function run(id: string): Promise<RuntimeProjectionSet> {
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  const choice = scenarios.find(item => item.id === id)!;
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: choice.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const last = events.filter(event => event.type === "projection.updated").at(-1);
  assert.ok(last?.projection);
  return last.projection;
}

/** The activity label of each component at the step with this headline and origin. */
function labelsAt(observations: readonly Observation[], headline: string, from: string): Record<string, string> {
  const step = flightSteps(observations, edges).find(item => item.headline === headline && item.from === from);
  assert.ok(step, `${headline} from ${from}`);
  const activity = activityAt(observations, step.observationId);
  return Object.fromEntries(["customer-app", "orders", "payments", "payment-processor"].map(id => [id, activityOf(activity, id).label]));
}

test("the lost-response lesson: who is waiting, who is processing, and when the wait ends", async () => {
  const { observations } = (await run("response-lost")).history;
  // Customer App sends: it waits with its stored deadline, and Orders has not received anything yet.
  assert.deepEqual(labelsAt(observations, "Request sent", "customer-app"), {
    "customer-app": "Waiting · deadline t=1000", orders: "Idle", payments: "Idle", "payment-processor": "Idle",
  });
  // Orders receives the request: it is processing, and the caller still waits.
  assert.deepEqual(labelsAt(observations, "Request delivered", "customer-app"), {
    "customer-app": "Waiting · deadline t=1000", orders: "Processing", payments: "Idle", "payment-processor": "Idle",
  });
  // Orders has answered: it is idle, while the response is still in transit to the caller.
  assert.equal(labelsAt(observations, "Response sent", "orders").orders, "Idle");
  assert.equal(labelsAt(observations, "Response sent", "orders")["customer-app"], "Waiting · deadline t=1000");
  // The caller has its answer.
  assert.equal(labelsAt(observations, "Response received", "orders")["customer-app"], "Idle");
  // The processor's response is dropped: Payments has recorded nothing, so it still waits until t=1025.
  const dropped = labelsAt(observations, "Response dropped", "payment-processor");
  assert.equal(dropped.payments, "Waiting · deadline t=1025");
  assert.equal(dropped["payment-processor"], "Idle");
  // The deadline passes: Payments leaves waiting with a timed-out cue, still handling its delivery.
  const timeout = flightSteps(observations, edges).find(step => step.leg === "timeout")!;
  const payments = activityOf(activityAt(observations, timeout.observationId), "payments");
  assert.equal(payments.state, "processing");
  assert.deepEqual(payments.waits, []);
  assert.deepEqual(payments.timedOut, { target: "payment-processor", time: 1025 });
  assert.match(payments.description, /timed out at virtual time 1025/);
  assert.match(payments.description, /unacknowledged message delivery/);
  // At the end of the run everyone is idle.
  const last = flightSteps(observations, edges).at(-1)!;
  assert.ok([...activityAt(observations, last.observationId).values()].every(item => item.state === "idle"));
});

test("activity reads only records at or before the cursor", async () => {
  const { observations } = (await run("response-lost")).history;
  const steps = flightSteps(observations, edges);
  for (const step of steps) {
    const cut = observations.filter(item => item.sequence <= step.sequence);
    assert.deepEqual(activityAt(observations, step.observationId), activityAt(cut, step.observationId),
      `records after #${step.sequence} change nothing at it`);
  }
  assert.equal(activityAt(observations, null).size, 0);
  assert.equal(activityAt(observations, "not-a-record").size, 0);
  assert.equal(activityOf(new Map(), "orders").state, "idle");
});

test("drop, timeout, retry, late response, and duplicate delivery", () => {
  const history = [
    record("network.request.sent", "client", "payments", { requestId: "r1", deadline: 100 }),
    record("network.request.dropped", "client", "payments", { requestId: "r1", reason: "fault" }, 5),
    record("network.request.timedout", "client", "payments", { requestId: "r1", deadline: 100 }, 100),
    record("network.request.sent", "client", "payments", { requestId: "r2", deadline: 300 }, 100),
    record("network.request.delivered", "client", "payments", { requestId: "r2", target: "payments" }, 110),
    record("database.transaction.begun", "payments", undefined, { transactionId: "t1" }, 110),
    record("network.request.timedout", "client", "payments", { requestId: "r2", deadline: 300 }, 300),
    record("database.transaction.committed", "payments", undefined, { transactionId: "t1" }, 310),
    record("network.response.sent", "payments", "client", { requestId: "r2", status: "ok" }, 310),
    record("network.response.received", "payments", "client", { requestId: "r2", status: "ok", late: true }, 320),
    record("message.delivered", "notifications", undefined, { deliveryId: "d1", consumer: "notifications" }, 330),
    record("message.delivered", "notifications", undefined, { deliveryId: "d2", consumer: "notifications" }, 340),
    record("message.ack.stale", "notifications", undefined, { deliveryId: "d1", outcome: "ack" }, 350),
    record("message.acknowledged", "notifications", undefined, { deliveryId: "d2", consumer: "notifications" }, 360),
  ];
  const at = (index: number, id: string) => activityOf(activityAt(history, history[index]!.id), id);
  // A dropped request does not end the wait: the caller recorded nothing.
  assert.equal(at(1, "client").label, "Waiting · deadline t=100");
  assert.equal(at(1, "payments").state, "idle");
  // The timeout ends it, with the cue on that record only.
  assert.equal(at(2, "client").state, "idle");
  assert.equal(at(2, "client").timedOut?.time, 100);
  // The retry is a new wait with its own deadline.
  assert.equal(at(3, "client").label, "Waiting · deadline t=300");
  assert.equal(at(3, "client").timedOut, undefined);
  // The receiver is processing the request and its transaction at once.
  assert.equal(at(5, "payments").state, "processing");
  assert.equal(at(5, "payments").work.length, 2);
  // After the caller's timeout the receiver is still processing: it does not know.
  assert.equal(at(6, "client").state, "idle");
  assert.equal(at(6, "payments").state, "processing");
  assert.equal(at(8, "payments").state, "idle");
  // A late response after a timeout opens nothing.
  assert.equal(at(9, "client").state, "idle");
  // A duplicate delivery is two pieces of work until each is acknowledged or found stale.
  assert.match(at(11, "notifications").description, /2 unacknowledged message deliveries/);
  assert.equal(at(12, "notifications").work.length, 1);
  assert.equal(at(13, "notifications").state, "idle");
});

test("a redacted payload opens and closes nothing", () => {
  const history = [
    record("network.request.sent", "client", "payments", { redacted: true }),
    record("network.request.delivered", "client", "payments", { redacted: true }),
    record("database.transaction.begun", "payments", undefined, { redacted: true }),
  ];
  const activity = activityAt(history, history[2]!.id);
  assert.equal(activityOf(activity, "client").state, "idle");
  assert.equal(activityOf(activity, "payments").state, "idle");
});

test("changes name only the components whose activity moved", () => {
  const history = [
    record("network.request.sent", "client", "payments", { requestId: "q", deadline: 40 }),
    record("network.request.delivered", "client", "payments", { requestId: "q", target: "payments" }, 10),
    record("network.request.timedout", "client", "payments", { requestId: "q", deadline: 40 }, 40),
  ];
  const at = (index: number) => activityAt(history, history[index]!.id);
  assert.deepEqual(activityChanges(new Map(), at(0)), ["client is waiting on payments with a recorded deadline at virtual time 40."]);
  assert.deepEqual(activityChanges(at(0), at(1)), ["payments is processing a delivered request."]);
  assert.deepEqual(activityChanges(at(1), at(2)), ["client is idle. Its request to payments timed out at virtual time 40."]);
  assert.deepEqual(activityChanges(at(1), at(1)), []);
});

test("the same lesson run twice derives identical activity at every cursor", async () => {
  for (const id of ["response-lost", "retry-unsafe", "outbox-unsafe-consumer", "cascade-breaker"]) {
    const derive = async () => {
      const { observations } = (await run(id)).history;
      return flightSteps(observations, edges).map(step => [...activityAt(observations, step.observationId).values()]);
    };
    assert.deepEqual(await derive(), await derive(), id);
  }
});
