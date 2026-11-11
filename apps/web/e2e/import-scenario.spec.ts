import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { ScenarioDocumentLimits } from "@distlab/contracts";
import { checkoutOverlayPolicy, hostedCatalogs } from "@distlab/catalogs";
import { validateScenarioDocument } from "@distlab/scenario";
import { loadLesson } from "./support/lesson.ts";
import { experimentTrigger } from "./support/experiment.ts";

// ADR-006 browser import (#115): open a scenario file, run it, and read its checks.

const fixtureText = readFileSync(fileURLToPath(new URL("../../../examples/scenarios/processor-response-lost.json", import.meta.url)), "utf8");
type Doc = Record<string, unknown>;
const fixture = () => JSON.parse(fixtureText) as Doc;

declare global {
  interface Window { importEvidence: { commands: WorkerCommand[] } }
}

async function captureCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.importEvidence = { commands: [] };
    window.Worker = class extends OriginalWorker {
      override postMessage(command: WorkerCommand) {
        window.importEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

const commands = (page: Page) => page.evaluate(() => window.importEvidence.commands);
const status = (page: Page) => page.getByRole("status", { name: "Simulation status" });

async function openFile(page: Page, name: string, text: string) {
  await page.getByLabel("Scenario file", { exact: true }).setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text, "utf8") });
}

test("APP-AC-8 opening the vision §19 file shows an imported header, runs, and links a PASS check to its evidence", async ({ page }) => {
  await captureCommands(page);
  await page.goto("/");
  await openFile(page, "processor-response-lost.json", fixtureText);
  await expect(status(page)).toHaveText("READY");

  // APP-AC-9: the worker received the file text exactly as read, not a parsed value.
  const [load] = await commands(page);
  expect(load).toMatchObject({ type: "load", document: fixtureText });
  expect(load).not.toHaveProperty("scenario");

  const validated = validateScenarioDocument(fixtureText, hostedCatalogs);
  if (!validated.ok) throw new Error("fixture must validate");
  const header = page.getByLabel("Imported scenario", { exact: true });
  await expect(header).toContainText(`Imported · Processor response lost · processor-response-lost@1 · seed processor-response-lost-1 · mvp.checkout@1.0.0 · digest ${validated.digest.slice(0, 8)} · run `);
  await expect(page.getByText("The checks in this scenario were written by the file’s author and judged by DistLab catalog predicates.")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Lesson", exact: true }).getByText("The processor approves the payment, but its response never reaches Payments.")).toBeVisible();
  // No paired lesson, and the file declares no overlay policy.
  await expect(page.getByRole("button", { name: /^Compare/ })).toHaveCount(0);
  await expect(page.getByText("This scenario accepts no student changes: its file declares no overlay policy.")).toBeVisible();
  await expect(experimentTrigger(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");
  const checks = page.getByRole("list", { name: "Scenario checks", exact: true });
  await expect(checks.getByRole("listitem")).toHaveCount(1);
  await expect(checks.getByRole("listitem")).toContainText("PASS — The customer is charged at most once. (checked at t=");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await checks.getByRole("button", { name: "Show evidence: The customer is charged at most once.", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Recorded history", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#history-panel")).toContainText("order-not-charged-twice");

  // Reset replays the same document: the same run ID, and no further load.
  const runId = await header.textContent();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status(page)).toHaveText("READY");
  await expect(header).toHaveText(runId!);
  expect((await commands(page)).filter(command => command.type === "load")).toHaveLength(1);

  // Choosing a packaged scenario discards the imported document.
  await loadLesson(page, "normal");
  await expect(status(page)).toHaveText("READY");
  await expect(header).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Lesson", exact: true })).toContainText("How does a checkout travel through a distributed system?");
});

test("an invalid file lists each diagnostic with its path and explanation, loads no session, and a corrected file loads", async ({ page }) => {
  await page.goto("/");
  await openFile(page, "unknown-catalog.json", JSON.stringify({ ...fixture(), catalog: { id: "mvp.unknown", version: "1.0.0" } }));
  const problems = page.getByRole("list", { name: "Scenario file problems", exact: true });
  await expect(problems.getByRole("listitem")).toHaveCount(1);
  await expect(problems.getByRole("listitem")).toHaveText("/catalog/id UNKNOWN_CATALOG — DistLab does not host a catalog with this ID.");
  await expect(page.getByRole("region", { name: "The scenario file was not loaded" })).toContainText("unknown-catalog.json has 1 problem. No session is loaded.");
  await expect(page.getByRole("button", { name: "Run", exact: true })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByLabel("Imported scenario", { exact: true })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await openFile(page, "processor-response-lost.json", fixtureText);
  await expect(status(page)).toHaveText("READY");
  await expect(problems).toHaveCount(0);
  await expect(page.getByLabel("Imported scenario", { exact: true })).toContainText("Processor response lost");
});

test("an oversized file is not read or sent, and the loaded session stays", async ({ page }) => {
  await captureCommands(page);
  await page.goto("/");
  await loadLesson(page, "normal");
  await expect(status(page)).toHaveText("READY");
  const before = (await commands(page)).length;
  await openFile(page, "huge.json", " ".repeat(ScenarioDocumentLimits.documentBytes + 1));
  const problems = page.getByRole("list", { name: "Scenario file problems", exact: true });
  await expect(problems).toContainText("(whole document) DOCUMENT_SIZE — The file is larger than 262,144 bytes, so it was not read.");
  await expect(page.getByRole("region", { name: "The scenario file was not loaded" })).toContainText("The current session is unchanged.");
  expect(await commands(page)).toHaveLength(before);
  await expect(status(page)).toHaveText("READY");
  await expect(page.getByRole("complementary", { name: "Lesson", exact: true })).toContainText("How does a checkout travel through a distributed system?");
});

test("presentation text renders as plain text, and a dropped file with an overlay policy offers the Experiment drawer", async ({ page }) => {
  await page.goto("/");
  const name = (fixture().scenario as Doc).name as string;
  const text = JSON.stringify({
    ...fixture(),
    presentation: { title: "<b>Bold?</b>", summary: "<img src=x onerror=\"document.title='owned'\"> [link](https://example.com)" },
    overlayPolicy: { ...checkoutOverlayPolicy("normal"), lesson: name },
  });
  const dataTransfer = await page.evaluateHandle(content => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], "governed.json", { type: "application/json" }));
    return transfer;
  }, text);
  await page.dispatchEvent(".scenario-picker", "dragover", { dataTransfer });
  await page.dispatchEvent(".scenario-picker", "drop", { dataTransfer });
  await expect(status(page)).toHaveText("READY");

  const prompt = page.getByRole("complementary", { name: "Lesson", exact: true });
  await expect(page.getByLabel("Imported scenario", { exact: true })).toContainText("Imported · <b>Bold?</b> · processor-response-lost@1");
  await expect(prompt).toContainText("<img src=x onerror=\"document.title='owned'\"> [link](https://example.com)");
  await expect(prompt.locator("b, img, a")).toHaveCount(0);
  expect(await page.title()).not.toBe("owned");

  // The document's policy, not a packaged one, decides what the student may break.
  await expect(experimentTrigger(page)).toBeVisible();
  await expect(page.getByText("This scenario accepts no student changes", { exact: false })).toHaveCount(0);
});

test("#160: an imported document's checks lead ③ Investigate, and its Architecture tab ends with the graph and does not scroll at 1366x768", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await captureCommands(page);
  await page.goto("/");
  await openFile(page, "processor-response-lost.json", fixtureText);
  await expect(status(page)).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status(page)).toHaveText("COMPLETED");

  // The Architecture tab holds only the replay controls and the graph, as for packaged lessons (#142).
  const panel = page.locator("#architecture-panel");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect(await panel.evaluate(element => element.lastElementChild?.matches("details.connections") ?? false)).toBe(true);
  await expect(panel.getByRole("list", { name: "Scenario checks" })).toHaveCount(0);
  const { scrollHeight, clientHeight } = await panel.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  expect(scrollHeight).toBe(clientHeight);

  // The checks are the first element of ③ Investigate, and they still link to their evidence.
  const investigate = page.getByRole("complementary", { name: "Lesson", exact: true }).getByRole("region", { name: "③ Investigate" });
  const first = await investigate.evaluate(section => section.querySelector(":scope > h3")?.nextElementSibling?.matches("section.imported-checks") ?? false);
  expect(first).toBe(true);
  const checks = investigate.getByRole("list", { name: "Scenario checks", exact: true });
  await expect(checks.getByRole("listitem")).toContainText("PASS — The customer is charged at most once.");
  await expect(investigate).not.toContainText("below the architecture");
  await expect(investigate).toContainText("Run it, read its checks above, then use Recorded history to follow what happened.");
  await checks.getByRole("button", { name: "Show evidence: The customer is charged at most once.", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Recorded history", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#history-panel")).toContainText("order-not-charged-twice");
});
