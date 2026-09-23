import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGolden05, golden05Result } from "../examples/golden-05.ts";
import { createGolden07, golden07Result } from "../examples/golden-07.ts";

test("golden 05 duplicates one reservation through a fault rule and replays identically", async () => {
  const fixture = createGolden05(), fresh = createGolden05();
  await fixture.simulation.run(); await fresh.simulation.run();
  const result = golden05Result(fixture);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.state.deliveries.length, 2);
  assert.equal(new Set(result.state.deliveries).size, 2);
  assert.equal(result.history.observations.filter(x => x.type === "fault.effect.selected").length, 1);
  assert.equal(result.history.observations.filter(x => x.type === "message.delivered").length, 2);
  const expected = JSON.parse(readFileSync(new URL("../examples/golden-05.expected.json", import.meta.url), "utf8"));
  assert.equal(result.digest, expected.digest);
  assert.equal(JSON.stringify(result.state), JSON.stringify(expected.state));
  assert.equal(result.history.observations.length, expected.observationCount);
  assert.deepEqual(golden05Result(fresh), result);
  await fixture.simulation.reset(); await fixture.simulation.run();
  assert.deepEqual(golden05Result(fixture), result);
});

test("golden 07 preserves processor effect while a fault drops its reply", async () => {
  const fixture = createGolden07(), fresh = createGolden07();
  await fixture.simulation.run(); await fresh.simulation.run();
  const result = golden07Result(fixture);
  assert.equal(result.status, "COMPLETED");
  assert.equal(JSON.stringify(result.state), JSON.stringify({ processorEffects: 1, callerOutcome: "NETWORK_TIMEOUT" }));
  const types = result.history.observations.map(x => x.type);
  assert.equal(types.includes("network.request.delivered"), true);
  assert.equal(types.includes("network.response.sent"), true);
  assert.equal(types.includes("network.response.dropped"), true);
  assert.equal(types.includes("network.response.received"), false);
  assert.equal(types.includes("network.request.timedout"), true);
  assert.equal(types.includes("fault.effect.selected"), true);
  const matched = result.history.observations.find(x => x.type === "fault.rule.matched");
  assert.equal(JSON.stringify((matched?.data as { probe: unknown }).probe), JSON.stringify({
    point: "network.response", subjectId: (matched?.data as { probe: { subjectId: string } }).probe.subjectId,
    source: "processor", target: "payments", name: "authorize",
  }));
  const expected = JSON.parse(readFileSync(new URL("../examples/golden-07.expected.json", import.meta.url), "utf8"));
  assert.equal(result.digest, expected.digest);
  assert.equal(JSON.stringify(result.state), JSON.stringify(expected.state));
  assert.equal(result.history.observations.length, expected.observationCount);
  assert.deepEqual(golden07Result(fresh), result);
  await fixture.simulation.reset(); await fixture.simulation.run();
  assert.deepEqual(golden07Result(fixture), result);
});

test("golden 05 and 07 run as standalone CLIs", () => {
  for (const number of ["05", "07"]) {
    const script = fileURLToPath(new URL("../examples/golden-" + number + ".ts", import.meta.url));
    const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8" }));
    const expected = JSON.parse(readFileSync(new URL("../examples/golden-" + number + ".expected.json", import.meta.url), "utf8"));
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.digest, expected.digest);
    assert.equal(result.history.terminalFailure, undefined);
  }
});
