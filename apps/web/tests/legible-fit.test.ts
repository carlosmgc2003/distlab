import assert from "node:assert/strict";
import test from "node:test";
import { MIN_NAME_PX, legibleViewport, legibleZoom, showsWholeGraph } from "../src/layout/legible-fit.ts";

const insets = { top: 70, right: 24, bottom: 24, left: 67 };
const canvas = { width: 994, height: 490 };

test("#166 the legible zoom puts the smallest name at the minimum size", () => {
  assert.equal(MIN_NAME_PX, 10);
  assert.equal(legibleZoom(16), 0.625);
  assert.equal(+legibleZoom(13).toFixed(3), 0.769);
  assert.equal(legibleZoom(0), 1, "no measured name leaves the zoom unconstrained by legibility");
});

test("#166 a graph that fits legibly is whole and centered in the space the insets leave", () => {
  const bounds = { x: 0, y: 0, width: 600, height: 200 };
  const view = legibleViewport(bounds, canvas, insets, { minZoom: 0.625, maxZoom: 1.25 });
  // Width 903 and height 396 are free; the fit is limited by width, then capped at 1.25.
  assert.equal(view.zoom, 1.25);
  assert.ok(showsWholeGraph(bounds, canvas, insets, view));
  const left = view.x, right = canvas.width - insets.right - (bounds.width * view.zoom + view.x);
  assert.equal(+(left - insets.left).toFixed(6), +right.toFixed(6), "centered horizontally");
});

test("#166 a graph too wide to fit legibly keeps the legible zoom and starts at its left and top edges", () => {
  const bounds = { x: 40, y: -20, width: 1500, height: 180 };
  const view = legibleViewport(bounds, canvas, insets, { minZoom: 0.625, maxZoom: 1.25 });
  // The plain fit would be 903 / 1500 ≈ 0.60, below the legible floor.
  assert.equal(view.zoom, 0.625);
  assert.equal(view.x, insets.left - bounds.x * view.zoom, "the graph's left edge sits at the left inset");
  // Vertically it still fits, so it is centered there.
  const top = bounds.y * view.zoom + view.y, bottom = top + bounds.height * view.zoom;
  assert.equal(+(top - insets.top).toFixed(6), +(canvas.height - insets.bottom - bottom).toFixed(6));
  assert.equal(showsWholeGraph(bounds, canvas, insets, view), false);
});

test("#166 a graph too tall to fit legibly starts at its top edge", () => {
  const bounds = { x: 0, y: 10, width: 400, height: 900 };
  const view = legibleViewport(bounds, canvas, insets, { minZoom: 0.625, maxZoom: 1.25 });
  assert.equal(view.zoom, 0.625);
  assert.equal(view.y, insets.top - bounds.y * view.zoom);
});

test("#166 the same inputs give the same view", () => {
  const bounds = { x: 3, y: 4, width: 1211, height: 487 };
  const limits = { minZoom: legibleZoom(13), maxZoom: 1.25 };
  assert.deepEqual(legibleViewport(bounds, canvas, insets, limits), legibleViewport(bounds, canvas, insets, limits));
});
