import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";
import { normalCheckout } from "@distlab/catalogs";
import { projection } from "../tests/support.ts";

declare global {
  interface Window {
    breakEvidence: { commands: WorkerCommand[]; events: WorkerEvent[] };
    breakFixture: { commands: WorkerCommand[]; emit: (event: WorkerEvent) => void };
  }
}

async function captureWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.breakEvidence = { commands: [], events: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.breakEvidence.events.push(structuredClone(event.data)));
      }
      override postMessage(command: WorkerCommand) {
        window.breakEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}
const latestProjection = (page: Page): Promise<RuntimeProjectionSet> => page.evaluate(() => {
  const event = window.breakEvidence.events.filter(item => "projection" in item).at(-1);
  if (!event || !("projection" in event)) throw new Error("No worker projection received");
  return event.projection;
});
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const panel = (page: Page) => page.getByRole("region", { name: "Break the system" });

async function load(page: Page, scenario: string) {
  await page.goto("/");
  await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
  await button(page, "Load scenario").click();
  await expect(status(page)).toHaveText("READY");
}

async function addDropResponse(page: Page) {
  const region = panel(page);
  await region.getByLabel("Fault", { exact: true }).selectOption("network.response/drop");
  await region.getByLabel("Target", { exact: true }).selectOption({ label: "payment-processor → payments" });
  await region.getByLabel("Only occurrence number (optional)").fill("1");
  await region.getByRole("button", { name: "Add fault", exact: true }).click();
}

test("a student drop-response fault on Normal checkout reproduces the lost-response story, and Reset replays it", async ({ page }) => {
  test.setTimeout(90_000);
  await captureWorker(page);
  await page.setViewportSize({ width: 1534, height: 897 });
  await load(page, "normal");
  await button(page, "Add or change faults").click();
  await addDropResponse(page);
  const chips = panel(page).getByRole("list", { name: "Student faults" });
  await expect(chips).toContainText("student-fault-1 Drop response · payment-processor → payments · occurrence 1 · not applied yet");
  await expect(panel(page)).toContainText("The draft is not applied yet.");
  await button(page, "Apply faults and reload").click();
  await expect(status(page)).toHaveText("READY");
  await expect(chips).toContainText("· applied");
  await expect(page.getByLabel("Run identity")).toContainText("Seed mvp-normal-001 · 1 student fault · run ");

  // The panel sent one ordinary load: the exact packaged document plus the overlay.
  const loads = await page.evaluate(() => window.breakEvidence.commands.filter(command => command.type === "load"));
  const last = loads.at(-1)!;
  expect(last.type === "load" && last.scenario).toEqual(normalCheckout);
  expect(last.type === "load" && last.overlay).toEqual({ version: 1, faults: [{ id: "student-fault-1", point: "network.response", source: "payment-processor", target: "payments", from: 0, occurrence: 1, probability: 1, maxApplications: 1, effect: { kind: "drop" } }], scheduledFaults: [], parameters: [] });
  // The faulted link carries a broken-link mark.
  await expect(page.locator(".react-flow__edge.has-fault")).toHaveCount(1);

  await button(page, "Run").click();
  await expect(status(page)).toHaveText("COMPLETED");
  const finished = await latestProjection(page);
  const matched = finished.history.observations.filter(item => item.type === "fault.rule.matched").map(item => (item.data as { ruleId: string }).ruleId);
  expect(matched).toEqual(["student-fault-1"]);
  const types = finished.history.observations.map(item => item.type);
  expect(types).toContain("network.response.dropped");
  expect(finished.history.observations.some(item => item.type === "network.request.timedout" && item.source === "payments")).toBe(true);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await expect(page.locator("#history-panel")).toContainText("Response dropped");
  await expect(page.locator("#history-panel")).toContainText("timed out");

  // Reset replays the applied overlay: the same inputs, runId, and history.
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await button(page, "Reset").click();
  await expect(status(page)).toHaveText("READY");
  expect(await page.evaluate(() => window.breakEvidence.commands.at(-1))).toEqual(expect.objectContaining({ type: "reset" }));
  await button(page, "Run").click();
  await expect(status(page)).toHaveText("COMPLETED");
  expect(await latestProjection(page)).toEqual(finished);
});

test("an invalid fault is reported inline from contract validation and can be fixed", async ({ page }) => {
  await captureWorker(page);
  await load(page, "normal");
  await button(page, "Add or change faults").click();
  const region = panel(page);
  await region.getByLabel("Fault", { exact: true }).selectOption("network.request/delay");
  await region.getByLabel("Target", { exact: true }).selectOption({ label: "customer-app → orders" });
  // Text without a contract value is caught in the field before it reaches the draft.
  await region.getByLabel("Delay duration").fill("soon");
  await region.getByRole("button", { name: "Add fault", exact: true }).click();
  await expect(region.getByLabel("Delay duration")).toHaveAttribute("aria-invalid", "true");
  await expect(region).toContainText("Enter a whole number.");
  await region.getByLabel("Delay duration").fill("40");
  await region.getByLabel("From virtual time").fill("10");
  await region.getByLabel("Until virtual time (optional, exclusive)").fill("5");
  await region.getByRole("button", { name: "Add fault", exact: true }).click();
  await button(page, "Apply faults and reload").click();
  // The worker rejects the empty time window; the draft stays editable with the diagnostic on its field.
  await expect(page.getByRole("alert")).toContainText("INVALID_OVERLAY");
  await expect(region.locator(".fault-chip-errors")).toContainText("Until virtual time (optional, exclusive): This value breaks a fault rule");
  await region.getByRole("button", { name: "Edit student-fault-1" }).click();
  await expect(region.getByLabel("Until virtual time (optional, exclusive)")).toHaveValue("5");
  await region.getByLabel("Until virtual time (optional, exclusive)").fill("50");
  await region.getByRole("button", { name: "Update fault", exact: true }).click();
  await button(page, "Apply faults and reload").click();
  await expect(status(page)).toHaveText("READY");
  await expect(region.locator(".fault-chip-errors")).toHaveCount(0);
  await expect(region.getByRole("list", { name: "Student faults" })).toContainText("Delay request by 40 · customer-app → orders · t=10–50");
});

test("keyboard users can add, inspect, and remove a fault, and the open panel has no axe violations", async ({ page }) => {
  await captureWorker(page);
  await load(page, "normal");
  const toggle = button(page, "Add or change faults");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(button(page, "Hide fault editor")).toHaveAttribute("aria-expanded", "true");
  const region = panel(page);
  const kind = region.getByLabel("Fault", { exact: true });
  await kind.focus();
  await kind.selectOption("scheduled/crash");
  await region.getByLabel("Target", { exact: true }).selectOption("component:payments");
  await region.getByLabel("At virtual time").fill("15");
  await region.getByRole("button", { name: "Add fault", exact: true }).focus();
  await page.keyboard.press("Enter");
  const chips = region.getByRole("list", { name: "Student faults" });
  await expect(chips).toContainText("Crash service · payments · at t=15");
  await expect(page.getByRole("status").filter({ hasText: "Added to the draft" })).toHaveCount(1);
  expect((await new AxeBuilder({ page }).include(".break-panel").analyze()).violations).toEqual([]);
  await region.getByRole("button", { name: "Edit student-fault-1" }).focus();
  await page.keyboard.press("Enter");
  await expect(region.getByLabel("At virtual time")).toHaveValue("15");
  await expect(region.getByRole("heading", { name: "Edit student-fault-1" })).toBeVisible();
  await region.getByRole("button", { name: "Remove student-fault-1" }).focus();
  await page.keyboard.press("Enter");
  await expect(chips).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the graph picks a fault target, and a lesson offers only the fault kinds it allows", async ({ page }) => {
  await load(page, "normal");
  await button(page, "Add or change faults").click();
  const region = panel(page);
  await region.getByLabel("Fault", { exact: true }).selectOption("scheduled/crash");
  await region.getByRole("button", { name: "Pick on graph" }).click();
  await expect(region.getByRole("button", { name: "Stop picking" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".react-flow__node").filter({ hasText: "Payments" }).first().click();
  await expect(region.getByLabel("Target", { exact: true })).toHaveValue("component:payments");
  await expect(region.getByRole("button", { name: "Pick on graph" })).toHaveAttribute("aria-pressed", "false");

  const offered = async () => region.getByLabel("Fault", { exact: true }).locator("option").allTextContents();
  expect(await offered()).toContain("Duplicate message delivery");
  expect(await offered()).not.toContain("Change external service availability");
  await page.getByLabel("Scenario", { exact: true }).selectOption("retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  // Choosing another lesson starts from an empty draft; the editor stays open.
  await expect(button(page, "Hide fault editor")).toBeVisible();
  expect(await offered()).not.toContain("Duplicate message delivery");
  await page.getByLabel("Scenario", { exact: true }).selectOption("saga-compensated");
  await expect(status(page)).toHaveText("READY");
  expect(await offered()).toContain("Change external service availability");
  expect(await offered()).not.toContain("Crash service");
});

test("fault controls are unavailable while the simulation runs", async ({ page }) => {
  await page.addInitScript(() => {
    window.breakFixture = { commands: [], emit: () => {} };
    window.Worker = class extends EventTarget {
      constructor() {
        super();
        window.breakFixture.emit = event => this.dispatchEvent(new MessageEvent("message", { data: event }));
      }
      postMessage(command: WorkerCommand) { window.breakFixture.commands.push(structuredClone(command)); }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  await button(page, "Load scenario").click();
  const emit = (state: RuntimeProjectionSet["simulation"]["status"], type: "loaded" | "projection.updated") => page.evaluate(({ serialized, type }) => {
    const projection = JSON.parse(serialized) as RuntimeProjectionSet;
    const requestId = window.breakFixture.commands.at(-1)!.requestId;
    const session = { lesson: "checkout-normal@1", seed: "mvp-normal-001", overlay: { version: 1 as const, faults: [], scheduledFaults: [], parameters: [] } };
    window.breakFixture.emit(type === "loaded" ? { version: 1, type, requestId, projection, session } : { version: 1, type, projection });
  }, { serialized: JSON.stringify(projection(state)), type });
  await emit("READY", "loaded");
  await button(page, "Add or change faults").click();
  const region = panel(page);
  await region.getByLabel("Fault", { exact: true }).selectOption("scheduled/crash");
  await region.getByLabel("Target", { exact: true }).selectOption("component:orders");
  await region.getByRole("button", { name: "Add fault", exact: true }).click();
  await expect(button(page, "Apply faults and reload")).toBeEnabled();
  await emit("RUNNING", "projection.updated");
  await expect(region).toContainText("Fault controls are unavailable while the simulation runs");
  for (const name of ["Apply faults and reload", "Add fault", "Edit student-fault-1", "Remove student-fault-1"]) {
    await expect(region.getByRole("button", { name })).toBeDisabled();
  }
  await expect(region.getByLabel("Fault", { exact: true })).toBeDisabled();
  const sent = await page.evaluate(() => window.breakFixture.commands.map(command => command.type));
  expect(sent).toEqual(["load"]);
  await emit("PAUSED", "projection.updated");
  await expect(button(page, "Apply faults and reload")).toBeEnabled();
});
