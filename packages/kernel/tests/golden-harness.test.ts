import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { goldenScenarioIds, loadGolden } from "../examples/harness.ts";

test("golden harness loads, steps, pauses, resets, and repeats every consolidated scenario", async () => {
  assert.equal(goldenScenarioIds.includes("03" as never), false);
  assert.throws(() => loadGolden("03"), /Unknown golden scenario 03/);
  for (const id of goldenScenarioIds) {
    const continuous = loadGolden(id);
    const stepped = loadGolden(id);
    const bounded = loadGolden(id);
    const fresh = loadGolden(id);
    assert.equal(continuous.simulation.status, fresh.simulation.status);
    assert.equal(continuous.results().length, 0);
    const paused = continuous.run({ maxEvents: 1 });
    const result = await paused;
    assert.equal(result.reason, "EVENT_LIMIT");
    assert.equal(result.status, "PAUSED");
    const yielding = continuous.run({ maxEventsPerYield: 1 });
    continuous.pause();
    assert.equal((await yielding).reason, "PAUSE_REQUESTED");
    while (continuous.simulation.status !== "COMPLETED") await continuous.run();
    while (stepped.simulation.status !== "COMPLETED") await stepped.step();
    while (bounded.simulation.status !== "COMPLETED") await bounded.run({ maxEvents: 1, maxEventsPerYield: 1 });
    await fresh.run({ maxEventsPerYield: 1 });
    const finished = continuous.inspect();
    assert.equal(finished.status, "COMPLETED");
    assert.deepEqual(stepped.inspect(), finished);
    assert.deepEqual(bounded.inspect(), finished);
    assert.deepEqual(fresh.inspect(), finished);
    const expected = JSON.parse(readFileSync(new URL(`../examples/golden-${id}.expected.json`, import.meta.url), "utf8")) as { digest: string };
    assert.equal(finished.digest, expected.digest);
    await continuous.reset();
    assert.equal(continuous.simulation.status, "READY");
    const finishedCount = (finished.history as { observations: readonly unknown[] }).observations.length;
    assert.ok(continuous.simulation.history.export().observations.length < finishedCount);
    await continuous.run();
    assert.deepEqual(continuous.inspect(), finished);
  }
});

test("golden harness CLI prints the checked-in export", () => {
  const script = fileURLToPath(new URL("../examples/harness.ts", import.meta.url));
  for (const id of goldenScenarioIds) {
    const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", script, id], { encoding: "utf8" })) as { status: string; digest: string; history: { terminalFailure?: unknown } };
    const expected = JSON.parse(readFileSync(new URL(`../examples/golden-${id}.expected.json`, import.meta.url), "utf8")) as { digest: string };
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.digest, expected.digest);
    assert.equal(result.history.terminalFailure, undefined);
  }
});
