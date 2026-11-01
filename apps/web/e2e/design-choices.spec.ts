import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand } from "@distlab/contracts";
import { commerceScenario } from "@distlab/catalogs";
import { projection } from "../tests/support.ts";

declare global {
  interface Window {
    choiceCommands: WorkerCommand[];
    choiceFixture: { commands: WorkerCommand[]; emit: (event: unknown) => void };
  }
}

async function captureCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.choiceCommands = [];
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.choiceCommands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const panel = (page: Page) => page.getByRole("region", { name: "Design choices" });
const checks = (page: Page) => page.getByRole("region", { name: "Commerce lesson state", exact: true }).getByRole("list", { name: "Lesson checks", exact: true });
const runId = (page: Page) => page.getByLabel("Run identity").innerText().then(text => /run (\w+)$/.exec(text)?.[1]);

async function load(page: Page, scenario: string) {
  await page.goto("/");
  await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
  await button(page, "Load scenario").click();
  await expect(status(page)).toHaveText("READY");
}
async function openChoices(page: Page) {
  await panel(page).getByRole("button", { name: "Change design choices" }).click();
}
async function runToEnd(page: Page) {
  await button(page, "Run").click();
  await expect(status(page)).toHaveText("COMPLETED");
}

test("switching idempotency on in the retry lesson changes the check outcome, and switching it off restores the packaged run", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await captureCommands(page);
  await load(page, "retry-unsafe");
  const packagedRun = await runId(page);
  await runToEnd(page);
  await expect(checks(page)).toContainText("PASS — processed-payments");

  await expect(panel(page).getByLabel("Idempotency key")).toBeHidden();
  await openChoices(page);
  const idempotency = panel(page).getByLabel("Idempotency key");
  await expect(idempotency).not.toBeChecked();
  await expect(panel(page)).toContainText("Lesson default: off.");
  await idempotency.check();
  await expect(panel(page)).toContainText("These choices are not applied yet.");
  await button(page, "Apply choices and reload").click();
  await expect(status(page)).toHaveText("READY");
  await expect(page.getByLabel("Run identity")).toContainText("Seed commerce-classroom-1 · idempotency=on · packaged faults only · run ");
  await expect(panel(page)).toContainText("Idempotency key: on");
  await expect(panel(page)).not.toContainText("not applied yet");

  // One ordinary load: the exact packaged document plus the parameter override.
  const last = await page.evaluate(() => window.choiceCommands.filter(command => command.type === "load").at(-1));
  expect(last?.type === "load" && last.scenario).toEqual(commerceScenario("retry-unsafe"));
  expect(last?.type === "load" && last.overlay).toEqual({ version: 1, faults: [], scheduledFaults: [], parameters: [{ key: "idempotency", value: true }] });

  await runToEnd(page);
  // The packaged check expects the unsafe story's two payments; idempotency leaves one.
  await expect(checks(page)).toContainText("FAIL — processed-payments");
  await expect(panel(page)).toContainText("a check can FAIL under your choices");
  await page.screenshot({ path: testInfo.outputPath("design-choices-applied.png") });

  // Reset replays the applied choice.
  const modifiedRun = await runId(page);
  await button(page, "Reset").click();
  await expect(status(page)).toHaveText("READY");
  expect(await runId(page)).toBe(modifiedRun);
  await runToEnd(page);
  await expect(checks(page)).toContainText("FAIL — processed-payments");

  // Back to the default: the overlay is empty again and the run is the packaged run.
  await idempotency.uncheck();
  await button(page, "Restore lesson design and reload").click();
  await expect(status(page)).toHaveText("READY");
  expect(await runId(page)).toBe(packagedRun);
  await expect(page.getByLabel("Run identity")).not.toContainText("idempotency=");
});

test("an out-of-range timeout is caught inline, and the panel has no axe violations", async ({ page }) => {
  test.setTimeout(90_000);
  await load(page, "retry-unsafe");
  await openChoices(page);
  const timeout = panel(page).getByLabel("Client timeout");
  await expect(timeout).toHaveValue("20");
  await timeout.fill("0");
  await expect(timeout).toHaveAttribute("aria-invalid", "true");
  await expect(panel(page)).toContainText("Enter a whole number from 1 to 60.");
  await expect(button(page, "Apply choices and reload")).toBeDisabled();
  await timeout.fill("40");
  await expect(timeout).not.toHaveAttribute("aria-invalid", "true");
  await button(page, "Apply choices and reload").click();
  await expect(status(page)).toHaveText("READY");
  await expect(page.getByLabel("Run identity")).toContainText("timeout=40");

  const results = await new AxeBuilder({ page }).include(".design-choices").analyze();
  expect(results.violations).toEqual([]);

  // A lesson without design choices shows no panel.
  await page.getByLabel("Scenario", { exact: true }).selectOption("cqrs-delayed");
  await expect(status(page)).toHaveText("READY");
  await expect(panel(page)).toHaveCount(0);
});

test("Compare drops the choice the pair compares and keeps the shared one", async ({ page }) => {
  test.setTimeout(90_000);
  await load(page, "retry-unsafe");
  await openChoices(page);
  await panel(page).getByLabel("Idempotency key").check();
  await panel(page).getByLabel("Client timeout").fill("40");
  await button(page, "Apply choices and reload").click();
  await expect(status(page)).toHaveText("READY");
  await button(page, "Compare: Retry with idempotency").click();
  await expect(status(page)).toHaveText("READY");
  await expect(page.getByText("Compare kept 0 student faults, kept timeout=40 and dropped idempotency.")).toBeVisible();
  // The panel stays open, and the paired lesson's own default for idempotency is on.
  await expect(panel(page).getByLabel("Idempotency key")).toBeChecked();
  await expect(panel(page).getByLabel("Client timeout")).toHaveValue("40");
});

test("design choices are unavailable while the simulation runs", async ({ page }) => {
  await page.addInitScript(() => {
    window.choiceFixture = { commands: [], emit: () => {} };
    window.Worker = class extends EventTarget {
      constructor() {
        super();
        window.choiceFixture.emit = event => this.dispatchEvent(new MessageEvent("message", { data: event }));
      }
      postMessage(command: WorkerCommand) { window.choiceFixture.commands.push(structuredClone(command)); }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  await page.getByLabel("Scenario", { exact: true }).selectOption("retry-unsafe");
  await button(page, "Load scenario").click();
  const emit = (state: RuntimeProjectionSet["simulation"]["status"], type: "loaded" | "projection.updated") => page.evaluate(({ serialized, type }) => {
    const projection = JSON.parse(serialized) as RuntimeProjectionSet;
    const requestId = window.choiceFixture.commands.at(-1)!.requestId;
    const session = { lesson: "retry-unsafe@1", seed: "commerce-classroom-1", overlay: { version: 1 as const, faults: [], scheduledFaults: [], parameters: [] }, origin: { kind: "packaged" as const } };
    window.choiceFixture.emit(type === "loaded" ? { version: 1, type, requestId, projection, session } : { version: 1, type, projection });
  }, { serialized: JSON.stringify(projection(state)), type });
  await emit("READY", "loaded");
  const region = panel(page);
  await openChoices(page);
  await region.getByLabel("Idempotency key").check();
  await expect(button(page, "Apply choices and reload")).toBeEnabled();
  await emit("RUNNING", "projection.updated");
  await expect(region).toContainText("Design choices are unavailable while the simulation runs");
  await expect(region.getByLabel("Idempotency key")).toBeDisabled();
  await expect(region.getByLabel("Client timeout")).toBeDisabled();
  await expect(button(page, "Apply choices and reload")).toBeDisabled();
  await expect(button(page, "Discard choice changes")).toBeDisabled();
  expect(await page.evaluate(() => window.choiceFixture.commands.map(command => command.type))).toEqual(["load"]);
  await emit("PAUSED", "projection.updated");
  await expect(button(page, "Apply choices and reload")).toBeEnabled();
});
