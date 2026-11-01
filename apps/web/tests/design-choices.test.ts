import assert from "node:assert/strict";
import test from "node:test";
import { commerceLessonNames, commerceOverlayPolicy, checkoutOverlayPolicy } from "@distlab/catalogs";
import { carryOverlay } from "../src/break-faults.ts";
import {
  choiceCopy, choiceValues, describeChoices, isChoiceDiagnostic, placeChoiceDiagnostics, readInteger, sameChoices, setChoice,
} from "../src/design-choices.ts";

const retry = commerceOverlayPolicy("retry-unsafe");
const timeout = retry.parameters.find(item => item.key === "timeout")!;

test("every declared design choice has presentation copy, and checkout lessons declare none", () => {
  for (const name of commerceLessonNames) for (const parameter of commerceOverlayPolicy(name).parameters) {
    const copy = choiceCopy(parameter.key);
    assert.notEqual(copy.label, parameter.key, `${name}.${parameter.key} has a label`);
    assert.ok(copy.hint.length > 0, `${name}.${parameter.key} has a hint`);
  }
  assert.deepEqual(checkoutOverlayPolicy("normal").parameters, []);
});

test("the draft keeps the worker's normalized form: sorted by key, defaults removed", () => {
  let draft = setChoice(retry, [], "timeout", 40);
  draft = setChoice(retry, draft, "idempotency", true);
  assert.deepEqual(draft, [{ key: "idempotency", value: true }, { key: "timeout", value: 40 }]);
  assert.deepEqual(Object.fromEntries(choiceValues(retry, draft)), { idempotency: true, timeout: 40 });
  // Setting a value back to its default removes the override, so it equals the empty overlay.
  draft = setChoice(retry, setChoice(retry, draft, "idempotency", false), "timeout", 20);
  assert.deepEqual(draft, []);
  assert.deepEqual(Object.fromEntries(choiceValues(retry, [])), { idempotency: false, timeout: 20 });
  assert.ok(sameChoices([{ key: "timeout", value: 40 }], [{ key: "timeout", value: 40 }]));
  assert.ok(!sameChoices([{ key: "timeout", value: 40 }], [{ key: "timeout", value: 41 }]));
  assert.ok(!sameChoices([], [{ key: "timeout", value: 40 }]));
});

test("integer choices accept only whole numbers inside the declared range", () => {
  assert.deepEqual(readInteger("40", timeout), { value: 40 });
  assert.deepEqual(readInteger(" 1 ", timeout), { value: 1 });
  for (const text of ["", "0", "61", "4.5", "1e1", "abc", "-3"]) assert.ok(readInteger(text, timeout).error, text);
  assert.ok(readInteger("1", retry.parameters.find(item => item.key === "idempotency")!).error);
});

test("the run header names every applied choice that differs from its default", () => {
  assert.equal(describeChoices([{ key: "idempotency", value: true }, { key: "timeout", value: 40 }]), "idempotency=on · timeout=40");
  assert.equal(describeChoices([{ key: "outbox", value: false }]), "outbox=off");
  assert.equal(describeChoices([]), "");
});

test("worker diagnostics under /parameters are placed on the choice they name", () => {
  const diagnostics = [{ path: "/faults/0/id", code: "OVERLAY_ID_PREFIX" }, { path: "/parameters/1/value", code: "PARAMETER_VALUE" }, { path: "/parameters/0/key", code: "UNKNOWN_PARAMETER" }];
  const choices = diagnostics.filter(isChoiceDiagnostic);
  assert.deepEqual(choices.map(item => item.path), ["/parameters/1/value", "/parameters/0/key"]);
  const placed = placeChoiceDiagnostics(choices, [{ key: "ghost", value: 1 }, { key: "timeout", value: 0 }]);
  assert.match(placed.get("timeout")!, /PARAMETER_VALUE/);
  assert.match(placed.get("ghost")!, /UNKNOWN_PARAMETER/);
});

test("Compare keeps shared choices and drops the switch the pair compares", () => {
  const overlay = { version: 1 as const, faults: [], scheduledFaults: [], parameters: [{ key: "idempotency", value: true }, { key: "timeout", value: 40 }] };
  const carried = carryOverlay(overlay, retry, commerceOverlayPolicy("retry-idempotent"));
  assert.deepEqual(carried.overlay.parameters, [{ key: "timeout", value: 40 }]);
  assert.deepEqual(carried.dropped, ["idempotency"]);
  // The outbox lessons share consumer idempotency only between lessons with the same default.
  const outbox = carryOverlay({ ...overlay, parameters: [{ key: "consumer-idempotency", value: true }] }, commerceOverlayPolicy("dual-write"), commerceOverlayPolicy("outbox-unsafe-consumer"));
  assert.deepEqual(outbox.overlay.parameters, [{ key: "consumer-idempotency", value: true }]);
});
