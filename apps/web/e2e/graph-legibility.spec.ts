import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { scenarios } from "../src/scenarios.ts";
import { viewports } from "./layout-budget.ts";
import { expectLegibleView } from "./support/graph.ts";
import { graphLaidOut, loadLesson } from "./support/lesson.ts";
import { experimentDrawer, faultsSection, openExperiment } from "./support/experiment.ts";

// #166: the architecture graph stays legible at the supported baselines. Every component name renders at
// 10 px or more; when the whole graph does not fit at that size, the view starts at the graph's start and
// the reader pans, instead of shrinking the names. The measure and the bound are in support/graph.ts.

const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });

for (const [name, size] of Object.entries(viewports)) {
  test(`#166 every packaged lesson loads with legible component names at ${name}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(size);
    const partial: string[] = [];
    for (const lesson of scenarios) {
      await page.goto("/");
      await loadLesson(page, lesson.id);
      await expect(status(page)).toHaveText("READY");
      await graphLaidOut(page);
      // The legend starts collapsed, so it takes no column of the canvas.
      await expect(page.getByRole("button", { name: "Show legend" })).toHaveAttribute("aria-expanded", "false");
      // Legible, and whole or started at the graph's start.
      if (!(await expectLegibleView(page, `${lesson.id} at ${name}`)).whole) partial.push(lesson.id);
    }
    // At 1534×897 every lesson's fit has 15–20 % to spare above the legible floor, so every lesson is whole.
    // At 1366×768 the widest fit within about 2 % of it, and font metrics decide; only legibility is required.
    if (name === "1534x897") expect(partial, `partial at ${name}`).toEqual([]);
  });
}

test("#166 names stay legible at 1366×768 with a movement selected and the Experiment drawer open, and Pick on graph still works", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(viewports["1366x768"]);
  for (const lesson of scenarios) {
    await page.goto("/");
    await loadLesson(page, lesson.id);
    await expect(status(page)).toHaveText("READY");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(status(page)).toHaveText("COMPLETED");
    await page.getByRole("button", { name: "Next movement", exact: true }).click();
    await openExperiment(page);
    await expect(experimentDrawer(page)).toBeVisible();
    await expect(page.locator(".architecture-side")).toBeVisible();
    await expectLegibleView(page, `${lesson.id} with a movement and the drawer`, { painted: true });
    // The movement detail goes under the graph, so the canvas keeps the panel's width.
    const widths = await page.evaluate(() => ({
      canvas: document.querySelector(".graph-canvas")!.getBoundingClientRect().width,
      panel: document.querySelector(".architecture-layout")!.getBoundingClientRect().width,
    }));
    expect(widths.canvas, `${lesson.id}: canvas width with the drawer open`).toBeGreaterThan(widths.panel - 2);
  }

  // Pick on graph keeps working with the drawer docked beside the stacked graph (the last lesson is clock-lamport).
  expect(scenarios.at(-1)?.id).toBe("clock-lamport");
  const region = faultsSection(page);
  await region.getByLabel("Fault", { exact: true }).selectOption("scheduled/crash");
  await region.getByRole("button", { name: "Pick on graph" }).click();
  await expect(region.getByRole("button", { name: "Stop picking" })).toHaveAttribute("aria-pressed", "true");
  // `eu` sits well clear of the pan controls at the canvas's top right; `us` lies partly under them at this size.
  await page.locator('.react-flow__node[data-id="eu"]').click();
  await expect(region.getByLabel("Target", { exact: true })).toHaveValue("component:eu");
});
