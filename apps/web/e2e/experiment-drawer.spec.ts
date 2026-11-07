import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand } from "@distlab/contracts";
import { commerceScenario } from "@distlab/catalogs";
import { projection } from "../tests/support.ts";
import { loadLesson } from "./support/lesson.ts";
import { applyAndRestart, choicesSection, experimentDrawer, experimentTrigger, faultsSection, openExperiment } from "./support/experiment.ts";

declare global {
  interface Window {
    drawerCommands: WorkerCommand[];
    drawerFixture: { commands: WorkerCommand[]; emit: (event: unknown) => void };
  }
}

const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const runIdentity = (page: Page) => page.getByLabel("Run identity");
const loads = (page: Page) => page.evaluate(() => window.drawerCommands.filter(command => command.type === "load"));

async function captureCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.drawerCommands = [];
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.drawerCommands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function addCrash(page: Page, at: string) {
  const faults = faultsSection(page);
  await faults.getByLabel("Fault", { exact: true }).selectOption("scheduled/crash");
  await faults.getByLabel("Target", { exact: true }).selectOption({ index: 1 });
  await faults.getByLabel("At virtual time").fill(at);
  await faults.getByRole("button", { name: "Add fault", exact: true }).click();
}

test("one control applies the draft, only while the drawer is open, and the editors live only in the drawer", async ({ page }) => {
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  const apply = page.getByRole("button", { name: /apply/i });
  // Closed: no Apply anywhere, no Break bar in the Architecture tab, and no Design choices outside the drawer.
  await expect(apply).toHaveCount(0);
  await expect(page.locator("#architecture-panel").getByRole("region", { name: /Faults|Break the system/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Design choices", exact: true })).toHaveCount(0);
  await expect(page.locator(".break-panel")).toHaveCount(0);
  await openExperiment(page);
  await expect(apply).toHaveCount(1);
  await expect(apply).toHaveAccessibleName("Apply and restart");
  await expect(page.getByRole("region", { name: "Design choices", exact: true })).toHaveCount(1);
  await expect(choicesSection(page)).toHaveCount(1);
  await experimentDrawer(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(apply).toHaveCount(0);
});

test("a design choice and a fault are applied together by one load", async ({ page }) => {
  test.setTimeout(90_000);
  await captureCommands(page);
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await expect(status(page)).toHaveText("READY");
  const packagedRun = await runIdentity(page).innerText();
  await openExperiment(page);
  await choicesSection(page).getByLabel("Idempotency key").check();
  await addCrash(page, "5");
  await expect(experimentTrigger(page)).toHaveAccessibleName("Change the experiment… unapplied changes");
  const before = (await loads(page)).length;
  await applyAndRestart(page).click();
  await expect(status(page)).toHaveText("READY");

  const sent = await loads(page);
  expect(sent).toHaveLength(before + 1);
  const last = sent.at(-1)!;
  expect(last.type === "load" && last.scenario).toEqual(commerceScenario("retry-unsafe"));
  const overlay = last.type === "load" ? last.overlay as { parameters: unknown[]; scheduledFaults: { id: string; at: number }[]; faults: unknown[] } : null;
  expect(overlay?.parameters).toEqual([{ key: "idempotency", value: true }]);
  expect(overlay?.scheduledFaults.map(item => [item.id, item.at])).toEqual([["student-fault-1", 5]]);
  expect(overlay?.faults).toEqual([]);

  await expect(runIdentity(page)).toContainText("Seed commerce-classroom-1 · idempotency=on · 1 student fault · run ");
  expect(await runIdentity(page).innerText()).not.toBe(packagedRun);
  await expect(experimentTrigger(page)).toHaveAccessibleName("Change the experiment…");
  await expect(faultsSection(page).getByRole("list", { name: "Student faults" })).toContainText("· applied");

  // Discard returns both sections to the applied overlay.
  await choicesSection(page).getByLabel("Idempotency key").uncheck();
  await faultsSection(page).getByRole("button", { name: "Remove student-fault-1" }).click();
  await expect(experimentTrigger(page)).toHaveAccessibleName("Change the experiment… unapplied changes");
  await experimentDrawer(page).getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(choicesSection(page).getByLabel("Idempotency key")).toBeChecked();
  await expect(faultsSection(page).getByRole("list", { name: "Student faults" })).toContainText("student-fault-1");
  await expect(experimentTrigger(page)).toHaveAccessibleName("Change the experiment…");
  expect(await loads(page)).toHaveLength(before + 1);
});

test("a rejected overlay shows the drawer with each diagnostic in its own section", async ({ page }) => {
  await page.addInitScript(() => {
    window.drawerFixture = { commands: [], emit: () => {} };
    window.Worker = class extends EventTarget {
      constructor() {
        super();
        window.drawerFixture.emit = event => this.dispatchEvent(new MessageEvent("message", { data: event }));
      }
      postMessage(command: WorkerCommand) { window.drawerFixture.commands.push(structuredClone(command)); }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await page.evaluate(serialized => {
    const requestId = window.drawerFixture.commands.at(-1)!.requestId;
    const session = { lesson: "retry-unsafe@1", seed: "commerce-classroom-1", overlay: { version: 1 as const, faults: [], scheduledFaults: [], parameters: [] }, origin: { kind: "packaged" as const } };
    window.drawerFixture.emit({ version: 1, type: "loaded", requestId, projection: JSON.parse(serialized) as RuntimeProjectionSet, session });
  }, JSON.stringify(projection("READY")));
  await expect(status(page)).toHaveText("READY");

  await openExperiment(page);
  await choicesSection(page).getByLabel("Idempotency key").check();
  await addCrash(page, "5");
  await applyAndRestart(page).click();
  await page.evaluate(() => {
    const load = window.drawerFixture.commands.at(-1)!;
    window.drawerFixture.emit({ version: 1, type: "error", requestId: load.requestId, error: { code: "INVALID_OVERLAY", message: "The session overlay is not valid.", context: {
      diagnostics: [{ path: "/parameters/0/value", code: "PARAMETER_VALUE" }, { path: "/scheduledFaults/0/at", code: "FAULT" }],
    } } });
  });
  await expect(experimentDrawer(page)).toBeVisible();
  await expect(choicesSection(page)).toContainText("This value is outside the allowed range. (PARAMETER_VALUE)");
  await expect(choicesSection(page)).not.toContainText("(FAULT)");
  await expect(faultsSection(page).locator(".fault-chip-errors")).toContainText("At virtual time:");
  await expect(faultsSection(page)).not.toContainText("PARAMETER_VALUE");
  // The draft stays editable, and Apply sends it again.
  await expect(applyAndRestart(page)).toBeEnabled();
});

test("a rejected Compare opens the closed drawer on the carried fault", async ({ page }) => {
  await page.addInitScript(() => {
    window.drawerFixture = { commands: [], emit: () => {} };
    window.Worker = class extends EventTarget {
      constructor() {
        super();
        window.drawerFixture.emit = event => this.dispatchEvent(new MessageEvent("message", { data: event }));
      }
      postMessage(command: WorkerCommand) { window.drawerFixture.commands.push(structuredClone(command)); }
      terminate() {}
    } as unknown as typeof Worker;
  });
  /** Answers the latest load with READY and the overlay that load sent. */
  const answerLoad = () => page.evaluate(serialized => {
    const load = window.drawerFixture.commands.at(-1)!;
    const overlay = (load.type === "load" ? load.overlay : undefined) ?? { version: 1, faults: [], scheduledFaults: [], parameters: [] };
    const session = { lesson: "retry-unsafe@1", seed: "commerce-classroom-1", overlay, origin: { kind: "packaged" as const } };
    window.drawerFixture.emit({ version: 1, type: "loaded", requestId: load.requestId, projection: JSON.parse(serialized) as RuntimeProjectionSet, session });
  }, JSON.stringify(projection("READY")));
  await page.goto("/");
  await loadLesson(page, "retry-unsafe");
  await answerLoad();
  await expect(status(page)).toHaveText("READY");
  await openExperiment(page);
  await addCrash(page, "5");
  await applyAndRestart(page).click();
  await answerLoad();
  await expect(status(page)).toHaveText("READY");
  await experimentDrawer(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(experimentDrawer(page)).toBeHidden();

  // Compare carries the applied fault to the paired lesson, whose worker rejects it.
  await page.getByRole("button", { name: "Compare: Retry with idempotency", exact: true }).click();
  await page.evaluate(() => {
    const load = window.drawerFixture.commands.at(-1)!;
    window.drawerFixture.emit({ version: 1, type: "error", requestId: load.requestId, error: { code: "INVALID_OVERLAY", message: "The session overlay is not valid.", context: {
      diagnostics: [{ path: "/scheduledFaults/0/at", code: "FAULT" }],
    } } });
  });
  await expect(experimentDrawer(page)).toBeVisible();
  await expect(faultsSection(page).locator(".fault-chip-errors")).toContainText("At virtual time:");
});
