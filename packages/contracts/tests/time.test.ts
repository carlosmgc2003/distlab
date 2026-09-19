import assert from "node:assert/strict";
import { test } from "node:test";
import { duration, ErrorCodes, simulationTime } from "../dist/index.js";

test("simulationTime accepts zero and typical values", () => {
  assert.equal(simulationTime(0), 0);
  assert.equal(simulationTime(100), 100);
  assert.equal(simulationTime(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});

test("simulationTime rejects invalid values", () => {
  assert.throws(() => simulationTime(-1), {
    code: ErrorCodes.INVALID_SIMULATION_TIME,
  });
  assert.throws(() => simulationTime(1.5), {
    code: ErrorCodes.INVALID_SIMULATION_TIME,
  });
  assert.throws(() => simulationTime(Number.POSITIVE_INFINITY), {
    code: ErrorCodes.INVALID_SIMULATION_TIME,
  });
  assert.throws(() => simulationTime(Number.NaN), {
    code: ErrorCodes.INVALID_SIMULATION_TIME,
  });
  assert.throws(() => simulationTime(-0), {
    code: ErrorCodes.INVALID_SIMULATION_TIME,
  });
});

test("duration accepts zero and typical values", () => {
  assert.equal(duration(0), 0);
  assert.equal(duration(2_000), 2_000);
});

test("duration rejects invalid values", () => {
  assert.throws(() => duration(-1), { code: ErrorCodes.INVALID_DURATION });
  assert.throws(() => duration(0.5), { code: ErrorCodes.INVALID_DURATION });
});
