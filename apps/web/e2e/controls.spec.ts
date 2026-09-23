import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";

declare global {
  interface Window {
    controlEvidence: { commands: WorkerCommand[]; events: WorkerEvent[] };
  }
}

async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.controlEvidence = { commands: [], events: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.controlEvidence.events.push(structuredClone(event.data)));
      }
      override postMessage(command: WorkerCommand) {
        window.controlEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function latestProjection(page: Page): Promise<RuntimeProjectionSet> {
  return page.evaluate(() => {
    const latest = window.controlEvidence.events.filter(event => "projection" in event).at(-1);
    if (!latest || !("projection" in latest)) throw new Error("Missing worker projection");
    return latest.projection;
  });
}

for (const scenario of ["normal", "response-lost"]) {
  test(`${scenario}: UI Run and repeated Step produce equal canonical worker exports`, async ({ page }, testInfo) => {
    await observeWorker(page);
    await page.goto("/");
    const status = page.getByRole("status", { name: "Simulation status" });
    const button = (name: string) => page.getByRole("button", { name, exact: true });
    for (const name of ["Run", "Pause", "Step", "Reset"]) await expect(button(name)).toBeDisabled();
    await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
    await button("Load scenario").click();
    await expect(status).toHaveText("READY");
    const initial = await latestProjection(page);
    await button("Run").click();
    await expect(status).toHaveText("COMPLETED");
    const run = await latestProjection(page);
    expect(run.simulation.processedEvents).toBeGreaterThan(16);
    const updates = await page.evaluate(() => window.controlEvidence.events.filter(event => event.type === "projection.updated").map(event => event.projection));
    expect(updates.some(item => item.simulation.status === "RUNNING")).toBe(true);
    // Every streamed sample is a prefix of the terminal canonical history.
    for (const update of updates) {
      expect(update.history.observations).toEqual(run.history.observations.slice(0, update.history.observations.length));
      expect(update.simulation.processedEvents).toBe(update.history.observations.filter(item => item.type === "scheduler.event.dispatched").length);
    }
    await expect(button("Run")).toBeDisabled();
    await expect(button("Step")).toBeDisabled();
    await expect(button("Pause")).toBeDisabled();
    await button("Reset").click();
    await expect(status).toHaveText("READY");
    expect(await latestProjection(page)).toEqual(initial);
    const count = run.simulation.processedEvents;
    for (let boundary = 1; boundary <= count; boundary++) {
      await button("Step").click();
      await expect(status).toHaveText(boundary === count ? "COMPLETED" : "PAUSED");
      const projection = await latestProjection(page);
      expect(projection.simulation.processedEvents).toBe(boundary);
      // Rendering, selection and viewport changes do not contribute canonical work.
      if (boundary === 1) {
        await button("Orders, Internal service").click();
        await button("Zoom In").click();
        await page.setViewportSize({ width: 390, height: 844 });
      }
    }
    expect(await latestProjection(page)).toEqual(run);
    await button("Reset").click();
    await expect(status).toHaveText("READY");
    expect(await latestProjection(page)).toEqual(initial);
    await expect(page.getByRole("complementary", { name: "Component inspector" })).toContainText("Database owned by orders");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("simulation-controls-mobile.png"), fullPage: true });
  });
}

test("Load → Run/Pause → Step → Reset uses correlated boundary commands", async ({ page }, testInfo) => {
  await observeWorker(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load scenario" }).click();
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY");
  const initial = await latestProjection(page);
  // Submit both user actions in one browser task, so this tiny fixture cannot
  // finish while Playwright makes its next round trip. Both go through React + host.
  await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll("button")];
    buttons.find(button => button.textContent === "Run")!.click();
    await Promise.resolve();
    buttons.find(button => button.textContent === "Pause")!.click();
  });
  await expect(status).toHaveText("PAUSED");
  const paused = await latestProjection(page);
  expect(paused.simulation.processedEvents).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await expect(status).toHaveText("PAUSED");
  expect((await latestProjection(page)).simulation.processedEvents).toBe(paused.simulation.processedEvents + 1);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("READY");
  expect(await latestProjection(page)).toEqual(initial);
  expect(await page.evaluate(() => window.controlEvidence.commands.map(command => command.type))).toEqual(["load", "run", "pause", "step", "reset"]);
  await page.screenshot({ path: testInfo.outputPath("simulation-controls.png"), fullPage: true });
});
