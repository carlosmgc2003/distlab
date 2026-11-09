import assert from "node:assert/strict";
import test from "node:test";
import { roundedPath, routeMidpoint } from "../src/layout/elk-path.ts";

test("an ELK route becomes a polyline with slightly rounded corners", () => {
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }]), "M 0 0 L 100 0");
  // One bend: the corner is replaced by a 6 px quadratic curve.
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]), "M 0 0 L 94 0 Q 100 0 100 6 L 100 50");
  // Two close bends: the radius shrinks to half the shorter segment, so the curves never overlap.
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 30, y: 4 }]),
    "M 0 0 L 8 0 Q 10 0 10 2 L 10 2 Q 10 4 12 4 L 30 4");
  assert.equal(roundedPath([]), "");
});

test("an unplaced label sits halfway along the route", () => {
  assert.deepEqual(routeMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]), { x: 100, y: 0 });
  assert.deepEqual(routeMidpoint([{ x: 0, y: 0 }, { x: 0, y: 40 }]), { x: 0, y: 20 });
});
