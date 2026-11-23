import assert from "node:assert/strict";
import test from "node:test";
import type { Observation, RuntimeProjectionSet } from "@distlab/contracts";
import { simulationTime } from "@distlab/contracts";
import { flightBackground, flightInTransit, flightSteps } from "../src/flight.ts";
import type { FlightStep } from "../src/flight.ts";
import { playheadSteps, recordStep, travelsLink } from "../src/playhead-steps.ts";
import type { PlayheadStep, RecordStep } from "../src/playhead-steps.ts";
import { activityAt } from "../src/activity.ts";
import { storyMilestones } from "../src/story-timeline.ts";
import { mapArchitecture, movementEdges } from "../src/architecture-view.ts";
import { packagedMetadata, scenarios } from "../src/scenarios.ts";
import type { PackagedScenario } from "../src/scenarios.ts";
import { WorkerAdapter } from "../src/worker/adapter.ts";
import type { MovementEdge } from "../src/records.ts";
import { messages } from "../src/i18n/catalog.ts";
import { milestoneTypeList, movementOf } from "../src/records.ts";

const m = messages("en");
const es = messages("es");

interface Run {
  readonly lesson: PackagedScenario;
  readonly observations: readonly Observation[];
  readonly edges: readonly MovementEdge[];
}

async function run(lesson: PackagedScenario): Promise<Run> {
  const events: { type: string; projection?: RuntimeProjectionSet }[] = [];
  const adapter = new WorkerAdapter(event => events.push(event as { type: string; projection?: RuntimeProjectionSet }));
  await adapter.receive({ version: 1, requestId: "load", type: "load", scenario: lesson.scenario });
  await adapter.receive({ version: 1, requestId: "run", type: "run" });
  const projection = events.filter(event => event.type === "projection.updated").at(-1)?.projection;
  assert.ok(projection, `${lesson.id} publishes a projection`);
  const metadata = packagedMetadata(lesson);
  const graph = mapArchitecture(projection.architecture, metadata.architecture, metadata.name, m);
  return { lesson, observations: projection.history.observations, edges: movementEdges(graph.edges) };
}

let runs: Promise<readonly Run[]> | undefined;
/** Every packaged lesson, run once to its end and shared by the tests below. */
function packagedRuns(): Promise<readonly Run[]> {
  runs ??= Promise.all(scenarios.map(run));
  return runs;
}

async function lessonRun(id: string): Promise<Run> {
  const found = (await packagedRuns()).find(item => item.lesson.id === id);
  assert.ok(found, `${id} is a packaged lesson`);
  return found;
}

function observation(input: { id: string; sequence: number; type: string; source: string; data?: Observation["data"] }): Observation {
  return {
    schemaVersion: 1, id: input.id, time: simulationTime(0), sequence: input.sequence, type: input.type, source: input.source,
    ...(Object.hasOwn(input, "data") ? { data: input.data } : {}),
  } as Observation;
}

test("OT-STEPS-AC-1: for every packaged lesson the steps are the Story milestones, in the same order", async () => {
  for (const { lesson, observations, edges } of await packagedRuns()) {
    const steps = playheadSteps(observations, edges, m);
    const milestones = storyMilestones(observations, m);
    assert.deepEqual(steps.map(step => step.observationId), milestones.map(milestone => milestone.observation.id), lesson.id);
    assert.deepEqual(steps.map(step => step.sequence), milestones.map(milestone => milestone.observation.sequence), lesson.id);
    assert.deepEqual(steps.map(step => step.time), milestones.map(milestone => milestone.observation.time), lesson.id);
  }
});

test("OT-STEPS-AC-2: for every packaged lesson the steps that travel a link are the flight steps of the same run", async () => {
  for (const { lesson, observations, edges } of await packagedRuns()) {
    const flights = flightSteps(observations, edges, m);
    const steps = playheadSteps(observations, edges, m);
    assert.deepEqual(steps.filter(travelsLink), flights, lesson.id);
    // The same holds with display names, which only the narration reads.
    const names = new Map([["payments", "Payments service"]]);
    assert.deepEqual(playheadSteps(observations, edges, m, names).filter(travelsLink), flightSteps(observations, edges, m, names), lesson.id);
  }
});

test("OT-STEPS-AC-3: in retry-unsafe both commits of payments are steps that name payments", async () => {
  const { observations, edges } = await lessonRun("retry-unsafe");
  const steps = playheadSteps(observations, edges, m);
  // RFC 0002 P4: 19 milestones, of which Replay steps over 9 movements today.
  assert.equal(steps.length, 19);
  assert.equal(steps.filter(travelsLink).length, 9);
  const commits = steps.filter((step): step is RecordStep => !travelsLink(step) && step.recordKind === "commit");
  assert.equal(commits.length, 2);
  for (const commit of commits) {
    const stored = observations.find(item => item.id === commit.observationId);
    assert.equal(stored?.type, "database.transaction.committed");
    assert.equal(stored?.source, "payments");
    assert.equal(commit.component, "payments");
    assert.deepEqual(commit.nodeIds, ["payments"]);
    assert.equal(commit.headline, "Database transaction committed");
    assert.equal(commit.pattern, m.playback.pattern["database.transaction.committed"]);
  }
});

test("OT-STEPS-AC-4: building the steps does not change the observations, and is deterministic", async () => {
  for (const { lesson, observations, edges } of await packagedRuns()) {
    const before = JSON.stringify(observations);
    const first = playheadSteps(observations, edges, m);
    const second = playheadSteps(observations, edges, m);
    assert.equal(JSON.stringify(observations), before, lesson.id);
    assert.deepEqual(first, second, lesson.id);
  }
  // Two runs of the same lesson from the same inputs give the same steps.
  const lesson = scenarios.find(item => item.id === "retry-unsafe")!;
  const [a, b] = await Promise.all([run(lesson), run(lesson)]);
  assert.deepEqual(playheadSteps(a.observations, a.edges, m), playheadSteps(b.observations, b.edges, m));
});

test("OT-STEPS-AC-5: a step with a redacted or omitted payload states its visibility and nothing else", () => {
  const redacted = recordStep(observation({ id: "r", sequence: 1, type: "database.transaction.committed", source: "payments", data: { redacted: true } }), "commit", m);
  assert.deepEqual(redacted.facts, [{ label: "Stored payload", value: "Redacted; not shown" }]);
  assert.equal(redacted.headline, "Database transaction committed");
  const omitted = recordStep(observation({ id: "o", sequence: 2, type: "kv.changed", source: "cart" }), "kv", m);
  assert.deepEqual(omitted.facts, [{ label: "Stored payload", value: "Omitted; not shown" }]);
  // The same holds inside a list built from history.
  const steps = playheadSteps([
    observation({ id: "a", sequence: 1, type: "database.transaction.committed", source: "payments", data: { redacted: true } }),
    observation({ id: "b", sequence: 2, type: "runtime.log", source: "payments" }),
  ], [], m);
  assert.deepEqual(steps.map(step => step.facts), [
    [{ label: "Stored payload", value: "Redacted; not shown" }],
    [{ label: "Stored payload", value: "Omitted; not shown" }],
  ]);
});

test("a check result recorded by the simulation names no component", async () => {
  const { observations, edges } = await lessonRun("retry-unsafe");
  const checks = playheadSteps(observations, edges, m).filter((step): step is RecordStep => !travelsLink(step) && step.recordKind === "check");
  assert.ok(checks.length > 0);
  for (const check of checks) {
    assert.equal(check.component, undefined);
    assert.ok(!Object.hasOwn(check, "component"));
    assert.deepEqual(check.nodeIds, []);
  }
});

test("every milestone type has a pattern question in English and Spanish, and an unknown fault type uses the fallback", () => {
  for (const type of [...milestoneTypeList, "fault.applied"]) {
    for (const catalog of [m, es]) {
      const step = recordStep(observation({ id: "x", sequence: 1, type, source: "payments" }), "log", catalog);
      assert.notEqual(step.pattern, catalog.playback.patternFallback, `${type} has its own question`);
      // The questions added for milestones that travel no link end in a question mark.
      if (!movementOf(observation({ id: "x", sequence: 1, type, source: "payments" }))) assert.match(step.pattern, /\?$/, `${type} asks a question`);
    }
  }
  assert.equal(recordStep(observation({ id: "y", sequence: 1, type: "fault.unknown", source: "payments" }), "fault", m).pattern, m.playback.patternFallback);
  // A record step reads the active language: the same record in Spanish.
  const record = observation({ id: "z", sequence: 1, type: "database.transaction.committed", source: "payments", data: { redacted: true } });
  const spanish = recordStep(record, "commit", es);
  assert.equal(spanish.headline, "Transacción de base de datos confirmada");
  assert.equal(spanish.pattern, es.playback.pattern["database.transaction.committed"]);
});

/** Index of the last step that travels a link at or before `index`, or -1. */
function lastFlightAt(steps: readonly PlayheadStep[], index: number): number {
  for (let at = index; at >= 0; at -= 1) if (travelsLink(steps[at]!)) return at;
  return -1;
}

test("hops in transit read records at or before a cursor on a milestone that travels no link", async () => {
  let checked = 0;
  for (const { lesson, observations, edges } of await packagedRuns()) {
    const flights = flightSteps(observations, edges, m);
    const flightAt = (step: FlightStep) => flights.findIndex(item => item.observationId === step.observationId);
    const steps = playheadSteps(observations, edges, m);
    for (let cursor = 0; cursor < steps.length; cursor += 1) {
      const listed = flightInTransit(steps, cursor).map(step => step.observationId);
      const step = steps[cursor]!;
      if (travelsLink(step)) {
        // On a movement, the reading is the movement list's reading at the same movement.
        assert.deepEqual(listed, flightInTransit(flights, flightAt(step)).map(item => item.observationId), `${lesson.id} @${cursor}`);
        continue;
      }
      // On any other milestone, it is the reading at the previous movement, plus that movement
      // itself when it departed and is still on its link.
      const at = lastFlightAt(steps, cursor);
      const previous = at < 0 ? undefined : steps[at] as FlightStep;
      const expected = previous === undefined ? [] : flightInTransit(flights, flightAt(previous)).map(item => item.observationId);
      if (previous?.leg === "departure" && previous.hopId !== undefined) expected.push(previous.observationId);
      assert.deepEqual([...listed].sort(), [...expected].sort(), `${lesson.id} @${cursor}`);
      checked += 1;
    }
  }
  assert.ok(checked > 0);
  assert.deepEqual(flightInTransit(playheadSteps([], [], m), 0), []);
});

test("component activity at a milestone that travels no link reads records at or before it", async () => {
  for (const { lesson, observations, edges } of await packagedRuns()) {
    for (const step of playheadSteps(observations, edges, m)) {
      if (travelsLink(step)) continue;
      const known = observations.filter(item => item.sequence <= step.sequence);
      assert.deepEqual(activityAt(observations, step.observationId), activityAt(known, step.observationId), `${lesson.id} ${step.observationId}`);
    }
  }
  // At the first commit of retry-unsafe, Payments still owes the client its response.
  const { observations, edges } = await lessonRun("retry-unsafe");
  const commit = playheadSteps(observations, edges, m).find(step => !travelsLink(step) && step.recordKind === "commit")!;
  const activity = activityAt(observations, commit.observationId);
  assert.equal(activity.get("payments")?.state, "processing");
  assert.equal(activity.get("client")?.state, "waiting");
});

test("the component of a milestone that travels no link is never in the background", async () => {
  const { observations, edges } = await lessonRun("retry-unsafe");
  const steps = playheadSteps(observations, edges, m);
  const ids = ["client", "payments"];
  const commit = steps.find(step => !travelsLink(step) && step.recordKind === "commit")!;
  const idle = new Map();
  assert.deepEqual([...flightBackground(ids, commit, idle)], ["client"]);
  // A check names no component, so every idle component is in the background.
  const check = steps.find(step => !travelsLink(step) && step.recordKind === "check")!;
  assert.deepEqual([...flightBackground(ids, check, idle)], ids);
});
