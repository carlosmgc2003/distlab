import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { budgets, measureLayout, viewports } from "./layout-budget.ts";
import type { BudgetLesson, BudgetState, BudgetViewport, LayoutBudget, LayoutMeasures } from "./layout-budget.ts";
import { loadLesson } from "./support/lesson.ts";

const lessons: readonly BudgetLesson[] = ["response-lost", "saga-uncompensated", "retry-unsafe"];

async function openLesson(page: Page, lesson: BudgetLesson) {
  await page.goto("/");
  await loadLesson(page, lesson);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await expect(page.getByRole("tab", { name: "Architecture", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
}

/** Measures once the shell has stopped moving: two consecutive readings agree. */
async function settledMeasures(page: Page, context: string): Promise<LayoutMeasures> {
  let previous = "";
  let measures = await measureLayout(page);
  await expect.poll(async () => {
    measures = await measureLayout(page);
    const current = JSON.stringify(measures);
    const settled = current === previous;
    previous = current;
    return settled;
  }, { message: `layout settles at ${context}`, intervals: [100, 200, 250] }).toBe(true);
  return measures;
}

function expectWithinBudget(measures: LayoutMeasures, budget: LayoutBudget, context: string) {
  const name = (measure: keyof LayoutMeasures, bound: string, value: number | boolean | string) =>
    `${measure} at ${context}: budget ${bound} ${value}, actual ${measures[measure]}`;
  expect.soft(measures.topBarHeight, name("topBarHeight", "≤", budget.topBarHeight.max)).toBeLessThanOrEqual(budget.topBarHeight.max);
  expect.soft(measures.canvasVisible, name("canvasVisible", "≥", budget.canvasVisible.min)).toBeGreaterThanOrEqual(budget.canvasVisible.min);
  expect.soft(measures.controlsOutsideGraph, name("controlsOutsideGraph", "≤", budget.controlsOutsideGraph.max)).toBeLessThanOrEqual(budget.controlsOutsideGraph.max);
  expect.soft(measures.proseBlocks, name("proseBlocks", "≤", budget.proseBlocks.max)).toBeLessThanOrEqual(budget.proseBlocks.max);
  if (budget.firstVerdictVisible !== undefined) {
    expect.soft(measures.firstVerdictVisible, name("firstVerdictVisible", "is a list:", "present")).not.toBeNull();
    if (budget.firstVerdictVisible) {
      expect.soft(measures.firstVerdictVisible, name("firstVerdictVisible", "=", true)).toBe(true);
    }
  }
}

for (const viewport of Object.keys(viewports) as BudgetViewport[]) {
  for (const lesson of lessons) {
    test(`layout budget: ${lesson} at ${viewport}, READY and COMPLETED`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewports[viewport]);
      await openLesson(page, lesson);
      const readings: Partial<Record<BudgetState, LayoutMeasures>> = {};

      readings.READY = await settledMeasures(page, `${lesson} READY ${viewport}`);
      expectWithinBudget(readings.READY, budgets[viewport][lesson].READY, `${lesson} READY ${viewport}`);

      await page.getByRole("button", { name: "Run", exact: true }).click();
      await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
      readings.COMPLETED = await settledMeasures(page, `${lesson} COMPLETED ${viewport}`);
      expectWithinBudget(readings.COMPLETED, budgets[viewport][lesson].COMPLETED, `${lesson} COMPLETED ${viewport}`);

      await testInfo.attach("layout-measures.json", { body: JSON.stringify(readings, null, 2), contentType: "application/json" });
      console.log(`layout-measures ${viewport} ${lesson} ${JSON.stringify(readings)}`);
    });
  }
}
