import assert from "node:assert/strict";
import test from "node:test";
import { currentStep } from "../src/lesson-steps.ts";

// #140, RFC 0002 P5: the Lesson panel's current-step marker is emphasis only and follows the playhead.

test("OT-READ-AC-7: ② Run is current until the playhead leaves the start", () => {
  assert.equal(currentStep({ loaded: true, atStart: true, revealed: false }), "run");
});

test("OT-READ-AC-7: no section is current while the playhead is between the start and the end", () => {
  assert.equal(currentStep({ loaded: true, atStart: false, revealed: false }), null);
});

test("OT-READ-AC-7: ③ Investigate is current once the playhead has reached the end, also after moving back", () => {
  assert.equal(currentStep({ loaded: true, atStart: false, revealed: true }), "investigate");
  // A run that recorded no milestone reveals its outcome with the playhead still before the first record.
  assert.equal(currentStep({ loaded: true, atStart: true, revealed: true }), "investigate");
});

test("with no session there is no current step", () => {
  assert.equal(currentStep({ loaded: false, atStart: true, revealed: false }), null);
  assert.equal(currentStep({ loaded: false, atStart: false, revealed: true }), null);
});
