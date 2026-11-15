import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Locator, Page } from "@playwright/test";
import { budgets, measureLayout, viewports } from "./layout-budget.ts";
import { expectLegibleView } from "./support/graph.ts";
import { graphLaidOut, loadLesson } from "./support/lesson.ts";
import { applyAndRestart, experimentDrawer, openExperiment } from "./support/experiment.ts";

// #203: the graph follows the Design editor. In the gap lesson the draft is previewed on the graph while
// it is edited, the applied design's attached database is an ordinary satellite after Apply and restart,
// and a rejected design marks the element its diagnostic concerns.

const evidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "evidence", "issue-203");
const GAP = "outbox-notifications-gap";
const MODEL = "commerce.notifications@1.0.0";

const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });
const runIdentity = (page: Page) => page.getByLabel("Run identity", { exact: true });
const section = (page: Page) => experimentDrawer(page).getByRole("region", { name: "Architecture", exact: true });
const model = (page: Page) => section(page).getByLabel("Model for notifications", { exact: true });
const idempotent = (page: Page) => section(page).getByLabel("notifications: idempotent", { exact: true });
const database = (page: Page) => section(page).getByLabel("notifications owns a database", { exact: true });
const subscription = (page: Page) => section(page).getByLabel("notifications subscribes to PaymentApproved", { exact: true });
const canvas = (page: Page) => page.locator(".graph-canvas");
const notificationsNode = (page: Page): Locator => canvas(page).locator('.react-flow__node[data-id="notifications"]');
const satellite = (page: Page): Locator => canvas(page).locator('.react-flow__node[data-id="resource:db:notifications"]');
const inspector = (page: Page) => page.locator("#component-inspector");

async function closeDrawer(page: Page) {
  await experimentDrawer(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(experimentDrawer(page)).toBeHidden();
}

async function load(page: Page) {
  await page.goto("/");
  await loadLesson(page, GAP);
  await expect(status(page)).toHaveText("READY");
  await graphLaidOut(page);
}

/** Every accessible name on the graph canvas: nodes and links. */
function graphNames(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll(".graph-canvas [aria-label]")].map(element => element.getAttribute("aria-label") ?? ""));
}

test("#203 steps 1 to 5: the draft is previewed on the graph without a command, and after Apply the design is drawn as ordinary elements", async ({ page }) => {
  await page.setViewportSize({ width: 1534, height: 897 });
  await load(page);
  mkdirSync(evidenceDir, { recursive: true });
  const identity = await runIdentity(page).innerText();
  await expect(notificationsNode(page)).toHaveAttribute("aria-label", "Notifications, Internal service, empty slot");

  await openExperiment(page);
  // 1. The chosen model relabels the slot node with a Draft mark; the Empty slot mark goes in the preview.
  await model(page).selectOption(MODEL);
  await expect(canvas(page).getByRole("button", { name: "Notifications, Internal service, commerce.notifications 1.0.0, draft", exact: true })).toBeVisible();
  await expect(notificationsNode(page).locator(".draft-badge")).toHaveText("Draft commerce.notifications 1.0.0");
  await expect(notificationsNode(page).locator(".empty-slot-badge")).toHaveCount(0);
  // 2. The database is an outlined satellite marked Draft.
  await database(page).check();
  await expect(canvas(page).getByRole("button", { name: "Database owned by Notifications, draft", exact: true })).toBeVisible();
  await expect(satellite(page).locator(".draft-badge")).toHaveText("Draft");
  // 3. The subscription is a dashed connection from PaymentApproved to notifications, marked Draft.
  await subscription(page).check();
  const drafted = canvas(page).getByRole("img", { name: "PaymentApproved to Notifications: Subscription, draft", exact: true });
  await expect(drafted).toHaveCount(1);
  await expect(drafted.locator(".react-flow__edge-text")).toHaveText("Draft · Subscription");
  // Close keeps the draft, and so its preview; the closed drawer leaves the graph its whole width.
  await closeDrawer(page);
  await graphLaidOut(page);
  await expect(drafted).toHaveCount(1);
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-draft-preview.png") });
  // 4. Nothing was sent: the status and the run identity are unchanged.
  await expect(status(page)).toHaveText("READY");
  await expect(runIdentity(page)).toHaveText(identity);

  // 5. Apply and restart: no draft mark remains, and the design is drawn as ordinary elements.
  await openExperiment(page);
  await idempotent(page).check();
  await applyAndRestart(page).click();
  await expect(status(page)).toHaveText("READY");
  await closeDrawer(page);
  await graphLaidOut(page);
  await expect(runIdentity(page)).not.toHaveText(identity);
  await expect.poll(async () => (await graphNames(page)).filter(name => /draft/i.test(name))).toEqual([]);
  await expect(canvas(page).locator(".draft-badge")).toHaveCount(0);
  await expect(satellite(page)).toHaveAttribute("aria-label", "Database owned by Notifications");
  await expect(canvas(page).getByRole("img", { name: "PaymentApproved to Notifications: Subscription", exact: true })).toHaveCount(1);
  await satellite(page).click();
  await expect(inspector(page).getByRole("heading", { name: "Database owned by Notifications" })).toBeVisible();
  await expect(inspector(page).locator(".resource-facts li")).toHaveText(["notifications", "inbox"]);
  await notificationsNode(page).click();
  await expect(inspector(page).locator(".inspector-slot")).toContainText("Filled slot. Model commerce.notifications 1.0.0.");
  await expect(inspector(page).getByRole("definition")).toHaveText("true");
  await expect(inspector(page).getByRole("term")).toHaveText("idempotent");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-applied-design.png") });
});

test("#203 step 6: a rejected design marks the slot node with an error badge, and its diagnostic focuses the node", async ({ page }) => {
  await page.setViewportSize({ width: 1534, height: 897 });
  await load(page);
  mkdirSync(evidenceDir, { recursive: true });
  await openExperiment(page);
  await model(page).selectOption(MODEL);
  await subscription(page).check();
  await applyAndRestart(page).click();
  const text = "This model needs storage that the component does not own. (STORAGE)";
  await expect(section(page).locator('[data-control="slot:notifications"] .field-error')).toHaveText(text);
  // The graph stays on view, with the draft preview and the error badge on the slot node.
  await graphLaidOut(page);
  await expect(notificationsNode(page).locator(".problem-badge")).toHaveText("⚠ Design problem");
  await expect(notificationsNode(page)).toHaveAccessibleDescription(text);
  await expect(canvas(page).getByRole("button", { name: "Notifications, Internal service, commerce.notifications 1.0.0, draft", exact: true })).toBeVisible();
  await expect(canvas(page).getByRole("img", { name: "PaymentApproved to Notifications: Subscription, draft", exact: true })).toHaveCount(1);
  // Activating the diagnostic moves focus to the node and selects it.
  await section(page).getByRole("button", { name: "Show on graph", exact: true }).click();
  await expect(notificationsNode(page)).toBeFocused();
  await expect(notificationsNode(page)).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: path.join(evidenceDir, "1534x897-rejected-design.png") });
  // The draft and its preview stay.
  await expect(model(page)).toHaveValue(MODEL);
  await expect(subscription(page)).toBeChecked();
});

test("#203 the graph stays legible and within the layout budget at 1366×768 with a draft preview, and axe finds no violation with a draft or a rejected design", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(viewports["1366x768"]);
  await load(page);
  await openExperiment(page);
  await graphLaidOut(page);
  // The drawer's own cost is measured first, so the comparison is the preview's cost alone.
  const before = await measureLayout(page);
  await model(page).selectOption(MODEL);
  await database(page).check();
  await subscription(page).check();
  await graphLaidOut(page);
  await expect(satellite(page)).toBeVisible();
  await expectLegibleView(page, "gap lesson with a draft preview and the drawer open");
  const measures = await measureLayout(page);
  const budget = budgets["1366x768"]["retry-unsafe"].READY;
  expect(measures.topBarHeight).toBeLessThanOrEqual(budget.topBarHeight.max);
  expect(measures.smallestName).toBeGreaterThanOrEqual(budget.smallestName.min);
  expect(measures.canvasVisible, "the preview takes no height from the canvas").toBeGreaterThanOrEqual(before.canvasVisible);
  const drafted = await new AxeBuilder({ page }).include("#architecture-panel").analyze();
  expect(drafted.violations).toEqual([]);

  await database(page).uncheck();
  await applyAndRestart(page).click();
  await expect(notificationsNode(page).locator(".problem-badge")).toBeVisible();
  await graphLaidOut(page);
  const rejected = await new AxeBuilder({ page }).include("#architecture-panel").include("#experiment-drawer").analyze();
  expect(rejected.violations).toEqual([]);
});
