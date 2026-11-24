import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { projection } from "../tests/support.ts";
import { lessonChoice, lessonChooser, lessonTrigger, loadLesson } from "./support/lesson.ts";

declare global {
  interface Window {
    controlFixture: {
      commands: WorkerCommand[];
      emit: (event: WorkerEvent) => void;
      fail: () => void;
    };
  }
}

async function mount(page: Page) {
  await page.addInitScript(() => {
    window.controlFixture = { commands: [], emit: () => {}, fail: () => {} };
    window.Worker = class extends EventTarget {
      constructor() {
        super();
        window.controlFixture.emit = event => this.dispatchEvent(new MessageEvent("message", { data: event }));
        window.controlFixture.fail = () => this.dispatchEvent(new Event("error"));
      }
      postMessage(command: WorkerCommand) { window.controlFixture.commands.push(structuredClone(command)); }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  await loadLesson(page, "normal");
}

async function emitProjection(page: Page, status: RuntimeProjectionSet["simulation"]["status"], type: "loaded" | "projection.updated" = "projection.updated", correlated = true) {
  await page.evaluate(({ serialized, type, correlated }) => {
    const projection: RuntimeProjectionSet = JSON.parse(serialized);
    const requestId = window.controlFixture.commands.at(-1)!.requestId;
    window.controlFixture.emit(type === "loaded"
      ? { version: 1, type, requestId, projection, session: { lesson: "checkout-normal@1", seed: "mvp-normal-001", overlay: { version: 1, faults: [], scheduledFaults: [], parameters: [] }, origin: { kind: "packaged" as const } } }
      : { version: 1, type, ...(correlated ? { requestId } : {}), projection });
  }, { serialized: JSON.stringify(projection(status)), type, correlated });
}

async function enabled(page: Page, names: string[]) {
  for (const name of ["Run", "Back", "Step", "Reset"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled({ enabled: names.includes(name) });
  }
}

test("controls derive availability from every authoritative lifecycle and retain accessible names", async ({ page }) => {
  await mount(page);
  await enabled(page, []);
  await expect(lessonTrigger(page)).toBeDisabled();
  await expect(page.getByRole("status", { name: "Simulation status" })).toContainText("Loading");
  await emitProjection(page, "READY", "loaded");
  for (const [status, available] of [
    // A run that is executing takes no control; the browser never pauses it (RFC 0002 P1).
    ["READY", ["Run", "Step", "Reset"]], ["RUNNING", []],
    ["PAUSED", ["Run", "Step", "Reset"]], ["COMPLETED", ["Reset"]], ["FAILED", ["Reset"]],
  ] as const) {
    await emitProjection(page, status, "projection.updated", false);
    await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText(status);
    await enabled(page, [...available]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test("OT-PLAY-AC-1: the first Run sends one run, every control waits until it settles, and no optimistic status is shown", async ({ page }) => {
  await mount(page);
  await emitProjection(page, "READY", "loaded");
  const run = page.getByRole("button", { name: "Run", exact: true });
  await run.click();
  await enabled(page, []);
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY · Run in progress…");
  // A second press while the worker executes asks for nothing more.
  await run.click({ force: true });
  await emitProjection(page, "RUNNING");
  await enabled(page, []);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
  await emitProjection(page, "COMPLETED");
  await page.evaluate(() => {
    const run = window.controlFixture.commands.find(command => command.type === "run")!;
    window.controlFixture.emit({ version: 1, requestId: run.requestId, type: "run.finished", status: "COMPLETED" });
  });
  await expect(status).toHaveText("COMPLETED");
  // This fixture's run records no milestone, so the playhead is at the end at once.
  await enabled(page, ["Reset"]);
  expect(await page.evaluate(() => window.controlFixture.commands.map(command => command.type))).toEqual(["load", "run"]);
});

for (const terminal of ["COMPLETED", "FAILED"] as const) {
  test(`a ${terminal} projection before run.finished states the status alone and keeps controls busy (#193)`, async ({ page }) => {
    await mount(page);
    await emitProjection(page, "READY", "loaded");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    const status = page.getByRole("status", { name: "Simulation status" });
    await expect(status).toHaveText("READY · Run in progress…");
    await emitProjection(page, "RUNNING");
    await expect(status).toHaveText("RUNNING · Run in progress…");
    await emitProjection(page, terminal);
    await expect(status).toHaveText(terminal);
    // The command has not settled: Run, Step, and Reset stay unavailable until run.finished.
    await enabled(page, []);
    await page.evaluate(terminal => {
      const run = window.controlFixture.commands.find(command => command.type === "run")!;
      window.controlFixture.emit({ version: 1, requestId: run.requestId, type: "run.finished", status: terminal });
    }, terminal);
    await expect(status).toHaveText(terminal);
    await enabled(page, ["Reset"]);
  });
}

test("lesson selection cannot replace a pending or running session", async ({ page }) => {
  await mount(page);
  await emitProjection(page, "READY", "loaded");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const trigger = lessonTrigger(page);
  await expect(trigger).toBeDisabled();
  // A forced activation of the disabled trigger opens no chooser.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".lesson-trigger")!.click());
  await expect(lessonChooser(page)).toHaveCount(0);
  await emitProjection(page, "RUNNING");
  await expect(trigger).toBeDisabled();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".lesson-trigger")!.click());
  await expect(lessonChooser(page)).toHaveCount(0);
  await expect(trigger).toHaveText(/^Lesson: Normal checkout/);
  expect(await page.evaluate(() => window.controlFixture.commands.map(command => command.type))).toEqual(["load", "run"]);
});

test("a lesson choice cannot replace a session that starts running while the chooser is open", async ({ page }) => {
  await mount(page);
  await emitProjection(page, "READY", "loaded");
  await lessonTrigger(page).click();
  const choice = lessonChoice(page, "response-lost");
  await expect(choice).toBeEnabled();
  // The worker reports a run while the dialog is open: every lesson becomes unavailable.
  await emitProjection(page, "RUNNING", "projection.updated", false);
  await expect(choice).toBeDisabled();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-lesson-id='response-lost']")!.click());
  await expect(lessonChooser(page)).toBeVisible();
  expect(await page.evaluate(() => window.controlFixture.commands.map(command => command.type))).toEqual(["load"]);
});

test("the first Step sends run, Reset serializes after it; structured failure remains inspectable and reset recovers", async ({ page }) => {
  await mount(page);
  await emitProjection(page, "READY", "loaded");
  const step = page.getByRole("button", { name: "Step", exact: true });
  await page.getByRole("button", { name: "Run", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(step).toBeFocused();
  await expect(step).toHaveCSS("outline-style", "solid");
  await step.press("Enter");
  await enabled(page, []);
  await expect(page.getByRole("status", { name: "Simulation status" })).toContainText("Run in progress");
  await expect(step).toBeFocused();
  await step.press("Enter");
  // The first Step executes the whole run once; the browser never sends a step command.
  expect(await page.evaluate(() => window.controlFixture.commands.map(command => command.type))).toEqual(["load", "run"]);
  await emitProjection(page, "FAILED");
  await enabled(page, []);
  await page.evaluate(() => {
    window.controlFixture.emit({ version: 1, requestId: window.controlFixture.commands.at(-1)!.requestId, type: "error",
      error: { code: "SIMULATION_FAILED", message: "The simulation failed at an event boundary.", context: { code: "HANDLER_FAILED", eventId: "event:1" } } });
  });
  await enabled(page, ["Reset"]);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("FAILED");
  await expect(page.getByRole("alert")).toContainText("SIMULATION_FAILED");
  await page.getByText("Error details", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText('"eventId": "event:1"');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await enabled(page, []);
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("FAILED · Resetting scenario…");
  await emitProjection(page, "READY");
  await enabled(page, ["Run", "Step", "Reset"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a projectionless simulation failure stays FAILED until reset restores the scenario", async ({ page }) => {
  await mount(page);
  await emitProjection(page, "READY", "loaded");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.evaluate(() => {
    const requestId = window.controlFixture.commands.at(-1)!.requestId;
    window.controlFixture.emit({ version: 1, requestId, type: "error", error: {
      code: "SIMULATION_FAILED", message: "The simulation failed at an event boundary.", context: { code: "OBSERVATION_CAPACITY" },
    } });
  });
  await enabled(page, ["Reset"]);
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("FAILED");
  await expect(page.getByRole("alert")).toContainText("OBSERVATION_CAPACITY");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("FAILED · Resetting scenario…");
  await expect(page.getByRole("alert")).toContainText("SIMULATION_FAILED");
  await emitProjection(page, "READY");
  await enabled(page, ["Run", "Step", "Reset"]);
  await expect(status).toHaveText("READY");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("busy errors preserve lifecycle and transport failures require a fresh load", async ({ page }) => {
  await mount(page);
  await emitProjection(page, "READY", "loaded");
  await page.getByRole("button", { name: "Step", exact: true }).click();
  await page.evaluate(() => window.controlFixture.emit({ version: 1, requestId: window.controlFixture.commands.at(-1)!.requestId, type: "error",
    error: { code: "INVALID_WORKER_COMMAND", message: "A simulation control is already in progress.", context: { reason: "CONTROL_BUSY" } } }));
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await enabled(page, ["Run", "Step", "Reset"]);
  await page.getByText("Error details", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("CONTROL_BUSY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.evaluate(() => window.controlFixture.fail());
  await enabled(page, []);
  await expect(page.getByRole("alert")).toContainText("WORKER_UNAVAILABLE");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("Simulation unavailable.");
  await loadLesson(page, "normal");
  await emitProjection(page, "READY", "loaded");
  await enabled(page, ["Run", "Step", "Reset"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
