import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { projection } from "../tests/support.ts";

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
  await page.getByRole("button", { name: "Load scenario" }).click();
}

async function emitProjection(page: Page, status: RuntimeProjectionSet["simulation"]["status"], type: "loaded" | "projection.updated" = "projection.updated", correlated = true) {
  await page.evaluate(({ serialized, type, correlated }) => {
    const projection: RuntimeProjectionSet = JSON.parse(serialized);
    const requestId = window.controlFixture.commands.at(-1)!.requestId;
    window.controlFixture.emit(type === "loaded"
      ? { version: 1, type, requestId, projection }
      : { version: 1, type, ...(correlated ? { requestId } : {}), projection });
  }, { serialized: JSON.stringify(projection(status)), type, correlated });
}

async function enabled(page: Page, names: string[]) {
  for (const name of ["Run", "Pause", "Step", "Reset"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeEnabled({ enabled: names.includes(name) });
  }
}

test("controls derive availability from every authoritative lifecycle and retain accessible names", async ({ page }) => {
  await mount(page);
  await enabled(page, []);
  await expect(page.getByRole("button", { name: "Load scenario" })).toBeDisabled();
  await expect(page.getByRole("status", { name: "Simulation status" })).toContainText("Loading");
  await emitProjection(page, "READY", "loaded");
  for (const [status, available] of [
    ["READY", ["Run", "Step", "Reset"]], ["RUNNING", ["Pause"]],
    ["PAUSED", ["Run", "Step", "Reset"]], ["COMPLETED", ["Reset"]], ["FAILED", ["Reset"]],
  ] as const) {
    await emitProjection(page, status, "projection.updated", false);
    await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText(status);
    await enabled(page, [...available]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test("outstanding Run/Pause stays busy until both terminal replies and uses no optimistic status", async ({ page }) => {
  await mount(page);
  await emitProjection(page, "READY", "loaded");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await enabled(page, ["Pause"]);
  const status = page.getByRole("status", { name: "Simulation status" });
  await expect(status).toHaveText("READY · Run in progress…");
  await emitProjection(page, "RUNNING");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await enabled(page, []);
  await expect(status).toHaveText("RUNNING · Pause requested; waiting for an event boundary…");
  await page.evaluate(() => {
    const run = window.controlFixture.commands.find(command => command.type === "run")!;
    window.controlFixture.emit({ version: 1, requestId: run.requestId, type: "run.finished", status: "PAUSED" });
  });
  await enabled(page, []);
  await expect(status).toContainText("RUNNING");
  await emitProjection(page, "PAUSED");
  await expect(status).toHaveText("PAUSED");
  await enabled(page, ["Run", "Step", "Reset"]);
  expect(await page.evaluate(() => window.controlFixture.commands.map(command => command.type))).toEqual(["load", "run", "pause"]);
});

test("Step and Reset serialize commands; structured failure remains inspectable and reset recovers", async ({ page }) => {
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
  await expect(page.getByRole("status", { name: "Simulation status" })).toContainText("Stepping one event");
  await expect(step).toBeFocused();
  await step.press("Enter");
  expect(await page.evaluate(() => window.controlFixture.commands.filter(command => command.type === "step").length)).toBe(1);
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
  await page.getByRole("button", { name: "Load scenario" }).click();
  await emitProjection(page, "READY", "loaded");
  await enabled(page, ["Run", "Step", "Reset"]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
