import assert from "node:assert/strict";
import test from "node:test";
import { simulationTime } from "@distlab/contracts";
import {
  INITIAL_PLAYHEAD,
  PLAYHEAD_KEYS,
  playheadCommand,
  playheadControls,
  playheadExecuted,
  playheadKeyAction,
  playheadPhase,
  playheadPosition,
  playheadSummary,
  playheadTick,
} from "../src/playhead.ts";
import type { PlayheadContext, PlayheadState } from "../src/playhead.ts";
import { messages } from "../src/i18n/catalog.ts";

const m = messages("en");
const es = messages("es");

const COUNT = 19;
const unrun: PlayheadContext = { executed: false, busy: false, count: 0, animation: true };
const executed: PlayheadContext = { executed: true, busy: false, count: COUNT, animation: true };
const at = (index: number, playing = false): PlayheadState => ({ ...INITIAL_PLAYHEAD, index, playing });

test("OT-PLAY-AC-2: before the first Run or Step, Run and Step execute the run and Back is unavailable", () => {
  assert.equal(playheadPhase(INITIAL_PLAYHEAD, unrun), "unrun");
  const run = playheadCommand(INITIAL_PLAYHEAD, unrun, "toggle");
  assert.deepEqual(run, { state: { ...INITIAL_PLAYHEAD, intent: "play" }, execute: true });
  const step = playheadCommand(INITIAL_PLAYHEAD, unrun, "step");
  assert.deepEqual(step, { state: { ...INITIAL_PLAYHEAD, intent: "first" }, execute: true });
  assert.equal(playheadCommand(INITIAL_PLAYHEAD, unrun, "back"), null);
  // With Animation off, Run asks for the end instead.
  assert.equal(playheadCommand(INITIAL_PLAYHEAD, { ...unrun, animation: false }, "toggle")?.state.intent, "end");

  // While the worker executes, every control waits, and nothing is asked for twice.
  const waiting = run!.state;
  assert.equal(playheadPhase(waiting, unrun), "executing");
  for (const command of ["toggle", "step", "back"] as const) assert.equal(playheadCommand(waiting, unrun, command), null);
  const controls = playheadControls(INITIAL_PLAYHEAD, unrun, m);
  assert.deepEqual([controls.toggle.label, controls.toggle.available, controls.step, controls.back], ["Run", true, true, false]);
});

test("OT-PLAY-AC-2: the intent of the first Run or Step applies once the run has executed", () => {
  // Run with Animation on plays from the first milestone; each start of play paints again.
  assert.deepEqual(playheadExecuted({ ...INITIAL_PLAYHEAD, intent: "play" }, COUNT), { index: 0, playing: true, intent: null, paint: 1 });
  assert.deepEqual(playheadExecuted({ ...INITIAL_PLAYHEAD, intent: "end" }, COUNT), { index: COUNT - 1, playing: false, intent: null, paint: 0 });
  assert.deepEqual(playheadExecuted({ ...INITIAL_PLAYHEAD, intent: "first" }, COUNT), { index: 0, playing: false, intent: null, paint: 0 });
  // A run that recorded no milestone leaves the playhead before the first record, at the end.
  const empty = playheadExecuted({ ...INITIAL_PLAYHEAD, intent: "play" }, 0);
  assert.equal(empty.index, -1);
  assert.equal(playheadPhase(empty, { ...executed, count: 0 }), "ended");
  // No intent, no change.
  const standing = at(4);
  assert.equal(playheadExecuted(standing, COUNT), standing);
});

test("OT-PLAY-AC-2: while playing, Run reads Pause, Step and Back stop and move one milestone, and nothing executes", () => {
  const playing = at(5, true);
  assert.equal(playheadPhase(playing, executed), "playing");
  assert.deepEqual(playheadCommand(playing, executed, "toggle"), { state: at(5), execute: false });
  assert.deepEqual(playheadCommand(playing, executed, "step"), { state: at(6), execute: false });
  assert.deepEqual(playheadCommand(playing, executed, "back"), { state: at(4), execute: false });
  const controls = playheadControls(playing, executed, m);
  assert.deepEqual([controls.toggle.label, controls.toggle.pauses, controls.step, controls.back], ["Pause", true, true, true]);
  // On the first milestone there is nothing to go back to.
  assert.equal(playheadCommand(at(0, true), executed, "back"), null);
});

test("OT-PLAY-AC-2: paused, Run continues from the playhead and Step and Back move one milestone", () => {
  const paused = at(5);
  assert.equal(playheadPhase(paused, executed), "paused");
  assert.deepEqual(playheadCommand(paused, executed, "toggle"), { state: { ...at(5, true), paint: 1 }, execute: false });
  assert.deepEqual(playheadCommand(paused, executed, "step"), { state: at(6), execute: false });
  assert.deepEqual(playheadCommand(paused, executed, "back"), { state: at(4), execute: false });
  const controls = playheadControls(paused, executed, m);
  assert.deepEqual([controls.toggle.label, controls.toggle.pauses, controls.step, controls.back], ["Continue", false, true, true]);
  assert.equal(playheadControls(paused, executed, es).toggle.label, "Continuar");
  // Before the first record of an executed run (Recorded history took the graph), Run starts on the first milestone.
  assert.deepEqual(playheadCommand(at(-1), executed, "toggle")?.state, { ...at(0, true), paint: 1 });
  assert.deepEqual(playheadCommand(at(-1), executed, "step")?.state, at(0));
  assert.equal(playheadCommand(at(-1), executed, "back"), null);
  assert.equal(playheadControls(at(-1), executed, m).toggle.label, "Run");
});

test("OT-PLAY-AC-2: at the end, Run and Step are unavailable and Back moves one milestone", () => {
  const end = at(COUNT - 1);
  assert.equal(playheadPhase(end, executed), "ended");
  assert.equal(playheadCommand(end, executed, "toggle"), null);
  assert.equal(playheadCommand(end, executed, "step"), null);
  assert.deepEqual(playheadCommand(end, executed, "back"), { state: at(COUNT - 2), execute: false });
  const controls = playheadControls(end, executed, m);
  assert.deepEqual([controls.toggle.label, controls.toggle.available, controls.step, controls.back], ["Run", false, false, true]);
  // A run of one milestone ends on it: nothing to step to or back to.
  const single = { ...executed, count: 1 };
  assert.deepEqual(playheadControls(at(0), single, m), { phase: "ended", toggle: { pauses: false, label: "Run", available: false }, step: false, back: false });
});

test("OT-PLAY-AC-4: with Animation off, Run goes to the last milestone", () => {
  const off = { ...executed, animation: false };
  assert.deepEqual(playheadCommand(at(3), off, "toggle"), { state: at(COUNT - 1), execute: false });
  assert.equal(playheadPhase(playheadExecuted({ ...INITIAL_PLAYHEAD, intent: "end" }, COUNT), off), "ended");
});

test("a busy session takes no control, in any phase", () => {
  for (const [state, context] of [[INITIAL_PLAYHEAD, unrun], [at(3, true), executed], [at(3), executed], [at(COUNT - 1), executed]] as const) {
    for (const command of ["toggle", "step", "back"] as const) assert.equal(playheadCommand(state, { ...context, busy: true }, command), null);
  }
});

test("play advances one milestone per beat and stops on the last", () => {
  assert.deepEqual(playheadTick(at(0, true), COUNT), at(1, true));
  assert.deepEqual(playheadTick(at(COUNT - 2, true), COUNT), at(COUNT - 1));
  assert.equal(playheadPhase(playheadTick(at(COUNT - 2, true), COUNT), executed), "ended");
  // A paused playhead does not move.
  assert.deepEqual(playheadTick(at(3), COUNT), at(3));
  // Ticking a whole run visits every milestone once, in order.
  const visited: number[] = [];
  let state = playheadExecuted({ ...INITIAL_PLAYHEAD, intent: "play" }, COUNT);
  while (state.playing) { visited.push(state.index); state = playheadTick(state, COUNT); }
  visited.push(state.index);
  assert.deepEqual(visited, Array.from({ length: COUNT }, (_, index) => index));
});

test("the position states the milestone number, the count, and the record's virtual time", () => {
  const steps = [
    { time: simulationTime(0), sequence: 4 },
    { time: simulationTime(0), sequence: 24 },
    { time: simulationTime(12), sequence: 48 },
  ];
  assert.deepEqual(playheadPosition([], -1, true, m), { text: "The run recorded no milestones." });
  assert.deepEqual(playheadPosition(steps, -1, true, m), { text: "Before the first record. The run recorded 3 milestones." });
  // Before the run has executed, a record the loaded session already holds is not a milestone of a run.
  assert.deepEqual(playheadPosition(steps, -1, false, m), { text: "The run has not executed yet. Run or Step executes it." });
  assert.deepEqual(playheadPosition(steps, 1, true, m), { text: "Milestone 2 of 3 · virtual time 0 · observation #24." });
  assert.deepEqual(playheadPosition(steps, 2, true, m), {
    text: "Milestone 3 of 3 · virtual time 12 · observation #48.",
    jump: "Virtual time jumped t=0 → t=12 with no recorded milestone in between.",
  });
  assert.equal(playheadPosition(steps, 2, true, es).text, "Hito 3 de 3 · tiempo virtual 12 · observación #48.");
});

test("Left is Back, Right is Step, and Space is Run or Pause, unless a focused control owns the key", () => {
  const free = { modified: false, repeat: false, arrowsClaimed: false, spaceClaimed: false };
  assert.equal(playheadKeyAction({ ...free, key: PLAYHEAD_KEYS.back }), "back");
  assert.equal(playheadKeyAction({ ...free, key: PLAYHEAD_KEYS.step }), "step");
  assert.equal(playheadKeyAction({ ...free, key: PLAYHEAD_KEYS.toggle }), "toggle");
  assert.equal(playheadKeyAction({ ...free, key: "ArrowLeft", arrowsClaimed: true }), null);
  assert.equal(playheadKeyAction({ ...free, key: " ", spaceClaimed: true }), null);
  assert.equal(playheadKeyAction({ ...free, key: " ", repeat: true }), null);
  assert.equal(playheadKeyAction({ ...free, key: "ArrowRight", modified: true }), null);
  for (const key of ["ArrowUp", "ArrowDown", "Enter", "Escape", "a", "Home"]) assert.equal(playheadKeyAction({ ...free, key }), null);
});

test("OT-PLAY-AC-6: the top bar states the milestone and the virtual time of the record under the playhead, and nothing before the run executes", () => {
  const steps = [{ time: simulationTime(0) }, { time: simulationTime(0) }, { time: simulationTime(12) }];
  // Before the run has executed, whatever the loaded session recorded, the top bar states no position and no time.
  assert.deepEqual(playheadSummary(steps, -1, false, m), { milestone: "—", time: "—" });
  // Executed, before the first record: the count, and no time, because the playhead stands on no record.
  assert.deepEqual(playheadSummary(steps, -1, true, m), { milestone: "0 of 3", time: "—" });
  assert.deepEqual(playheadSummary(steps, 2, true, m), { milestone: "3 of 3", time: "12" });
  assert.deepEqual(playheadSummary(steps, 1, true, es), { milestone: "2 de 3", time: "0" });
  assert.deepEqual(playheadSummary([], -1, true, m), { milestone: "0 of 0", time: "—" });
});
