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
  /**
   * Visible paragraphs of 8 or more words in the viewport, outside `.graph-canvas`, `.architecture-side`, `.lesson-panel`,
   * and `.sr-only`. The Lesson panel is where lesson prose belongs (#137 budget: outside the lesson panel and graph area).
   */
  readonly proseBlocks: number;
  /**
   * The smallest rendered size, in CSS pixels, of a component name on the architecture graph: each node's title
   * font size times the graph's current scale (#166). `0` when no graph is drawn.
   */
  readonly smallestName: number;
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
  readonly smallestName: { readonly min: number };
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
 * `firstVerdictVisible` was `false` then: no commerce verdict was on screen after Run. See `targets`.
 *
 * #139 replaced the Scenario select and Load scenario with one lesson trigger: one control fewer.
 *
 * #140 moved lesson guidance from the toolbar drawer and the prompt bar into the Lesson panel. Bounds re-recorded
 * from the lower of a Linux container and CI reading (canvas within 3 px of each other, counts equal): the top
 * bar is 149 px (allows 156), and the checkout canvas at 1366×768 is 371 px at READY and 354 px at COMPLETED
 * (requires 353 and 337). The one count that rose is retry-unsafe at 1534×897, 18 → 19, because ④ Experiment's
 * Compare button is now on screen there.
 *
 * #141 moved the lesson checks into the Lesson panel's ③ Investigate and reveals that section when a run ends, so
 * `firstVerdictVisible` is now `true`. Only the COMPLETED control counts rose, because the controls the issue puts
 * first are now on screen: each settled verdict's **Show evidence** (saga-uncompensated 16 → 19 at 1366×768 and
 * 18 → 20 at 1534×897; retry-unsafe 16 → 17 at 1366×768) and, for checkout, the Run overview's evidence links, which
 * now follow the outcome sentence (response-lost 17 → 24 at both viewports). retry-unsafe at 1534×897 fell 19 → 18:
 * the reveal scrolls ④ Experiment's Compare button out of view.
 *
 * #143 replaced the Break bar above the graph and the Design choices panel with one Experiment drawer, opened from
 * ④ Experiment's single **Change the experiment…**. With the bar gone, the commerce graph also fills the
 * Architecture panel's visible height (at least 28rem) and service state follows below it. Every bound tightened:
 * canvas mins are 95% of the container reading, rounded up (1366×768: checkout 433/416 px → 412/396, commerce
 * 469/452 px → 446/430; 1534×897: checkout 562 px → 534, commerce 598 px → 569), and each control count is the
 * reading, one to four controls fewer than before.
 *
 * #142 moved service state into a dialog, so the Architecture tab holds only the graph and no longer scrolls. The
 * commerce bounds that #143 recorded were inflated: the commerce graph was taller than its scrolling panel, and this
 * measure is cut by the viewport only, so it counted canvas hidden under the panel's own scroll region (at 1366×768
 * on main: 469 px counted, 453 px inside the panel). Commerce now reads exactly as checkout does, and the readings
 * are the true visible canvas: 433/416 px at 1366×768 and 562 px at 1534×897, so the mins are 412/396 and 534, the
 * checkout values. Against the bounds recorded before #143 (387/371 and 426) commerce still gains canvas. The
 * commerce control counts rose by one or two: ArchitectureView's Connections disclosure is now on screen below the
 * graph, as it already was for checkout, and **Show service state** is on screen where ③ Investigate ends in view.
 *
 * #144 made the top bar one row of at most 64 px, identical on both tabs, and moved Replay into the Architecture
 * tab above the graph. These are the epic's final budgets from `docs/ui-visual-system.md`: the top bar at most
 * 64 px (62 px measured) and the canvas at least 440 px at 1366×768 (490/473 px measured) and 560 px at 1534×897
 * (619 px measured), for every lesson and state. Control and prose counts are unchanged.
 *
 * #147 moved the guarantee prose of ③ Investigate, the Experiment drawer, the Service state dialog, and More filters
 * behind one hint per region. The control counts rose and are loosened on purpose: ③ Investigate's new **About these
 * results** trigger is on screen in every measured state (+1), and the shorter section brings one more of its actions
 * into view in three states: **Show service state** for retry-unsafe at READY (16 → 18 at 1366×768, 17 → 19 at
 * 1534×897) and a fourth **Show evidence** for saga-uncompensated at COMPLETED at 1534×897 (19 → 21). The prose
 * counts stay at 1 and 2: what they count is the Architecture tab's playback readout and movement cue, graph-area
 * text that #136 and #147 leave alone. The drawer and the dialogs are closed while these are measured.
 *
 * #166 adds `smallestName`: every component name on the graph renders at 10 px or more. Before it, the default
 * fit shrank the graph to the canvas, and names rendered at 5–8 px at 1366×768 for most lessons.
 *
 * The Theme selector (System, Light, Dark) closes the top bar as one compact button, whose choices live in a
 * popover. It is on screen in every measured state, so every `controlsOutsideGraph` bound rises by exactly one
 * (+1). The top bar stays one row at 62 px, and no other measure changes.
 *
 * Issues in the workspace epic (#136) tighten these values. A pull request must not loosen one without
 * stating the reason in its description.
 */
export const budgets: Readonly<Record<BudgetViewport, Readonly<Record<BudgetLesson, Readonly<Record<BudgetState, LayoutBudget>>>>>> = {
  "1366x768": {
    "response-lost": {
      READY: { topBarHeight: { max: 64 }, canvasVisible: { min: 440 }, controlsOutsideGraph: { max: 18 }, proseBlocks: { max: 1 }, smallestName: { min: 10 } },
      COMPLETED: { topBarHeight: { max: 64 }, canvasVisible: { min: 440 }, controlsOutsideGraph: { max: 25 }, proseBlocks: { max: 2 }, smallestName: { min: 10 } },
    },
    "saga-uncompensated": {
      READY: { topBarHeight: { max: 64 }, canvasVisible: { min: 440 }, controlsOutsideGraph: { max: 18 }, proseBlocks: { max: 1 }, smallestName: { min: 10 } },
      COMPLETED: { topBarHeight: { max: 64 }, canvasVisible: { min: 440 }, controlsOutsideGraph: { max: 21 }, proseBlocks: { max: 2 }, smallestName: { min: 10 }, firstVerdictVisible: true },
    },
    "retry-unsafe": {
      READY: { topBarHeight: { max: 64 }, canvasVisible: { min: 440 }, controlsOutsideGraph: { max: 19 }, proseBlocks: { max: 1 }, smallestName: { min: 10 } },
      COMPLETED: { topBarHeight: { max: 64 }, canvasVisible: { min: 440 }, controlsOutsideGraph: { max: 20 }, proseBlocks: { max: 2 }, smallestName: { min: 10 }, firstVerdictVisible: true },
    },
  },
  "1534x897": {
    "response-lost": {
      READY: { topBarHeight: { max: 64 }, canvasVisible: { min: 560 }, controlsOutsideGraph: { max: 18 }, proseBlocks: { max: 1 }, smallestName: { min: 10 } },
      COMPLETED: { topBarHeight: { max: 64 }, canvasVisible: { min: 560 }, controlsOutsideGraph: { max: 25 }, proseBlocks: { max: 2 }, smallestName: { min: 10 } },
    },
    "saga-uncompensated": {
      READY: { topBarHeight: { max: 64 }, canvasVisible: { min: 560 }, controlsOutsideGraph: { max: 18 }, proseBlocks: { max: 1 }, smallestName: { min: 10 } },
      COMPLETED: { topBarHeight: { max: 64 }, canvasVisible: { min: 560 }, controlsOutsideGraph: { max: 22 }, proseBlocks: { max: 2 }, smallestName: { min: 10 }, firstVerdictVisible: true },
    },
    "retry-unsafe": {
      READY: { topBarHeight: { max: 64 }, canvasVisible: { min: 560 }, controlsOutsideGraph: { max: 20 }, proseBlocks: { max: 1 }, smallestName: { min: 10 } },
      COMPLETED: { topBarHeight: { max: 64 }, canvasVisible: { min: 560 }, controlsOutsideGraph: { max: 20 }, proseBlocks: { max: 2 }, smallestName: { min: 10 }, firstVerdictVisible: true },
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
      .filter(element => outside(element, ".graph-canvas, .architecture-side, .lesson-panel, .sr-only"))
      .filter(element => (element.textContent ?? "").trim().split(/\s+/).filter(Boolean).length >= 8)
      .filter(shown).length;

    // The graph's scale is read from each node's drawn width against its own layout width, so no transform is parsed.
    const names = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].flatMap(node => {
      const title = node.querySelector<HTMLElement>(".node-content strong");
      if (!title || node.offsetWidth === 0) return [];
      return [parseFloat(getComputedStyle(title).fontSize) * node.getBoundingClientRect().width / node.offsetWidth];
    });
    const smallestName = names.length ? +Math.min(...names).toFixed(2) : 0;

    return { topBarHeight, canvasVisible, firstVerdictVisible, controlsOutsideGraph, proseBlocks, smallestName };
  });
}
