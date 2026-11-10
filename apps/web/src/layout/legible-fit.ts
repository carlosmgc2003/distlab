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
