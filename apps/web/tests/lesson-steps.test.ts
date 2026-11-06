import assert from "node:assert/strict";
import test from "node:test";
import { currentStep } from "../src/lesson-steps.ts";

// #140: the Lesson panel's current-step marker is emphasis only and depends on status and progress.

test("② Run is current while the session is ready or paused before any event is processed", () => {
  assert.equal(currentStep("READY", 0), "run");
  assert.equal(currentStep("PAUSED", 0), "run");
});

test("no section is current once events are processed but the run has not ended", () => {
  assert.equal(currentStep("READY", 1), null);
  assert.equal(currentStep("PAUSED", 4), null);
  assert.equal(currentStep("RUNNING", 0), null);
  assert.equal(currentStep("RUNNING", 9), null);
});

test("③ Investigate is current when the run is completed or failed", () => {
  assert.equal(currentStep("COMPLETED", 31), "investigate");
  assert.equal(currentStep("FAILED", 3), "investigate");
  // A run that fails before any event is still over: the outcome is what to read next.
  assert.equal(currentStep("FAILED", 0), "investigate");
});

test("with no session there is no current step", () => {
  assert.equal(currentStep(undefined, undefined), null);
  assert.equal(currentStep(undefined, 0), null);
});
