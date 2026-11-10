import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, test } from "./support/test.ts";
import type { Locator, Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { reliableCheckoutAssessment, reliableCheckoutScenario } from "@distlab/catalogs";
import { lessonChooser, lessonTrigger } from "./support/lesson.ts";

/**
 * The assessment view (docs/spec/assessment.md, #97). It runs against the real worker: every
 * row is an ordinary load of the packaged base document plus `run`, and the matrix reads the
 * stored verdicts. A recorder on `postMessage` and on the polite live region observes both.
 */

declare global {
  interface Window {
    assessmentCommands: WorkerCommand[];
    assessmentAnnouncements: string[];
  }
}

async function record(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.assessmentCommands = [];
    window.assessmentAnnouncements = [];
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.assessmentCommands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
    // Every message the polite log appends, in order (ASSESS-AC-7).
    new MutationObserver(records => {
      for (const record of records) {
        if (!(record.target instanceof Element) || record.target.getAttribute("aria-label") !== "Assessment progress") continue;
        for (const node of record.addedNodes) window.assessmentAnnouncements.push(node.textContent ?? "");
      }
    }).observe(document, { subtree: true, childList: true });
  });
}

const definition = reliableCheckoutAssessment;
const runButton = (page: Page) => page.getByRole("button", { name: "Run assessment", exact: true });
const matrix = (page: Page) => page.getByRole("tabpanel", { name: "Assessment results" }).getByRole("table");
const rowOf = (page: Page, label: string): Locator => matrix(page).getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) });
const commands = (page: Page) => page.evaluate(() => window.assessmentCommands);
/** The suite's polite log; its last entry is the latest announcement. */
const latest = (page: Page) => page.getByRole("log", { name: "Assessment progress" }).locator("p").last();

async function openAssessment(page: Page) {
  await page.goto("/");
  await lessonTrigger(page).click();
  await lessonChooser(page).getByRole("list", { name: "Assessments" }).getByRole("button", { name: /Reliable Checkout/ }).click();
  await expect(lessonChooser(page)).toBeHidden();
  await expect(lessonTrigger(page)).toHaveText(/Lesson: Reliable Checkout assessment/);
  await expect(page.getByRole("tab", { name: "Assessment results" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
}
async function runToEnd(page: Page) {
  await runButton(page).click();
  await expect(latest(page)).toHaveText(/^Assessment finished: /, { timeout: 60_000 });
}
async function outcomes(page: Page) {
  const result: Record<string, string> = {};
  for (const row of definition.rows) result[row.id] = (await rowOf(page, row.label).getByRole("cell").first().innerText()).replace(/[✓✗–]\s*/, "").trim();
  return result;
}

test("D-7: the Lesson chooser lists the assessment in its own group; opening it shows the requirements, the design form, and an empty matrix", async ({ page }) => {
  await record(page);
  await openAssessment(page);
  const lesson = page.getByRole("complementary", { name: "Lesson", exact: true });
  await expect(lesson.getByRole("list", { name: "Requirements" }).getByRole("listitem")).toHaveText([...definition.requirements]);
  await expect(lesson.getByRole("region", { name: "Your design" })).toBeVisible();
  for (const name of ["Payment retries", "Idempotency key", "Compensation", "Transactional outbox", "Idempotent consumer"]) {
    await expect(lesson.getByLabel(name, { exact: true })).toBeVisible();
  }
  await expect(matrix(page).getByRole("columnheader")).toHaveText(["Scenario", "Result", ...definition.invariants.map(item => item.label)]);
  for (const row of definition.rows) await expect(rowOf(page, row.label).getByRole("cell").first()).toHaveText("Not run");
  // Opening it is one ordinary load of the exact base document, without an overlay.
  const sent = await commands(page);
  expect(sent.map(command => command.type)).toEqual(["load"]);
  expect(sent[0]).toMatchObject({ type: "load", scenario: reliableCheckoutScenario });
  expect(sent[0]).not.toHaveProperty("overlay");
  await expect(page.getByRole("button", { name: "Change the experiment…" })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include(".lesson-panel").include(".panel-assessment").analyze();
  expect(axe.violations).toEqual([]);
});

test("ASSESS-AC-1 and ASSESS-AC-7: rows run one at a time as load and run only, each announced; Run assessment waits for the suite", async ({ page }) => {
  await record(page);
  await openAssessment(page);
  await page.getByLabel("Payment retries", { exact: true }).fill("1");
  await page.getByRole("checkbox", { name: "Idempotency key", exact: true }).check();
  const before = (await commands(page)).length;
  await runButton(page).click();
  // While a row runs, Run assessment and the design form are unavailable, and Stop is offered.
  await expect(runButton(page)).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Idempotency key", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await expect(latest(page)).toHaveText(/^Assessment finished: /, { timeout: 60_000 });
  await expect(runButton(page)).toBeEnabled();

  const sent = (await commands(page)).slice(before);
  expect([...new Set(sent.map(command => command.type))].sort()).toEqual(["load", "run"]);
  // Strictly one load, then its runs, per row, in definition order.
  const loads = sent.flatMap((command, index) => command.type === "load" ? [index] : []);
  expect(loads).toHaveLength(definition.rows.length);
  loads.forEach((position, index) => {
    const load = sent[position] as Extract<WorkerCommand, { type: "load" }>;
    expect(load.scenario).toEqual(reliableCheckoutScenario);
    const row = definition.rows[index]!;
    expect(load.overlay).toEqual({ version: 1, faults: row.faults, scheduledFaults: row.scheduledFaults,
      parameters: [{ key: "idempotency", value: true }, { key: "retries", value: 1 }] });
    expect(sent[position + 1]?.type).toBe("run");
  });

  const announced = await page.evaluate(() => window.assessmentAnnouncements);
  const rows = announced.filter(text => text.startsWith("Row "));
  expect(rows.map(text => text.replace(/ — .*$/, ""))).toEqual(definition.rows.flatMap((row, index) => [`Row ${index + 1} of 6: ${row.label}`, `Row ${index + 1} of 6: ${row.label}`]));
  expect(rows.filter((_, index) => index % 2 === 0).every(text => text.endsWith("— running"))).toBe(true);
  expect(announced.at(-1)).toMatch(/^Assessment finished: \d of 6 rows pass\.$/);
  // Focus never moved into the matrix.
  await expect(runButton(page)).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.closest(".panel-assessment") ?? null)).toBeNull();
});

test("ASSESS-AC-3 and ASSESS-AC-4 in the browser: the default design's matrix shows the stored verdicts and the expected outcomes", async ({ page }) => {
  await record(page);
  await openAssessment(page);
  await runToEnd(page);
  expect(await outcomes(page)).toEqual({ "happy-path": "PASS", "duplicate-order-confirmed": "FAIL", "inventory-unavailable": "FAIL",
    "processor-response-lost": "FAIL", "notification-provider-down": "PASS", "crash-after-local-commit": "FAIL" });
  const lost = rowOf(page, "Processor response lost").getByRole("cell");
  await expect(lost.nth(1)).toContainText("HOLDS");
  await expect(lost.nth(2)).toContainText("VIOLATED");
  await expect(lost.nth(3)).toContainText("HOLDS");
  await expect(lost.nth(4)).toContainText("VIOLATED");
  await expect(page.getByRole("complementary", { name: "Lesson", exact: true }).getByText("2 of 6 rows pass", { exact: true })).toBeVisible();
});

test("ASSESS-AC-6: a cell of an earlier row reloads that row, then opens its evidence record in Recorded history", async ({ page }) => {
  await record(page);
  await openAssessment(page);
  await runToEnd(page);
  const afterSuite = (await commands(page)).length;
  // The last row is still loaded: its evidence opens without a command.
  await rowOf(page, "Crash after local commit").getByRole("button", { name: /A confirmed order is notified exactly once/ }).click();
  await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Observation detail" })).toContainText("scenario.assertion.evaluated");
  expect((await commands(page)).length).toBe(afterSuite);

  await page.getByRole("tab", { name: "Assessment results" }).click();
  await rowOf(page, "Duplicate OrderConfirmed").getByRole("button", { name: /A confirmed order is notified exactly once/ }).click();
  await expect(page.getByRole("tab", { name: "Recorded history" })).toHaveAttribute("aria-selected", "true", { timeout: 20_000 });
  const detail = page.getByRole("region", { name: "Observation detail" });
  await expect(detail).toContainText("scenario.assertion.evaluated");
  await expect(detail).toContainText("sent: 2");
  // The row was loaded again with its own overlay and run: one load and its runs.
  const reloaded = (await commands(page)).slice(afterSuite);
  expect(reloaded[0]).toMatchObject({ type: "load", overlay: { faults: definition.rows[1]!.faults } });
  expect([...new Set(reloaded.map(command => command.type))].sort()).toEqual(["load", "run"]);
});

test("ASSESS-AC-5: running the same design twice exports byte-identical results", async ({ page }) => {
  await record(page);
  await openAssessment(page);
  const exported: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await runToEnd(page);
    const [download] = await Promise.all([page.waitForEvent("download"),
      page.getByRole("tabpanel", { name: "Assessment results" }).getByRole("button", { name: "Export result" }).click()]);
    expect(download.suggestedFilename()).toBe("reliable-checkout-assessment@1-result.json");
    exported.push(await readFile((await download.path())!, "utf8"));
  }
  expect(exported[1]).toBe(exported[0]);
  const result = JSON.parse(exported[0]!);
  expect(result).toMatchObject({ format: "distlab.assessment-result", formatVersion: 1, assessment: definition.id, base: definition.base,
    seed: "reliable-checkout-1", configuration: { parameters: [] } });
  expect(result.rows).toHaveLength(6);
  expect(exported[0]).not.toMatch(/\n  /);
});

test("Stop ends the suite after the current row and keeps the rows already run", async ({ page }) => {
  await record(page);
  await openAssessment(page);
  await runButton(page).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(latest(page)).toHaveText(/^Assessment stopped: \d of 6 rows run, \d pass\.$/, { timeout: 60_000 });
  await expect(rowOf(page, "Crash after local commit").getByRole("cell").first()).toHaveText("Not run");
  await expect(rowOf(page, "Happy path").getByRole("cell").first()).toHaveText(/PASS/);
  await expect(runButton(page)).toBeEnabled();
});
