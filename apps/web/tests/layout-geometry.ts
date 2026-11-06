import { Position, getSmoothStepPath } from "@xyflow/react";
import type { XYPosition } from "@xyflow/react";

/** Geometry checks shared by the layout tests and the before/after metrics. Canvas coordinates throughout. */
export interface Box {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Route {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly points: readonly XYPosition[];
}

export interface LayoutMetrics {
  readonly overlaps: number;
  readonly crossings: number;
  readonly intrusions: number;
  /** Pairs of edges drawn on top of each other along a shared run longer than a few pixels. */
  readonly sharedRuns: number;
}

const EPSILON = 0.5;

/** Pairs of boxes that share a positive area. Touching edges do not count. */
export function overlappingPairs(boxes: readonly Box[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      if (a.x + EPSILON < b.x + b.width && b.x + EPSILON < a.x + a.width && a.y + EPSILON < b.y + b.height && b.y + EPSILON < a.y + a.height) {
        pairs.push([a.id, b.id]);
      }
    }
  }
  return pairs;
}

function segments(points: readonly XYPosition[]): [XYPosition, XYPosition][] {
  const result: [XYPosition, XYPosition][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) result.push([a, b]);
  }
  return result;
}

const cross = (o: XYPosition, a: XYPosition, b: XYPosition) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** A proper crossing: each segment strictly separates the other's endpoints. Shared ports and collinear runs are not crossings. */
function properlyCross([a, b]: [XYPosition, XYPosition], [c, d]: [XYPosition, XYPosition]): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  const tolerance = 1e-6;
  return ((d1 > tolerance && d2 < -tolerance) || (d1 < -tolerance && d2 > tolerance))
    && ((d3 > tolerance && d4 < -tolerance) || (d3 < -tolerance && d4 > tolerance));
}

/** Number of places where two different edges cross. */
export function edgeCrossings(routes: readonly Route[]): number {
  let count = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      for (const s of segments(routes[i]!.points)) for (const t of segments(routes[j]!.points)) if (properlyCross(s, t)) count++;
    }
  }
  return count;
}

/** Liang–Barsky: does the segment enter the box's interior (shrunk by a half pixel, so running along a border is allowed)? */
function segmentEntersBox([a, b]: [XYPosition, XYPosition], box: Box): boolean {
  const left = box.x + EPSILON, right = box.x + box.width - EPSILON, top = box.y + EPSILON, bottom = box.y + box.height - EPSILON;
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]] as const) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t1 - t0 > 1e-9;
}

/** Edge segments that pass through a node other than the edge's own source or target. */
export function nodeIntrusions(routes: readonly Route[], boxes: readonly Box[]): { edge: string; node: string }[] {
  const found: { edge: string; node: string }[] = [];
  for (const route of routes) {
    for (const box of boxes) {
      if (box.id === route.source || box.id === route.target) continue;
      if (segments(route.points).some(segment => segmentEntersBox(segment, box))) found.push({ edge: route.id, node: box.id });
    }
  }
  return found;
}

/** Length two axis-parallel segments share on the same line (0 when they are not collinear). */
function sharedLength([a, b]: [XYPosition, XYPosition], [c, d]: [XYPosition, XYPosition]): number {
  const horizontal = (p: XYPosition, q: XYPosition) => Math.abs(p.y - q.y) < 1e-6;
  const vertical = (p: XYPosition, q: XYPosition) => Math.abs(p.x - q.x) < 1e-6;
  const overlap = (p: number, q: number, r: number, s: number) => Math.max(0, Math.min(Math.max(p, q), Math.max(r, s)) - Math.max(Math.min(p, q), Math.min(r, s)));
  if (horizontal(a, b) && horizontal(c, d) && Math.abs(a.y - c.y) < 1) return overlap(a.x, b.x, c.x, d.x);
  if (vertical(a, b) && vertical(c, d) && Math.abs(a.x - c.x) < 1) return overlap(a.y, b.y, c.y, d.y);
  return 0;
}

/** Pairs of different edges that run on top of each other for more than a few pixels. */
export function sharedRuns(routes: readonly Route[], minimum = 4): number {
  let count = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const shared = segments(routes[i]!.points).some(s => segments(routes[j]!.points).some(t => sharedLength(s, t) > minimum));
      if (shared) count++;
    }
  }
  return count;
}

export function metrics(boxes: readonly Box[], routes: readonly Route[]): LayoutMetrics {
  return {
    overlaps: overlappingPairs(boxes).length, crossings: edgeCrossings(routes),
    intrusions: nodeIntrusions(routes, boxes).length, sharedRuns: sharedRuns(routes),
  };
}

const handleAt: Record<Position, (box: Box) => XYPosition> = {
  [Position.Top]: box => ({ x: box.x + box.width / 2, y: box.y }),
  [Position.Bottom]: box => ({ x: box.x + box.width / 2, y: box.y + box.height }),
  [Position.Left]: box => ({ x: box.x, y: box.y + box.height / 2 }),
  [Position.Right]: box => ({ x: box.x + box.width, y: box.y + box.height / 2 }),
};

/**
 * The route React Flow drew before ELK: `getSmoothStepPath` between two side
 * midpoints, read back as points. A zero radius turns each rounded corner into
 * its corner point.
 */
export function smoothStepRoute(id: string, source: Box, sourcePosition: Position, target: Box, targetPosition: Position): Route {
  const from = handleAt[sourcePosition](source), to = handleAt[targetPosition](target);
  const [path] = getSmoothStepPath({ sourceX: from.x, sourceY: from.y, sourcePosition, targetX: to.x, targetY: to.y, targetPosition, borderRadius: 0 });
  const numbers = (path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
  const points: XYPosition[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const point = { x: numbers[i]!, y: numbers[i + 1]! };
    const last = points.at(-1);
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 1e-6) points.push(point);
  }
  return { id, source: source.id, target: target.id, points };
}
