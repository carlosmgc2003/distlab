import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { simulationTime } from "@distlab/contracts";
import type { Observation, RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { projection } from "../tests/support.ts";
import { graphLaidOut, lessonTrigger, loadLesson } from "./support/lesson.ts";
import { applyMoreFilters, fillFilterField, filterByType, openMoreFilters, viewButton } from "./support/history.ts";

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
  await loadLesson(page, "response-lost");
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
  const commands = await commandTypes(page);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  // This test walks canonical rows; the Story view is covered in story-timeline.spec.ts.
  await viewButton(page, "Raw").click();

  await filterByType(page, "not.a.real.type");
  await expect(page.getByText("No observations match every active filter.")).toBeVisible();
  await expect(page.locator("#timeline-boundary")).toHaveText("No visible observations.");

  await page.getByRole("button", { name: "Clear all filters", exact: true }).click();
  await expect(page.getByRole("group", { name: "Active filters and reset" })).not.toBeVisible();
  await filterByType(page, "network.response.dropped");
  await expect(page.locator(".timeline-count")).toContainText(/^1 of /);
  await expect(page.locator("#timeline-boundary")).toContainText("Next and Previous select it.");
  await page.locator("#timeline-rows").focus();
  await page.keyboard.press("ArrowDown");

  const selected = page.locator("#timeline-rows button[aria-pressed='true']");
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText("network.response.dropped");
  const selectedText = await selected.innerText();
  const selectedSequence = selectedText.match(/#(\d+)/)?.[1];
  expect(selectedSequence).toBeDefined();
  await expect(selected).toBeFocused();
  await expect(selected).toBeInViewport();
  await expect(selected).toHaveCSS("outline-style", "solid");
  await expect(page.locator("#timeline-boundary")).toContainText("Previous and Next cannot move.");
  await expect(page.locator("#timeline-feedback")).toContainText(`Selected Observation #${selectedSequence}:`);
  await expect(page.locator("#inspection-panel")).toContainText("network.response.dropped");
  const sequence = await selected.innerText();
  await page.keyboard.press("ArrowDown");
  expect(await selected.innerText()).toBe(sequence);
  await expect(page.locator("#timeline-feedback")).toContainText("Previous and Next cannot move.");
  await page.keyboard.press("ArrowUp");
  expect(await selected.innerText()).toBe(sequence);

  await page.locator("#inspection-panel").getByText("Related evidence", { exact: true }).click();
  await page.getByRole("button", { name: "Show this trace" }).click();
  // More filters opens on the applied draft: the trace is set and the type was cleared.
  const dialog = await openMoreFilters(page);
  await dialog.getByLabel("Filter by", { exact: true }).selectOption("traceId");
  await expect(dialog.getByLabel("Trace", { exact: true })).not.toHaveValue("");
  await dialog.getByLabel("Filter by", { exact: true }).selectOption("type");
  await expect(dialog.getByLabel("Type", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#timeline-feedback")).toContainText("type filter was cleared");
  await expect(selected).toContainText("network.response.dropped");
  await expect(selected).toBeVisible();

  await page.getByRole("button", { name: /Select causing observation/ }).click();
  await expect(selected).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observation detail" })).toBeInViewport();
  await expect(page.locator("#timeline-feedback")).toContainText(/Selected Observation #/);
  await expect(selected).not.toContainText("network.response.dropped");

  await openMoreFilters(page);
  await dialog.getByLabel("Virtual time from", { exact: true }).fill("999999");
  await dialog.getByLabel("Virtual time to", { exact: true }).fill("0");
  await fillFilterField(page, "type", "network.response.dropped");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  // An invalid draft stays in the dialog with its error and changes nothing; Escape discards it.
  await expect(dialog.getByRole("alert")).toContainText("Virtual time from 999999 is after virtual time to 0");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // A valid filter that hides the evidence target: following the link clears it.
  await filterByType(page, "network.response.dropped");
  await page.locator("#timeline-rows").evaluate(node => { node.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  // Evidence navigation switches to history focus; reveal the command toolbar to reach the next link.
  await page.getByRole("button", { name: "Show simulation controls" }).click();
  // The evidence links sit in the Lesson panel's ③ Investigate section, visible on both tabs.
  await page.getByRole("complementary", { name: "Lesson", exact: true }).locator(".execution-overview")
    .getByRole("button", { name: "Show processor authorization", exact: true }).click();
  await expect(selected).toContainText("external.effect.committed");
  await expect(selected).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observation detail" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Observation detail" })).toContainText("external.effect.committed");
  await expect(page.locator("#timeline-feedback")).toContainText("Selected Observation #");
  await expect(page.locator("#timeline-feedback")).toContainText("The type filter was cleared so this observation is visible.");
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Clear empties the dialog's fields; Apply shows every record again.
  await openMoreFilters(page);
  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await applyMoreFilters(page);
  await expect(page.locator(".timeline-count")).toContainText(/^[0-9]{2,} of /);
  await page.locator("#timeline-rows").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("#timeline-boundary")).toContainText("Previous cannot move.");
  await page.keyboard.press("End");
  await expect(page.locator("#timeline-boundary")).toContainText("Next cannot move.");
  const atEnd = await selected.innerText();
  await page.keyboard.press("ArrowDown");
  expect(await selected.innerText()).toBe(atEnd);
  await expect(page.locator("#timeline-feedback")).toContainText("Next cannot move.");

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
  await expect(lessonTrigger(page)).toBeEnabled();
  await expect(page.locator("#timeline-rows")).toHaveCount(0);

  const emit = async (statusName: RuntimeProjectionSet["simulation"]["status"], observations: readonly Observation[], type: "loaded" | "projection.updated", correlated: boolean) => {
    const body = projection(statusName);
    const next: RuntimeProjectionSet = { ...body, history: { observations: [...observations] } };
    await page.evaluate(({ serialized, type, correlated }) => {
      const projection = JSON.parse(serialized) as RuntimeProjectionSet;
      const requestId = window.navigationFixture.commands.at(-1)!.requestId;
      window.navigationFixture.emit(type === "loaded"
        ? { version: 1, type, requestId, projection, session: { lesson: "checkout-normal@1", seed: "mvp-normal-001", overlay: { version: 1, faults: [], scheduledFaults: [], parameters: [] }, origin: { kind: "packaged" as const } } }
        : { version: 1, type, ...(correlated ? { requestId } : {}), projection });
    }, { serialized: JSON.stringify(next), type, correlated });
  };
  const history = [recorded("first", 1, "simulation.created"), recorded("middle", 2, "clock.advanced"), recorded("last", 3, "simulation.completed")];

  await loadLesson(page, "normal");
  await emit("READY", [], "loaded", true);
  await expect(status).toHaveText("READY");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  // Simulation commands are hidden in history focus; reveal them to check the lifecycle here.
  await page.getByRole("button", { name: "Show simulation controls" }).click();
  await expect(page.getByText("No observations have been recorded for this run.")).toBeVisible();
  await expect(page.locator("#timeline-boundary")).toHaveText("No visible observations.");
  await expect(button("Run")).toBeEnabled();
  await expect(button("Step")).toBeEnabled();
  await expect(button("Reset")).toBeEnabled();
  await expect(button("Pause")).toBeDisabled();

  await emit("READY", history, "projection.updated", false);
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.locator(".timeline-count")).toContainText("3 of 3");
  await page.locator("#timeline-rows").focus();
  await page.keyboard.press("Home");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("#1");
  await expect(page.locator("#timeline-boundary")).toContainText("Previous cannot move.");
  await page.keyboard.press("End");
  await expect(page.locator("#timeline-rows button[aria-pressed='true']")).toContainText("#3");
  await expect(page.locator("#timeline-boundary")).toContainText("Next cannot move.");
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  // Focus lands only on a shown node: wait until the graph is laid out and fitted again.
  await graphLaidOut(page);
  await page.getByRole("button", { name: "orders, Internal service" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "orders, Internal service" })).toHaveAttribute("aria-pressed", "true");
  await button("Fit View").click();
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();

  await emit("RUNNING", history, "projection.updated", false);
  await expect(status).toHaveText("RUNNING");
  await expect(lessonTrigger(page)).toBeDisabled();
  await expect(button("Pause")).toBeEnabled();
  for (const name of ["Run", "Step", "Reset"]) await expect(button(name)).toBeDisabled();

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
  await expect(page.locator(".run-summary")).toContainText("COMPLETED");
  await expect(page.getByText("Execution completed. Reset to run this scenario again.")).toHaveCount(0);

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
  await expect(lessonTrigger(page)).toBeEnabled();
  await expect(button("Reset")).toBeEnabled();
  for (const name of ["Run", "Pause", "Step"]) await expect(button(name)).toBeDisabled();
  await expect(page.getByRole("region", { name: "Architecture", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Distributed state", exact: true })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Timeline filters", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Timeline playback", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Terminal history" })).toContainText("incomplete");
  expect(await page.evaluate(() => window.navigationFixture.commands.map(command => command.type))).toEqual(["load", "step"]);
});
