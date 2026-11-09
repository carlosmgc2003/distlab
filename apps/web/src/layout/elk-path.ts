import type { XYPosition } from "@xyflow/react";

/** Corner radius of a drawn ELK route: just enough to soften the orthogonal bends. */
export const CORNER_RADIUS = 6;

/**
 * SVG path through an ELK route: start point, bend points, end point. Each bend
 * becomes a short quadratic curve, clamped to half of the shorter neighboring
 * segment so two close bends never overlap.
 */
export function roundedPath(points: readonly XYPosition[], radius = CORNER_RADIUS): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  let path = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!, corner = points[i]!, next = points[i + 1]!;
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0) { path += ` L ${corner.x} ${corner.y}`; continue; }
    const before = { x: corner.x - (corner.x - previous.x) / inLength * r, y: corner.y - (corner.y - previous.y) / inLength * r };
    const after = { x: corner.x + (next.x - corner.x) / outLength * r, y: corner.y + (next.y - corner.y) / outLength * r };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  if (points.length > 1) {
    const last = points.at(-1)!;
    path += ` L ${last.x} ${last.y}`;
  }
  return path;
}

/** The point halfway along the route, for a label ELK did not place. */
export function routeMidpoint(points: readonly XYPosition[]): XYPosition {
  if (points.length === 0) return { x: 0, y: 0 };
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length && length > 0) {
      const from = points[i]!, to = points[i + 1]!;
      return { x: from.x + (to.x - from.x) * remaining / length, y: from.y + (to.y - from.y) * remaining / length };
    }
    remaining -= length;
  }
  return points.at(-1)!;
}
