import assert from "node:assert/strict";
import test from "node:test";
import { MIN_NAME_PX, REVEAL_MARGIN, legibleViewport, legibleZoom, revealViewport, showsWhole, showsWholeGraph } from "../src/layout/legible-fit.ts";

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

test("#190 a movement already inside the canvas keeps the reader's view", () => {
  const current = { x: -120, y: 15, zoom: 0.9 };
  // Inside the canvas, though under the left inset: still visible, so nothing moves.
  const target = { x: 160, y: 100, width: 300, height: 120 };
  assert.ok(showsWhole(target, canvas, current));
  assert.equal(revealViewport(target, canvas, insets, current, 0.15), current);
});

test("#190 a movement off the right edge is panned in at the current zoom, by the least distance", () => {
  const current = { x: 67, y: 70, zoom: 0.8 };
  const target = { x: 900, y: 50, width: 300, height: 100 };
  assert.equal(showsWhole(target, canvas, current), false);
  const view = revealViewport(target, canvas, insets, current, 0.15);
  assert.equal(view.zoom, current.zoom);
  assert.equal(view.y, current.y, "already inside vertically, so no vertical pan");
  const right = (target.x + target.width) * view.zoom + view.x;
  assert.equal(+right.toFixed(6), canvas.width - insets.right, "the far edge lands on the right inset");
  assert.ok(showsWhole(target, canvas, view));
});

test("#190 a movement off the left and top edges is panned to the insets", () => {
  const current = { x: -500, y: -200, zoom: 1 };
  const target = { x: 100, y: 50, width: 200, height: 80 };
  const view = revealViewport(target, canvas, insets, current, 0.15);
  assert.equal(target.x * view.zoom + view.x, insets.left);
  assert.equal(target.y * view.zoom + view.y, insets.top);
  assert.equal(view.zoom, 1);
});

test("#190 a movement wider than the insets allow but narrower than the canvas pans without zooming out", () => {
  const current = { x: 67, y: 70, zoom: 1 };
  // 903 px are free between the insets; 960 px fit inside the canvas less the reveal margin.
  const target = { x: 400, y: 100, width: 960, height: 100 };
  const view = revealViewport(target, canvas, insets, current, 0.15);
  assert.equal(view.zoom, 1, "the zoom, and so the name size, is kept");
  assert.equal(view.y, current.y);
  assert.equal(target.x * view.zoom + view.x + target.width, canvas.width - REVEAL_MARGIN, "panned to the margin, not further");
  assert.ok(showsWhole(target, canvas, view));
});

test("#190 a movement too wide for the canvas at the current zoom is zoomed out just enough and centered", () => {
  const current = { x: 0, y: 0, zoom: 1 };
  const target = { x: 0, y: 100, width: 1956, height: 100 };
  const view = revealViewport(target, canvas, insets, current, 0.15);
  // 978 px of free width (the canvas less the margin on each side) for 1956 graph units.
  assert.equal(view.zoom, 0.5);
  assert.ok(showsWhole(target, canvas, view));
  const left = target.x * view.zoom + view.x, right = canvas.width - (target.x + target.width) * view.zoom - view.x;
  assert.equal(+left.toFixed(6), +right.toFixed(6));
  // Vertically it fits between the insets, so it is centered there.
  const top = target.y * view.zoom + view.y, bottom = canvas.height - insets.bottom - (top + target.height * view.zoom);
  assert.equal(+(top - insets.top).toFixed(6), +bottom.toFixed(6));
});

test("#190 zooming out to reveal never goes below the minimum zoom", () => {
  const view = revealViewport({ x: 0, y: 0, width: 100_000, height: 10 }, canvas, insets, { x: 0, y: 0, zoom: 1 }, 0.15);
  assert.equal(view.zoom, 0.15);
});
