import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { simulationTime } from "@distlab/contracts";
import type { Observation, RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { projection } from "../tests/support.ts";

declare global {
  interface Window {
    navigationEvidence: { commands: WorkerCommand[]; events: WorkerEvent[] };
    navigationFixture: { commands: WorkerCommand[]; emit: (event: WorkerEvent) => void };
  }
}

function recorded(id: string, sequence: number, type: string): Observation {
  return { schemaVersion: 1, id, time: simulationTime(sequence), sequence, type, source: "orders" };
}

async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.navigationEvidence = { commands: [], events: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.navigationEvidence.events.push(structuredClone(event.data)));
      }
      override postMessage(command: WorkerCommand) {
        window.navigationEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function commandTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => window.navigationEvidence.commands.map(command => command.type));
}

test("single dropped response disables both boundaries and evidence navigation keeps the destination", async ({ page }) => {
  test.setTimeout(90_000);
  await observeWorker(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const status = page.getByRole("status", { name: "Simulation status" });
  await page.getByLabel("Scenario", { exact: true }).selectOption("response-lost");
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  const commands = await commandTypes(page);

  await page.getByLabel("Type", { exact: true }).fill("not.a.real.type");
  await expect(page.getByText("No observations match every active filter.")).toBeVisible();
  await expect(page.locator("#timeline-boundary")).toHaveText("No visible observations.");
  for (const name of ["Previous observation", "Next observation", "Play timeline", "Pause timeline"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }

  await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear all filters", exact: true })).toBeDisabled();
  await page.getByLabel("Type", { exact: true }).fill("network.response.dropped");
  await expect(page.locator(".timeline-count")).toContainText(/^1 of /);
  await expect(page.getByRole("button", { name: "Next observation" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Previous observation" })).toBeEnabled();
  await expect(page.locator("#timeline-boundary")).toContainText("Next and Previous select it.");
  await page.getByRole("button", { name: "Next observation" }).click();

  const selected = page.locator("#timeline-rows button[aria-pressed='true']");
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText("#197");
  await expect(selected).toContainText("network.response.dropped");
  await expect(selected).toBeFocused();
  await expect(selected).toBeInViewport();
  await expect(selected).toHaveCSS("outline-style", "solid");
  await expect(page.getByRole("button", { name: "Next observation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous observation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeDisabled();
  await expect(page.locator("#timeline-boundary")).toContainText("Previous and Next cannot move.");
  await expect(page.locator("#timeline-feedback")).toContainText("Selected #197");
  await expect(page.getByRole("region", { name: "Observation detail" })).toContainText("network.response.dropped");
  const sequence = await selected.innerText();
  await page.keyboard.press("ArrowDown");
  expect(await selected.innerText()).toBe(sequence);
  await expect(page.locator("#timeline-feedback")).toContainText("Previous and Next cannot move.");
  await page.keyboard.press("ArrowUp");
  expect(await selected.innerText()).toBe(sequence);

  await page.getByRole("button", { name: "Show this trace" }).click();
  await expect(page.getByLabel("Trace", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("");
  await expect(page.locator("#timeline-feedback")).toContainText("type filter was cleared");
  await expect(selected).toContainText("network.response.dropped");
  await expect(selected).toBeFocused();
  await expect(selected).toBeInViewport();

  await page.getByRole("button", { name: /Select causing observation/ }).click();
  await expect(selected).toBeFocused();
  await expect(selected).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Observation detail" })).toBeInViewport();
  await expect(page.locator("#timeline-feedback")).toContainText(/Selected #/);
  await expect(selected).not.toContainText("network.response.dropped");

  await page.getByLabel("Virtual time from", { exact: true }).fill("999999");
  await page.getByLabel("Virtual time to", { exact: true }).fill("0");
  await page.getByLabel("Type", { exact: true }).fill("network.response.dropped");
  await expect(page.getByRole("alert")).toContainText("Virtual time from 999999 is after virtual time to 0");
  await page.locator("#timeline-rows").evaluate(node => { node.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  const raw = page.locator("details.raw-state");
  if ((await raw.getAttribute("open")) === null) await raw.locator("summary").click();
  await page.getByRole("button", { name: "Show processor authorization", exact: true }).click();
  await expect(selected).toContainText("external.effect.committed");
  await expect(selected).toBeFocused();
  await expect(selected).toBeInViewport();
  await expect(page.getByRole("heading", { name: "Observation detail" })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Observation detail" })).toContainText("external.effect.committed");
  await expect(page.locator("#timeline-feedback")).toContainText("Selected #");
  await expect(page.locator("#timeline-feedback")).toContainText("filters were cleared");
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.getByLabel("Trace", { exact: true }).fill("");
  await page.getByLabel("Type", { exact: true }).fill("");
  await expect(page.locator(".timeline-count")).toContainText(/^[0-9]{2,} of /);
  await page.locator("#timeline-rows").focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("button", { name: "Previous observation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next observation" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeEnabled();
  await expect(page.locator("#timeline-boundary")).toContainText("Previous cannot move.");
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Next observation" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous observation" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Restart timeline" })).toBeEnabled();
  await expect(page.locator("#timeline-boundary")).toContainText("Next cannot move.");
  const atEnd = await selected.innerText();
  await page.keyboard.press("ArrowDown");
  expect(await selected.innerText()).toBe(atEnd);
  await expect(page.locator("#timeline-feedback")).toContainText("Next cannot move.");

  await page.getByRole("button", { name: "Restart timeline" }).click();
  await expect(page.locator("#timeline-playback")).toContainText("Playing the visible timeline.");
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Play timeline" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Pause timeline" })).toBeEnabled();
  await page.getByRole("button", { name: "Pause timeline" }).click();
  await expect(page.locator("#timeline-playback")).toContainText("Playback is paused.");
  await expect(page.getByRole("button", { name: "Pause timeline" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play timeline" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await commandTypes(page)).toEqual(commands);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("timeline and simulation controls follow the lifecycle without extra worker commands", async ({ page }) => {
  await page.addInitScript(() => {
    window.navigationFixture = { commands: [], emit: () => {} };
    window.Worker = class extends EventTarget {
      constructor() {
        super();
        window.navigationFixture.emit = event => this.dispatchEvent(new MessageEvent("message", { data: event }));
      }
      postMessage(command: WorkerCommand) { window.navigationFixture.commands.push(structuredClone(command)); }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  const status = page.getByRole("status", { name: "Simulation status" });
  for (const name of ["Run", "Pause", "Step", "Reset"]) await expect(button(name)).toBeDisabled();
  await expect(button("Load scenario")).toBeEnabled();
  await expect(page.getByLabel("Scenario", { exact: true })).toBeEnabled();
  await expect(page.locator("#timeline-rows")).toHaveCount(0);

  const emit = async (statusName: RuntimeProjectionSet["simulation"]["status"], observations: readonly Observation[], type: "loaded" | "projection.updated", correlated: boolean) => {
    const body = projection(statusName);
    const next: RuntimeProjectionSet = { ...body, history: { observations: [...observations] } };
    await page.evaluate(({ serialized, type, correlated }) => {
      const projection = JSON.parse(serialized) as RuntimeProjectionSet;
      const requestId = window.navigationFixture.commands.at(-1)!.requestId;
      window.navigationFixture.emit(type === "loaded"
        ? { version: 1, type, requestId, projection }
        : { version: 1, type, ...(correlated ? { requestId } : {}), projection });
    }, { serialized: JSON.stringify(next), type, correlated });
  };
  const history = [recorded("first", 1, "simulation.created"), recorded("middle", 2, "clock.advanced"), recorded("last", 3, "simulation.completed")];

  await button("Load scenario").click();
  await emit("READY", [], "loaded", true);
  await expect(status).toHaveText("READY");
  await expect(page.getByText("No observations have been recorded for this run.")).toBeVisible();
  await expect(page.locator("#timeline-boundary")).toHaveText("No visible observations.");
  for (const name of ["Previous observation", "Next observation", "Play timeline", "Pause timeline"]) {
    await expect(button(name)).toBeDisabled();
  }
  await expect(button("Run")).toBeEnabled();
  await expect(button("Step")).toBeEnabled();
  await expect(button("Reset")).toBeEnabled();
  await expect(button("Pause")).toBeDisabled();

  await emit("READY", history, "projection.updated", false);
  await expect(page.locator(".timeline-count")).toContainText("3 of 3");
  await expect(button("Next observation")).toBeEnabled();
  await expect(button("Previous observation")).toBeEnabled();
  await button("Next observation").click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("#1");
  await expect(button("Previous observation")).toBeDisabled();
  await expect(button("Next observation")).toBeEnabled();
  await expect(page.locator("#timeline-boundary")).toContainText("Previous cannot move.");
  await page.locator("#timeline-rows").focus();
  await page.keyboard.press("End");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("#3");
  await expect(button("Next observation")).toBeDisabled();
  await expect(button("Restart timeline")).toBeEnabled();
  await page.getByRole("button", { name: "orders, Internal service" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "orders, Internal service" })).toHaveAttribute("aria-pressed", "true");
  await button("Fit View").click();

  await emit("RUNNING", history, "projection.updated", false);
  await expect(status).toHaveText("RUNNING");
  await expect(page.getByLabel("Scenario", { exact: true })).toBeDisabled();
  await expect(button("Load scenario")).toBeDisabled();
  await expect(button("Pause")).toBeEnabled();
  for (const name of ["Run", "Step", "Reset"]) await expect(button(name)).toBeDisabled();
  await button("Previous observation").click();
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("#2");

  await emit("PAUSED", history, "projection.updated", false);
  await expect(status).toHaveText("PAUSED");
  await expect(button("Run")).toBeEnabled();
  await expect(button("Step")).toBeEnabled();
  await expect(button("Reset")).toBeEnabled();
  await expect(button("Pause")).toBeDisabled();

  await emit("COMPLETED", history, "projection.updated", false);
  await expect(status).toHaveText("COMPLETED");
  await expect(button("Reset")).toBeEnabled();
  for (const name of ["Run", "Pause", "Step"]) await expect(button(name)).toBeDisabled();
  await expect(page.getByText("Execution completed. Reset to run this scenario again.")).toBeVisible();
  await page.locator("#timeline-rows").focus();
  await page.keyboard.press("End");
  await button("Restart timeline").click();
  await expect(page.locator("#timeline-playback")).toContainText("Playback reached the end", { timeout: 5_000 });
  await expect(button("Restart timeline")).toBeEnabled();
  await expect(button("Pause timeline")).toBeDisabled();
  await expect(page.locator("#timeline-feedback")).toContainText("Restart timeline plays from the first visible observation.");

  await emit("PAUSED", history, "projection.updated", false);
  await button("Step").click();
  await page.evaluate(() => {
    const requestId = window.navigationFixture.commands.at(-1)!.requestId;
    window.navigationFixture.emit({
      version: 1, type: "error", requestId,
      error: {
        code: "SIMULATION_FAILED", message: "The simulation failed at an event boundary.",
        context: { code: "HISTORY_LIMIT_EXCEEDED", historyComplete: false, time: 3, lastObservationId: "last" },
      },
    });
  });
  await expect(status).toContainText("FAILED");
  await expect(page.locator("#timeline-rows")).toHaveCount(0);
  await expect(page.getByLabel("Scenario", { exact: true })).toBeEnabled();
  await expect(button("Load scenario")).toBeEnabled();
  await expect(button("Reset")).toBeEnabled();
  for (const name of ["Run", "Pause", "Step"]) await expect(button(name)).toBeDisabled();
  await expect(page.getByRole("region", { name: "Architecture", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Distributed state", exact: true })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Timeline filters", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Timeline playback", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Terminal history" })).toContainText("incomplete");
  expect(await page.evaluate(() => window.navigationFixture.commands.map(command => command.type))).toEqual(["load", "step"]);
});
