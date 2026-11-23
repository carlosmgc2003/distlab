import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { loadLesson } from "./support/lesson.ts";

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

const playhead = (page: Page) => page.getByRole("status", { name: "Playhead position" });
const button = (page: Page, name: string) => page.getByRole("group", { name: "Simulation execution" }).getByRole("button", { name, exact: true });

for (const scenario of ["normal", "response-lost"]) {
  test(`${scenario}: UI Run and the first Step execute the same canonical run, and later controls do no canonical work`, async ({ page }, testInfo) => {
    await observeWorker(page);
    await page.goto("/");
    const status = page.getByRole("status", { name: "Simulation status" });
    for (const name of ["Run", "Back", "Step", "Reset"]) await expect(button(page, name)).toBeDisabled();
    await loadLesson(page, scenario);
    await expect(status).toHaveText("READY");
    const initial = await latestProjection(page);
    // Animation off: Run executes the run and puts the playhead on the last milestone at once.
    await page.getByRole("switch", { name: "Animation" }).uncheck();
    await button(page, "Run").click();
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
    await expect(playhead(page)).toHaveText(/^Milestone (\d+) of \1 /);
    await expect(button(page, "Run")).toBeDisabled();
    await expect(button(page, "Step")).toBeDisabled();
    await expect(button(page, "Back")).toBeEnabled();
    await button(page, "Reset").click();
    await expect(status).toHaveText("READY");
    expect(await latestProjection(page)).toEqual(initial);
    // The first Step executes the same run once and stands on the first milestone.
    await button(page, "Step").click();
    await expect(status).toHaveText("COMPLETED");
    expect(await latestProjection(page)).toEqual(run);
    await expect(playhead(page)).toHaveText(/^Milestone 1 of /);
    const total = Number((await playhead(page).innerText()).match(/of (\d+)/)![1]);
    for (let milestone = 2; milestone <= total; milestone++) {
      await button(page, "Step").click();
      await expect(playhead(page)).toHaveText(new RegExp(`^Milestone ${milestone} of ${total} `));
      // Rendering, selection and viewport changes do not contribute canonical work.
      if (milestone === 2) {
        await page.getByRole("button", { name: "Orders, Internal service" }).click();
        await page.getByRole("button", { name: "Zoom In" }).click();
        await page.setViewportSize({ width: 683, height: 384 });
      }
    }
    await expect(button(page, "Step")).toBeDisabled();
    expect(await latestProjection(page)).toEqual(run);
    expect(await page.evaluate(() => window.controlEvidence.commands.map(command => command.type))).toEqual(["load", "run", "reset", "run"]);
    await button(page, "Reset").click();
    await expect(status).toHaveText("READY");
    expect(await latestProjection(page)).toEqual(initial);
    await page.getByRole("tab", { name: "Architecture", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Component inspector" })).toContainText("Database owned by Orders");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("simulation-controls-zoom.png"), fullPage: true });
  });
}

test("OT-PLAY-AC-1 and OT-PLAY-AC-7: after the first Run, Pause, Run, Step, Back, and the keys send nothing; Reset sends reset and returns the playhead to the start", async ({ page }, testInfo) => {
  await observeWorker(page);
  await page.goto("/");
  await loadLesson(page, "normal");
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY");
  const initial = await latestProjection(page);
  await page.getByRole("combobox", { name: "Speed" }).selectOption("fast");
  await button(page, "Run").click();
  await expect(status).toHaveText("COMPLETED");
  // Run reads Pause while the playhead plays, in the same place.
  await button(page, "Pause").click();
  await expect(button(page, "Continue")).toBeVisible();
  const paused = await playhead(page).innerText();
  await button(page, "Continue").click();
  await button(page, "Pause").click();
  await button(page, "Step").click();
  await button(page, "Back").click();
  // The keys do what their buttons do, from neutral ground.
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  expect(paused).toMatch(/^Milestone \d+ of \d+ /);
  expect(await page.evaluate(() => window.controlEvidence.commands.map(command => command.type))).toEqual(["load", "run"]);
  await button(page, "Reset").click();
  await expect(status).toHaveText("READY");
  expect(await latestProjection(page)).toEqual(initial);
  await expect(page.locator(".flight-narration")).toHaveCount(0);
  await expect(button(page, "Back")).toBeDisabled();
  await expect(button(page, "Run")).toBeEnabled();
  expect(await page.evaluate(() => window.controlEvidence.commands.map(command => command.type))).toEqual(["load", "run", "reset"]);
  await page.screenshot({ path: testInfo.outputPath("simulation-controls.png"), fullPage: true });
});
