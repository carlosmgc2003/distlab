import assert from "node:assert/strict";
import test from "node:test";
import { duration, ErrorCodes, simulationTime, type ObservationInput, type ScheduledEvent } from "@distlab/contracts/kernel";
import { DeterministicScheduler, DeterministicVirtualClock } from "../dist/index.js";

function fixture(start = 0) {
  const observations: ObservationInput[] = [];
  const sink = { record(input: ObservationInput) { observations.push(input); return input as never; } };
  let current = simulationTime(start);
  const scheduler = new DeterministicScheduler({ runId: "run:test", clock: { now: () => current },
    handlers: new Map([["local", "worker"], ["wake", "simulation"]]), observations: sink });
  const clock = new DeterministicVirtualClock({ startTime: current, scheduler, observations: sink });
  return { scheduler, clock, observations, setTime(value: number) { current = simulationTime(value); } };
}
const code = (expected: string) => (error: unknown) => (error as { code: string }).code === expected;

test("heap ordering, cancellation, snapshots, and stable allocation", () => {
  const { scheduler, observations } = fixture();
  const a = scheduler.schedule({ time: simulationTime(9), type: "local", payload: { nested: [1] } });
  const b = scheduler.schedule({ time: simulationTime(4), type: "local", payload: null });
  const c = scheduler.schedule({ time: simulationTime(9), type: "local", payload: null });
  assert.equal(scheduler.peek()?.id, b.eventId);
  assert.equal(scheduler.cancel(a.eventId), true);
  assert.equal(scheduler.cancel(a.eventId), false);
  assert.deepEqual(scheduler.pending().map(e => e.id), [b.eventId, c.eventId]);
  assert.equal(scheduler.takeNext()?.id, b.eventId);
  assert.equal(scheduler.takeNext()?.id, c.eventId);
  assert.equal(scheduler.takeNext(), undefined);
  assert.deepEqual(observations.map(o => o.type), ["scheduler.event.scheduled", "scheduler.event.scheduled", "scheduler.event.scheduled", "scheduler.event.cancelled", "scheduler.event.dispatched", "scheduler.event.dispatched"]);
});

test("invalid drafts, immutable copies, restore and stale handles", () => {
  const { scheduler } = fixture();
  const input = { time: simulationTime(3), type: "local", payload: { nested: [1] } };
  const handle = scheduler.schedule(input);
  input.payload.nested[0] = 8;
  assert.equal(((scheduler.peek()?.payload as { nested: number[] }).nested)[0], 1);
  let invoked = false;
  const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => scheduler.schedule({ time: simulationTime(3), type: "local", payload: accessor }), code(ErrorCodes.INVALID_EVENT_PAYLOAD));
  assert.equal(invoked, false);
  const state = scheduler.exportState();
  const restored = fixture().scheduler;
  restored.restore(JSON.parse(JSON.stringify(state)));
  assert.equal(JSON.stringify(restored.takeNext()), JSON.stringify(scheduler.takeNext()));
  assert.equal(restored.schedule({ time: simulationTime(3), type: "local", payload: null }).eventId, "event:run:test:1");
  scheduler.reset();
  assert.throws(() => handle.cancel(), code(ErrorCodes.STALE_CAPABILITY));
  assert.equal(scheduler.schedule(input).eventId, handle.eventId);
  assert.throws(() => restored.restore({ ...state, nextSequence: 0 }), code(ErrorCodes.INVALID_SCHEDULER_STATE));
});

test("clock arithmetic, observation order and bound capabilities", () => {
  const { scheduler, clock, observations } = fixture(100);
  const owner = clock.forOwner("worker", new Set(["local"]));
  const handle = owner.schedule(duration(0), "local", {});
  assert.equal(handle.dueTime, 100);
  assert.throws(() => owner.schedule(duration(0), "wake", {}), code(ErrorCodes.INVALID_EVENT_TYPE));
  assert.throws(() => clock.sleep(duration(0)), code(ErrorCodes.NO_ACTIVE_TASK));
  assert.throws(() => clock.schedule(duration(Number.MAX_SAFE_INTEGER), "local", {}), code(ErrorCodes.TIME_OVERFLOW));
  assert.throws(() => clock.advanceTo(simulationTime(99)), code(ErrorCodes.CLOCK_REWIND));
  assert.equal(clock.now(), 100);
  clock.advanceTo(simulationTime(125), handle.eventId);
  assert.equal(observations.at(-1)?.type, "clock.advanced");
  assert.equal(scheduler.size(), 1);
  clock.reset(); scheduler.reset();
  assert.throws(() => owner.now(), code(ErrorCodes.STALE_CAPABILITY));
  assert.throws(() => handle.cancel(), code(ErrorCodes.STALE_CAPABILITY));
});

test("controlled wake delegation preserves same-time sequence and observation order", () => {
  const observations: ObservationInput[] = [];
  const sink = { record(input: ObservationInput) { observations.push(input); return input as never; } };
  let clock!: DeterministicVirtualClock;
  const scheduler = new DeterministicScheduler({ runId: "run:test", clock: { now: () => clock.now() },
    handlers: new Map([["wake", "simulation"]]), observations: sink });
  let active = true;
  let count = 0;
  clock = new DeterministicVirtualClock({ startTime: simulationTime(100), scheduler, observations: sink,
    sleep: { active: () => active, scheduleWake(dueTime) {
      const handle = scheduler.schedule({ time: dueTime, type: "wake", payload: { task: count } });
      return { operation: { operationId: `operation:${count++}` }, handle, taskId: `task:${count}` };
    } } });
  const first = clock.sleep(duration(0));
  const second = clock.sleep(duration(0));
  assert.equal(first.operationId, "operation:0");
  assert.equal(second.operationId, "operation:1");
  assert.deepEqual(scheduler.pending().map(e => e.sequence), [0, 1]);
  assert.deepEqual(observations.map(o => o.type), ["scheduler.event.scheduled", "clock.sleep.scheduled", "scheduler.event.scheduled", "clock.sleep.scheduled"]);
  const wake = scheduler.takeNext()!;
  clock.advanceTo(wake.time, wake.id);
  clock.resumeSleep(wake.id, "task:1");
  assert.equal(observations.at(-1)?.type, "clock.sleep.resumed");
  active = false;
  assert.throws(() => clock.sleep(duration(0)), code(ErrorCodes.NO_ACTIVE_TASK));
});

test("randomized command logs match a sorted reference queue and replay", () => {
  function replay() {
    const { scheduler } = fixture();
    const reference: ScheduledEvent[] = [];
    let seed = 12345;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const output: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const action = next() % 4;
      if (action < 2) {
        const time = simulationTime(next() % 50);
        const handle = scheduler.schedule({ time, type: "local", payload: { i } });
        reference.push({ id: handle.eventId, sequence: Number(handle.eventId.split(":").at(-1)), time, type: "local", payload: { i } });
      } else if (action === 2 && reference.length) {
        const index = next() % reference.length;
        assert.equal(scheduler.cancel(reference[index]!.id), true);
        reference.splice(index, 1);
      } else {
        reference.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
        assert.equal(scheduler.takeNext()?.id, reference.shift()?.id);
      }
      reference.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
      assert.equal(scheduler.peek()?.id, reference[0]?.id);
      assert.equal(scheduler.size(), reference.length);
    }
    while (scheduler.size()) output.push(scheduler.takeNext()!.id);
    return output;
  }
  assert.deepEqual(replay(), replay());
});
