import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The default view's guarantee (#166), measured from the rendered graph: every component name renders at
 * `MIN_NAME_PX` or more, the view starts at the graph's start (nothing is cut on the canvas's left or top edge;
 * a graph too large to fit is cut on the right or bottom only), and the graph is whole when it fits at that size.
 */
export const MIN_NAME_PX = 10;

export interface GraphView {
  /** The smallest rendered component name, in CSS pixels. */
  readonly smallestName: number;
  /** No node is cut by the canvas's left or top edge. */
  readonly startsAtStart: boolean;
  /** Every node lies wholly inside the canvas. */
  readonly whole: boolean;
  readonly nodes: number;
}

export async function graphView(page: Page): Promise<GraphView> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".graph-canvas")!.getBoundingClientRect();
    const nodes = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(node => {
      const box = node.getBoundingClientRect();
      const title = node.querySelector<HTMLElement>(".node-content strong");
      return {
        box,
        name: title && node.offsetWidth ? parseFloat(getComputedStyle(title).fontSize) * box.width / node.offsetWidth : Infinity,
        inside: box.left >= canvas.left - 0.5 && box.top >= canvas.top - 0.5 && box.right <= canvas.right + 0.5 && box.bottom <= canvas.bottom + 0.5,
      };
    });
    if (!nodes.length) return { smallestName: 0, startsAtStart: false, whole: false, nodes: 0 };
    return {
      smallestName: +Math.min(...nodes.map(node => node.name)).toFixed(2),
      startsAtStart: Math.min(...nodes.map(node => node.box.left)) >= canvas.left - 0.5 && Math.min(...nodes.map(node => node.box.top)) >= canvas.top - 0.5,
      whole: nodes.every(node => node.inside),
      nodes: nodes.length,
    };
  });
}

/** Waits for one settled view and checks the legibility guarantee; `whole` additionally requires every node on screen. */
export async function expectLegibleView(page: Page, context: string, options: { readonly whole?: boolean } = {}): Promise<GraphView> {
  let previous = "";
  let view = await graphView(page);
  await expect.poll(async () => {
    view = await graphView(page);
    const current = JSON.stringify(view);
    const settled = current === previous && view.nodes > 0;
    previous = current;
    return settled;
  }, { message: `graph view settles at ${context}`, intervals: [100, 200, 250] }).toBe(true);
  expect(view.smallestName, `${context}: smallest component name`).toBeGreaterThanOrEqual(MIN_NAME_PX);
  expect(view.startsAtStart, `${context}: the view starts at the graph's start`).toBe(true);
  if (options.whole) expect(view.whole, `${context}: the whole graph is on screen`).toBe(true);
  return view;
}
