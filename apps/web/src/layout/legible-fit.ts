/**
 * The default view of the architecture graph (#166). Pure presentation: it reads measured sizes and
 * returns a viewport. Positions and the viewport never enter projections, worker commands, or history.
 *
 * A plain fit shrinks the whole graph into the canvas, so a wide graph in a narrow canvas renders its
 * component names at a few pixels. The legible fit never zooms below the scale at which the smallest
 * component name renders at `MIN_NAME_PX`. When the whole graph does not fit at that scale, the view
 * starts at the graph's left and top edges, where the clients and the start of the story are, and the
 * reader pans to the rest. When it fits, it is centered in the space the insets leave.
 */

/** The smallest rendered size of a component's name in the default view, in CSS pixels. */
export const MIN_NAME_PX = 10;

export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Size { readonly width: number; readonly height: number }
/** Canvas space the graph must stay clear of at the default view: overlaid controls and the legend. */
export interface Insets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
export interface Viewport { readonly x: number; readonly y: number; readonly zoom: number }

/** The lowest zoom at which a name drawn at `smallestNamePx` (unscaled) renders at `MIN_NAME_PX`. */
export function legibleZoom(smallestNamePx: number, minimumPx = MIN_NAME_PX): number {
  return smallestNamePx > 0 ? minimumPx / smallestNamePx : 1;
}

/**
 * The default viewport for `bounds` (graph coordinates) in `canvas` (screen pixels). The zoom is the
 * plain fit, raised to `minZoom` when the fit would be smaller and capped at `maxZoom`.
 */
export function legibleViewport(bounds: Rect, canvas: Size, insets: Insets, limits: { readonly minZoom: number; readonly maxZoom: number }): Viewport {
  const width = Math.max(1, canvas.width - insets.left - insets.right);
  const height = Math.max(1, canvas.height - insets.top - insets.bottom);
  const fit = Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height));
  const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, fit));
  const along = (start: number, extent: number, space: number, inset: number) => {
    const drawn = extent * zoom;
    // Centered when it fits; otherwise the near edge is placed at the inset, and the reader pans on.
    return (drawn <= space ? inset + (space - drawn) / 2 : inset) - start * zoom;
  };
  return { x: along(bounds.x, bounds.width, width, insets.left), y: along(bounds.y, bounds.height, height, insets.top), zoom };
}

/** Whether the whole graph is on screen at `viewport`, inside the insets. */
export function showsWholeGraph(bounds: Rect, canvas: Size, insets: Insets, viewport: Viewport): boolean {
  const left = bounds.x * viewport.zoom + viewport.x, top = bounds.y * viewport.zoom + viewport.y;
  const epsilon = 0.5;
  return left >= insets.left - epsilon && top >= insets.top - epsilon
    && left + bounds.width * viewport.zoom <= canvas.width - insets.right + epsilon
    && top + bounds.height * viewport.zoom <= canvas.height - insets.bottom + epsilon;
}

/** Whether `target` (graph coordinates) lies wholly inside the canvas at `viewport`. */
export function showsWhole(target: Rect, canvas: Size, viewport: Viewport): boolean {
  return showsWholeGraph(target, canvas, { top: 0, right: 0, bottom: 0, left: 0 }, viewport);
}

/** The least clearance a revealed movement keeps from the canvas edge when the insets leave too little room. */
export const REVEAL_MARGIN = 8;

/**
 * The viewport that brings a painted movement's components (`target`, graph coordinates) into the
 * canvas (#190), changing `current` as little as it can. Presentation only, like the default view.
 *
 * - Already wholly inside the canvas: `current` itself, so the reader's own pan and zoom are kept.
 * - Fits at the current zoom: the smallest pan that puts it inside the space the insets leave, or, on
 *   an axis where the insets leave too little room, inside the canvas less `REVEAL_MARGIN`.
 * - Does not fit even then: zoomed out just enough, never below `minZoom`, and centered. The caller passes
 *   the legible floor as `minZoom`, so a pair that cannot fit at a legible size is centered and cut.
 */
export function revealViewport(target: Rect, canvas: Size, insets: Insets, current: Viewport, minZoom: number): Viewport {
  if (showsWhole(target, canvas, current)) return current;
  const tight = (inset: number) => Math.min(inset, REVEAL_MARGIN);
  const room = (size: number, near: number, far: number) => Math.max(1, size - near - far);
  const fit = Math.min(
    room(canvas.width, tight(insets.left), tight(insets.right)) / Math.max(1, target.width),
    room(canvas.height, tight(insets.top), tight(insets.bottom)) / Math.max(1, target.height));
  const zoom = fit < current.zoom ? Math.max(minZoom, fit) : current.zoom;
  const axis = (offset: number, start: number, extent: number, size: number, insetNear: number, insetFar: number) => {
    const drawn = extent * zoom;
    const roomy = drawn <= room(size, insetNear, insetFar);
    const near = roomy ? insetNear : tight(insetNear), far = roomy ? insetFar : tight(insetFar);
    // A changed zoom, or a target larger than the canvas at the minimum zoom, is centered.
    if (zoom !== current.zoom || drawn > room(size, near, far)) return near + (room(size, near, far) - drawn) / 2 - start * zoom;
    const from = start * zoom + offset, to = from + drawn;
    if (from < near) return offset + near - from;
    if (to > size - far) return offset - (to - (size - far));
    return offset;
  };
  return {
    x: axis(current.x, target.x, target.width, canvas.width, insets.left, insets.right),
    y: axis(current.y, target.y, target.height, canvas.height, insets.top, insets.bottom),
    zoom,
  };
}
