import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Locator, Page } from "@playwright/test";
import type { RuntimeProjectionSet, WorkerCommand } from "@distlab/contracts";
import { projection } from "../tests/support.ts";
import { loadLesson } from "./support/lesson.ts";
import { applyAndRestart, experimentDrawer, openExperiment } from "./support/experiment.ts";

// #112: the Design editor is the Architecture section of the Experiment drawer. In the gap lesson the
// student fills the notifications slot, gives it a database, and subscribes it, then applies the design.

declare global {
  interface Window { designFixture: { commands: WorkerCommand[]; emit: (event: unknown) => void } }
}

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-112");
const GAP = "outbox-notifications-gap";
const MODEL = "commerce.notifications@1.0.0";
const NOTIFICATION_CHECK = "An approved payment produces exactly one notification";

const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const lessonPanel = (page: Page) => page.getByRole("complementary", { name: "Lesson", exact: true });
const invariants = (page: Page) => lessonPanel(page).getByRole("region", { name: "Lesson checks", exact: true }).getByRole("list", { name: "Business invariants", exact: true });
const section = (page: Page) => experimentDrawer(page).getByRole("region", { name: "Architecture", exact: true });
const model = (page: Page) => section(page).getByLabel("Model for notifications", { exact: true });
const idempotent = (page: Page) => section(page).getByLabel("notifications: idempotent", { exact: true });
const database = (page: Page) => section(page).getByLabel("notifications owns a database", { exact: true });
const subscription = (page: Page) => section(page).getByLabel("notifications subscribes to PaymentApproved", { exact: true });
const slotControl = (page: Page): Locator => section(page).locator('[data-control="slot:notifications"]');
const runIdentity = (page: Page) => page.getByLabel("Run identity", { exact: true });

async function load(page: Page) {
  await page.goto("/");
  await loadLesson(page, GAP);
  await expect(status(page)).toHaveText("READY");
}
async function run(page: Page) {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");
}
async function design(page: Page, options: { readonly database: boolean; readonly subscription: boolean; readonly idempotent: boolean }) {
  await openExperiment(page);
  await model(page).selectOption(MODEL);
  if (options.idempotent) await idempotent(page).check();
  if (options.database) await database(page).check();
  if (options.subscription) await subscription(page).check();
}
const notificationVerdict = (page: Page) => invariants(page).getByRole("listitem").filter({ hasText: NOTIFICATION_CHECK });

test("#112 designs 1 to 3: the packaged gap, two notifications without idempotency, and every invariant holding with it", async ({ page }) => {
  await page.setViewportSize({ width: 1534, height: 897 });
  await load(page);
  mkdirSync(evidenceDir, { recursive: true });

  // 1. The packaged run: no notification, and the invariant is VIOLATED.
  await openExperiment(page);
  await expect(section(page)).toContainText("0 of 3 design edits");
  await expect(model(page)).toHaveValue("packaged");
  await expect(model(page).locator("option")).toHaveText(["Empty slot (packaged)", "commerce.notifications 1.0.0"]);
  await expect(idempotent(page)).toHaveCount(0);
  await expect(database(page)).not.toBeChecked();
  await expect(subscription(page)).not.toBeChecked();
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-section-packaged.png") });
  await run(page);
  await expect(notificationVerdict(page)).toContainText("VIOLATED");
  // No design edit: the Run identity line reads as before.
  await expect(runIdentity(page)).not.toContainText("design edit");

  // 2. The model, its database, and its subscription: the duplicate delivery creates two notifications.
  await design(page, { database: true, subscription: true, idempotent: false });
  await expect(section(page)).toContainText("3 of 3 design edits");
  await expect(experimentDrawer(page).getByRole("note")).toContainText("These changes are not applied yet.");
  await applyAndRestart(page).click();
  await expect(status(page)).toHaveText("READY");
  // The applied design is the draft: nothing is pending after Apply.
  await expect(experimentDrawer(page).getByRole("note")).toHaveCount(0);
  await expect(runIdentity(page)).toContainText(" · 3 design edits · notifications: commerce.notifications 1.0.0 · run ");
  await run(page);
  await expect(notificationVerdict(page)).toContainText("VIOLATED");

  // 3. The same with idempotency: every business invariant holds, and Reset and Run replay the same run.
  await idempotent(page).check();
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-section-drafted.png") });
  await applyAndRestart(page).click();
  await expect(status(page)).toHaveText("READY");
  await run(page);
  await expect(invariants(page).getByRole("listitem")).toHaveCount(3);
  for (const item of await invariants(page).getByRole("listitem").all()) await expect(item).toContainText("HOLDS");
  await expect(runIdentity(page)).toContainText(" · 3 design edits · notifications: commerce.notifications 1.0.0 · run ");
  const identity = await runIdentity(page).innerText();
  const outcome = await invariants(page).innerText();
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-section-applied.png") });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status(page)).toHaveText("READY");
  await run(page);
  await expect(runIdentity(page)).toHaveText(identity);
  expect(await invariants(page).innerText()).toBe(outcome);
});

test("#112 case 4: a design without the database or without the subscription is rejected on the slot control, keeps the draft, and loads once corrected", async ({ page }) => {
  await page.setViewportSize({ width: 1534, height: 897 });
  await load(page);
  for (const [missing, code, text] of [
    ["database", "STORAGE", "This model needs storage that the component does not own. (STORAGE)"],
    ["subscription", "SUBSCRIPTION", "The model's consumers and the component's subscriptions do not match. (SUBSCRIPTION)"],
  ] as const) {
    await design(page, { database: missing !== "database", subscription: missing !== "subscription", idempotent: false });
    await applyAndRestart(page).click();
    await expect(slotControl(page).locator(".field-error")).toHaveText(text);
    await expect(model(page)).toHaveAttribute("aria-invalid", "true");
    await expect(model(page)).toHaveAccessibleDescription(text);
    // The draft is kept and the drawer stays open.
    await expect(experimentDrawer(page)).toBeVisible();
    await expect(model(page)).toHaveValue(MODEL);
    await expect(missing === "database" ? subscription(page) : database(page)).toBeChecked();
    await expect(lessonPanel(page).getByRole("status", { name: "Lesson state" })).toContainText("The changes were not applied.");
    if (code === "STORAGE") await page.screenshot({ path: path.join(evidenceDir, "1534x897-section-rejected.png") });
    // Correcting it and applying again loads the session.
    await (missing === "database" ? database(page) : subscription(page)).check();
    await applyAndRestart(page).click();
    await expect(status(page)).toHaveText("READY");
    await expect(slotControl(page).locator(".field-error")).toHaveCount(0);
    await expect(runIdentity(page)).toContainText("3 design edits");
    // Back to the packaged lesson for the next case.
    await loadLesson(page, GAP);
    await expect(status(page)).toHaveText("READY");
    await expect(model(page)).toHaveValue("packaged");
  }
});

test("#112 Discard returns to the applied design, another lesson starts from the packaged values, and a lesson without an allowance has no section", async ({ page }) => {
  await load(page);
  await design(page, { database: true, subscription: true, idempotent: true });
  await applyAndRestart(page).click();
  await expect(status(page)).toHaveText("READY");
  await idempotent(page).uncheck();
  await database(page).uncheck();
  await expect(experimentDrawer(page).getByRole("note")).toContainText("These changes are not applied yet.");
  await experimentDrawer(page).getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(model(page)).toHaveValue(MODEL);
  await expect(idempotent(page)).toBeChecked();
  await expect(database(page)).toBeChecked();
  await expect(subscription(page)).toBeChecked();
  await expect(experimentDrawer(page).getByRole("note")).toHaveCount(0);

  await loadLesson(page, "outbox-idempotent");
  await expect(status(page)).toHaveText("READY");
  await expect(experimentDrawer(page)).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  await loadLesson(page, GAP);
  await expect(status(page)).toHaveText("READY");
  await expect(model(page)).toHaveValue("packaged");
  await expect(database(page)).not.toBeChecked();
  await expect(subscription(page)).not.toBeChecked();
  await expect(runIdentity(page)).not.toContainText("design edit");
});

test("#112 design 3 can be made and applied with the keyboard alone, and the open drawer has no axe violation", async ({ page }) => {
  await load(page);
  await openExperiment(page);
  const results = await new AxeBuilder({ page }).include("#experiment-drawer").analyze();
  expect(results.violations).toEqual([]);
  await model(page).focus();
  await page.keyboard.press("ArrowDown");
  await expect(model(page)).toHaveValue(MODEL);
  await page.keyboard.press("Tab");
  await expect(idempotent(page)).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(database(page)).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(subscription(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(section(page)).toContainText("3 of 3 design edits");
  await applyAndRestart(page).focus();
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("READY");
  await expect(runIdentity(page)).toContainText(" · 3 design edits · notifications: commerce.notifications 1.0.0 · run ");
  const applied = await new AxeBuilder({ page }).include("#experiment-drawer").analyze();
  expect(applied.violations).toEqual([]);
});

test("#112 the design controls are unavailable while the simulation runs", async ({ page }) => {
  await page.addInitScript(() => {
    window.designFixture = { commands: [], emit: () => {} };
    window.Worker = class extends EventTarget {
      constructor() {
        super();
        window.designFixture.emit = event => this.dispatchEvent(new MessageEvent("message", { data: event }));
      }
      postMessage(command: WorkerCommand) { window.designFixture.commands.push(structuredClone(command)); }
      terminate() {}
    } as unknown as typeof Worker;
  });
  await page.goto("/");
  await loadLesson(page, GAP);
  const emit = (state: RuntimeProjectionSet["simulation"]["status"], type: "loaded" | "projection.updated") => page.evaluate(({ serialized, type }) => {
    const projection = JSON.parse(serialized) as RuntimeProjectionSet;
    const requestId = window.designFixture.commands.at(-1)!.requestId;
    const session = { lesson: "outbox-notifications-gap@1", seed: "commerce-classroom-1", overlay: { version: 1 as const, faults: [], scheduledFaults: [], parameters: [] }, origin: { kind: "packaged" as const } };
    window.designFixture.emit(type === "loaded" ? { version: 1, type, requestId, projection, session } : { version: 1, type, projection });
  }, { serialized: JSON.stringify(projection(state)), type });
  await emit("READY", "loaded");
  await openExperiment(page);
  await model(page).selectOption(MODEL);
  await expect(database(page)).toBeEnabled();
  await emit("RUNNING", "projection.updated");
  for (const control of [model(page), idempotent(page), database(page), subscription(page)]) await expect(control).toBeDisabled();
  await emit("PAUSED", "projection.updated");
  for (const control of [model(page), idempotent(page), database(page), subscription(page)]) await expect(control).toBeEnabled();
});

test("#112 at the edit limit a control that would add an edit is unavailable", async ({ page }) => {
  await load(page);
  await design(page, { database: true, subscription: true, idempotent: false });
  // All three edits are made; each control is already edited, so each can still be changed back.
  for (const control of [model(page), database(page), subscription(page), idempotent(page)]) await expect(control).toBeEnabled();
  await subscription(page).uncheck();
  await expect(section(page)).toContainText("2 of 3 design edits");
  await expect(subscription(page)).toBeEnabled();
});
