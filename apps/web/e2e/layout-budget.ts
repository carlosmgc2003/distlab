import type { Page } from "@playwright/test";

/** One reading of the workspace shell, in CSS pixels or element counts, as the student first sees it. */
export interface LayoutMeasures {
  /** Height of the shell's top-level `header`. */
  readonly topBarHeight: number;
  /** Height of the part of `.graph-canvas` that lies inside the viewport, with the Architecture tab active. */
  readonly canvasVisible: number;
  /** Whether the first item of the list named "Business invariants" intersects the viewport; `null` when the page has no such list. */
  readonly firstVerdictVisible: boolean | null;
  /** Visible buttons, selects, inputs, summaries, links, and tabs in the viewport and outside `.graph-canvas`. */
  readonly controlsOutsideGraph: number;
  /** Visible paragraphs of 8 or more words in the viewport, outside `.graph-canvas`, `.architecture-side`, and `.sr-only`. */
  readonly proseBlocks: number;
}

export type BudgetViewport = "1366x768" | "1534x897";
export type BudgetLesson = "response-lost" | "saga-uncompensated" | "retry-unsafe";
export type BudgetState = "READY" | "COMPLETED";

/**
 * Bounds for one viewport, lesson, and state. `max` measures may not grow and `min` measures may not shrink.
 * `firstVerdictVisible: true` requires the first verdict on screen; `false` does not require it yet.
 */
export interface LayoutBudget {
  readonly topBarHeight: { readonly max: number };
  readonly canvasVisible: { readonly min: number };
  readonly controlsOutsideGraph: { readonly max: number };
  readonly proseBlocks: { readonly max: number };
  /** Commerce lessons after Run only. */
  readonly firstVerdictVisible?: boolean;
}

export const viewports: Readonly<Record<BudgetViewport, { readonly width: number; readonly height: number }>> = {
  "1366x768": { width: 1366, height: 768 },
  "1534x897": { width: 1534, height: 897 },
};

/**
 * The only place the layout thresholds are written.
 *
 * Recorded on `main` (November 2026) with the production build, from the lower of two readings: a Linux
 * container and CI (`ubuntu-latest`), whose fonts differ. Each bound has at most 5% tolerance rounded toward
 * the measured value: a 202 px top bar allows 212, the checkout canvas at 1366×768 (267 px locally, 250 px on
 * CI) requires 238, and counts below 20 allow no slack.
 * `firstVerdictVisible` is `false` today: no commerce verdict is on screen after Run. See `targets`.
 *
 * Issues in the workspace epic (#136) tighten these values. A pull request must not loosen one without
 * stating the reason in its description.
 */
export const budgets: Readonly<Record<BudgetViewport, Readonly<Record<BudgetLesson, Readonly<Record<BudgetState, LayoutBudget>>>>>> = {
  "1366x768": {
    "response-lost": {
      READY: { topBarHeight: { max: 212 }, canvasVisible: { min: 238 }, controlsOutsideGraph: { max: 18 }, proseBlocks: { max: 1 } },
      COMPLETED: { topBarHeight: { max: 212 }, canvasVisible: { min: 238 }, controlsOutsideGraph: { max: 18 }, proseBlocks: { max: 2 } },
    },
    "saga-uncompensated": {
      READY: { topBarHeight: { max: 212 }, canvasVisible: { min: 195 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 1 } },
      COMPLETED: { topBarHeight: { max: 212 }, canvasVisible: { min: 195 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 2 }, firstVerdictVisible: false },
    },
    "retry-unsafe": {
      READY: { topBarHeight: { max: 212 }, canvasVisible: { min: 195 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 1 } },
      COMPLETED: { topBarHeight: { max: 212 }, canvasVisible: { min: 195 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 2 }, firstVerdictVisible: false },
    },
  },
  "1534x897": {
    "response-lost": {
      READY: { topBarHeight: { max: 212 }, canvasVisible: { min: 377 }, controlsOutsideGraph: { max: 18 }, proseBlocks: { max: 1 } },
      COMPLETED: { topBarHeight: { max: 212 }, canvasVisible: { min: 377 }, controlsOutsideGraph: { max: 18 }, proseBlocks: { max: 2 } },
    },
    "saga-uncompensated": {
      READY: { topBarHeight: { max: 212 }, canvasVisible: { min: 318 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 1 } },
      COMPLETED: { topBarHeight: { max: 212 }, canvasVisible: { min: 318 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 2 }, firstVerdictVisible: false },
    },
    "retry-unsafe": {
      READY: { topBarHeight: { max: 212 }, canvasVisible: { min: 318 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 1 } },
      COMPLETED: { topBarHeight: { max: 212 }, canvasVisible: { min: 318 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 2 }, firstVerdictVisible: false },
    },
  },
};

/** Where the workspace epic (#136) is heading; each entry is a value the budgets above should eventually reach. */
export const targets = {
  /** A commerce verdict is on screen when a run ends, without scrolling. */
  firstVerdictVisible: true,
} as const;

/** Reads the measures from the live page without scrolling or changing it. */
export async function measureLayout(page: Page): Promise<LayoutMeasures> {
  return page.evaluate(() => {
    interface Box { top: number; right: number; bottom: number; left: number }
    const viewport: Box = { top: 0, left: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
    const clip = (box: Box, by: Box): Box => ({
      top: Math.max(box.top, by.top), left: Math.max(box.left, by.left),
      bottom: Math.min(box.bottom, by.bottom), right: Math.min(box.right, by.right),
    });
    /**
     * The part of an element a student can see without scrolling: rendered (closed `<details>` content and
     * `hidden` elements are not), then cut by the viewport and by every ancestor that clips its overflow.
     */
    const visibleBox = (element: Element): Box | null => {
      if (!element.checkVisibility({ visibilityProperty: true })) return null;
      let box: Box = clip(element.getBoundingClientRect(), viewport);
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") box = clip(box, ancestor.getBoundingClientRect());
      }
      return box.right > box.left && box.bottom > box.top ? box : null;
    };
    const shown = (element: Element) => visibleBox(element) !== null;
    const outside = (element: Element, selectors: string) => element.closest(selectors) === null;

    const header = [...document.querySelectorAll("header")].find(element => element.parentElement?.closest("header, article, section, aside, nav") == null);
    const topBarHeight = header ? +header.getBoundingClientRect().height.toFixed(1) : 0;

    const canvas = document.querySelector(".graph-canvas");
    // Cut by the viewport only, as #138 defines it. Today the commerce Architecture panel's own scroll region
    // hides a further 16 px of the canvas; the other measures apply that clipping.
    const canvasBox = canvas?.checkVisibility({ visibilityProperty: true }) ? clip(canvas.getBoundingClientRect(), viewport) : null;
    const canvasVisible = canvasBox ? +Math.max(0, canvasBox.bottom - canvasBox.top).toFixed(1) : 0;

    const verdicts = document.querySelector('[aria-label="Business invariants"]:is(ul, ol, [role=list])');
    const firstVerdict = verdicts?.querySelector("li, [role=listitem]");
    const firstVerdictVisible = verdicts ? firstVerdict != null && shown(firstVerdict) : null;

    const controlsOutsideGraph = [...document.querySelectorAll("button, select, input, summary, a[href], [role=tab]")]
      .filter(element => outside(element, ".graph-canvas") && shown(element)).length;

    const proseBlocks = [...document.querySelectorAll("p")]
      .filter(element => outside(element, ".graph-canvas, .architecture-side, .sr-only"))
      .filter(element => (element.textContent ?? "").trim().split(/\s+/).filter(Boolean).length >= 8)
      .filter(shown).length;

    return { topBarHeight, canvasVisible, firstVerdictVisible, controlsOutsideGraph, proseBlocks };
  });
}
