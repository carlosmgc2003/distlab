import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./support/test.ts";
import type { Locator, Page } from "@playwright/test";
import type { WorkerCommand } from "@distlab/contracts";
import { loadLesson } from "./support/lesson.ts";
import { openMoreFilters } from "./support/history.ts";
import { experimentDrawer, openExperiment } from "./support/experiment.ts";
import { openServiceState, serviceStateDialog } from "./support/service-state.ts";

declare global {
  interface Window { hintEvidence: { commands: WorkerCommand[] }; }
}

async function observeCommands(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.hintEvidence = { commands: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
      }
      override postMessage(command: WorkerCommand) {
        window.hintEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

function commands(page: Page) {
  return page.evaluate(() => window.hintEvidence.commands.map(command => command.type));
}

async function completed(page: Page, lesson = "response-lost") {
  const status = page.getByRole("status", { name: "Simulation status" });
  await loadLesson(page, lesson);
  await expect(status).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(status).toHaveText("COMPLETED");
}

test("explanations stay collapsed until a reader asks for them", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  const afterRun = await commands(page);

  const graphControls = page.getByRole("button", { name: "Graph controls" });
  await expect(graphControls).toHaveAttribute("aria-expanded", "false");
  const body = page.locator("#graph-controls-help");
  await expect(body).toBeHidden();
  // The explanation text is always present, so it stays searchable and testable.
  await expect(body).toContainText("press Enter or Space");

  await graphControls.hover();
  await expect(graphControls).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(graphControls).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();

  // Keyboard focus opens it, Escape closes it, and a click pins it.
  await graphControls.focus();
  await expect(graphControls).toBeFocused();
  await expect(body).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(graphControls).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(graphControls).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(graphControls).toHaveAttribute("aria-expanded", "false");

  // Reading an explanation is not a simulation action.
  expect(await commands(page)).toEqual(afterRun);
});

test("the filter, row order, and strip explanations keep their text and stay out of the layout", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  const afterRun = await commands(page);

  // The matching explanation lives in More filters, behind its hint.
  const dialog = await openMoreFilters(page);
  const before = await dialog.locator("form").evaluate(node => node.clientHeight);
  const filterHelp = page.getByRole("button", { name: "How matching works" });
  await expect(filterHelp).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#timeline-filter-help")).toBeHidden();
  await expect(page.locator("#timeline-filter-help")).toContainText("combine with AND");
  await expect(page.locator("#timeline-filter-help")).toContainText("case-sensitive");
  await filterHelp.click();
  await expect(page.locator("#timeline-filter-help")).toBeVisible();
  await expect(page.locator("#timeline-filter-help")).toContainText("Prefix matches its start");
  // The popover is not clipped by the scrolling tools region.
  const popover = await page.locator("#timeline-filter-help").boundingBox();
  expect(popover).not.toBeNull();
  expect(popover!.x).toBeGreaterThanOrEqual(0);
  expect(popover!.x + popover!.width).toBeLessThanOrEqual(1280);
  // The pinned explanation is not part of the dialog's layout.
  expect(await dialog.locator("form").evaluate(node => node.clientHeight)).toBe(before);
  // Escape closes the explanation first and keeps the dialog open; Cancel closes the dialog.
  await page.keyboard.press("Escape");
  await expect(page.locator("#timeline-filter-help")).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator("#timeline-order")).toBeHidden();
  await expect(page.locator("#timeline-order")).toContainText("it does not execute an event");
  await expect(page.locator("#story-summary")).toBeHidden();
  await expect(page.locator("#story-summary")).toContainText("component lanes");
  await expect(before).toBeGreaterThan(0);
  expect(await commands(page)).toEqual(afterRun);
});

test("a pinned explanation closes on Escape or an outside click and fits 200% zoom", async ({ page }) => {
  test.setTimeout(90_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await completed(page);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();

  const strip = page.getByRole("button", { name: "Reading the story" });
  await strip.click();
  await expect(page.locator("#story-summary")).toBeVisible();
  await page.getByRole("heading", { name: "Recorded history", exact: true }).click();
  await expect(page.locator("#story-summary")).toBeHidden();

  await page.setViewportSize({ width: 683, height: 384 });
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  const mobileStrip = page.getByRole("button", { name: "Reading the story" });
  await expect(mobileStrip).toBeVisible();
  await mobileStrip.click();
  await expect(page.locator("#story-summary")).toBeVisible();
  const box = await page.locator("#story-summary").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(683);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#story-summary")).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

/**
 * Sentences #147 moved out of the permanent layout, each into the one hint of its region, unchanged.
 * `bodyId` names the hint that must hold it; `lesson` is a lesson whose completed run renders it.
 */
const moved: readonly { readonly sentence: string; readonly bodyId: string; readonly lesson: "saga-uncompensated" | "response-lost" }[] = [
  { lesson: "saga-uncompensated", bodyId: "investigate-help", sentence: "Properties the system must keep whatever its design. VIOLATED is what this run did to the business." },
  { lesson: "saga-uncompensated", bodyId: "investigate-help", sentence: "Scenario expectations confirm that the run told this lesson's story. They say nothing about whether the system is safe." },
  { lesson: "saga-uncompensated", bodyId: "service-state-help", sentence: "These are recorded facts, not predictions. Step to inspect intermediate states; Reset replays the same inputs." },
  { lesson: "saga-uncompensated", bodyId: "experiment-help", sentence: "Business invariants report what your choices achieve. The setup checks still describe the packaged lesson, so one can read \"not reproduced\" under your choices. That shows how your change altered the story, not a simulator error." },
  { lesson: "saga-uncompensated", bodyId: "experiment-help", sentence: "Only the faults this lesson allows are listed." },
  { lesson: "saga-uncompensated", bodyId: "experiment-help", sentence: "A fault applies when you apply the draft, never during a run." },
  { lesson: "saga-uncompensated", bodyId: "experiment-help", sentence: "Fault controls are unavailable while the simulation runs or a command is in progress. The applied faults stay listed." },
  { lesson: "saga-uncompensated", bodyId: "experiment-help", sentence: "A request travels along the link, from the caller to the called component." },
  { lesson: "saga-uncompensated", bodyId: "experiment-help", sentence: "A response travels back along the link, from the called component to the caller." },
  { lesson: "saga-uncompensated", bodyId: "experiment-help", sentence: "1 means only the first matching request, message, or commit." },
  { lesson: "response-lost", bodyId: "investigate-help", sentence: "Operation duration: unavailable — this projection does not provide authorized start/end boundaries. Scenario virtual end time is not operation latency; browser playback speed is not simulated performance." },
  { lesson: "response-lost", bodyId: "experiment-help", sentence: "Only the faults this lesson allows are listed." },
  { lesson: "response-lost", bodyId: "experiment-help", sentence: "Fault controls are unavailable while the simulation runs or a command is in progress. The applied faults stay listed." },
  { lesson: "response-lost", bodyId: "timeline-filter-help", sentence: "Filters combine. Choose another field to narrow further; remove any condition using its chip below." },
];

/** The text of every hint body on the page, by body id, read from the DOM while the hints are collapsed. */
function hintBodies(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".help-hint-body")]
    .map(body => [body.id, (body.textContent ?? "").replace(/\s+/g, " ")])));
}

/**
 * Text a reader sees without opening a hint. Collapsed hint bodies and screen-reader-only descriptions (kept by
 * #147, out of its scope) are left out; so is anything not rendered.
 */
function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(".sr-only, .help-hint-body, script, style")) continue;
      if (parent.checkVisibility({ visibilityProperty: true })) parts.push(node.textContent ?? "");
    }
    return parts.join("").replace(/\s+/g, " ");
  });
}

/** Opens every region that can hold a moved sentence: ③ Investigate is in the Lesson panel, then the drawer and the dialogs. */
async function collectHints(page: Page, lesson: "saga-uncompensated" | "response-lost"): Promise<{ bodies: Record<string, string>; visible: string[] }> {
  await completed(page, lesson);
  const visible: string[] = [await visibleText(page)];
  const bodies: Record<string, string> = { ...await hintBodies(page) };

  await openExperiment(page);
  // A rule fault form renders the per-field help as a field description; its visible copy is the hint.
  await experimentDrawer(page).getByLabel("Fault", { exact: true }).selectOption(lesson === "saga-uncompensated" ? "network.response/drop" : "network.request/drop");
  await expect(experimentDrawer(page).getByLabel("Target", { exact: true })).toBeVisible();
  visible.push(await visibleText(page));
  Object.assign(bodies, await hintBodies(page));
  await experimentDrawer(page).getByRole("button", { name: "Close", exact: true }).click();

  await openServiceState(page);
  visible.push(await visibleText(page));
  Object.assign(bodies, await hintBodies(page));
  await page.keyboard.press("Escape");
  await expect(serviceStateDialog(page)).toBeHidden();

  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  const dialog = await openMoreFilters(page);
  visible.push(await visibleText(page));
  Object.assign(bodies, await hintBodies(page));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  return { bodies, visible };
}

for (const lesson of ["saga-uncompensated", "response-lost"] as const) {
  test(`moved explanations are unchanged in exactly one hint body and not in the layout: ${lesson} (#147)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/");
    const { bodies, visible } = await collectHints(page, lesson);
    for (const { sentence, bodyId } of moved.filter(item => item.lesson === lesson)) {
      const holders = Object.entries(bodies).filter(([, text]) => text.includes(sentence)).map(([id]) => id);
      expect(holders, `hint bodies holding "${sentence}"`).toEqual([bodyId]);
      for (const text of visible) expect(text, `visible layout must not show "${sentence}"`).not.toContain(sentence);
    }
    // No region's hint repeats another region's text.
    const sentences = Object.entries(bodies).flatMap(([id, text]) => text.split(/(?<=[.?!])\s+/).filter(Boolean).map(sentence => [id, sentence.trim()] as const));
    for (const [id, sentence] of sentences) {
      const others = sentences.filter(([other, text]) => other !== id && text === sentence).map(([other]) => other);
      expect(others, `"${sentence}" in ${id} is repeated in another hint`).toEqual([]);
    }
  });

  test(`no region renders more than one hint: ${lesson} (#147)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/");
    await completed(page, lesson);
    const count = (region: Locator) => region.locator(".help-hint").count();
    const sections = page.locator(".lesson-panel .lesson-step");
    expect(await sections.count()).toBe(4);
    for (let index = 0; index < 4; index++) expect(await count(sections.nth(index)), `Lesson panel section ${index + 1}`).toBeLessThanOrEqual(1);
    expect(await count(page.locator(".lesson-step-investigate"))).toBe(1);
    // The drawer stays mounted while closed, so its hint is counted without opening it.
    expect(await count(page.locator("#experiment-drawer")), "Experiment drawer").toBe(1);
    await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
    expect(await count(page.locator(".history-heading, .story-filter-bar")), "history toolbar").toBeLessThanOrEqual(1);
    const filters = await openMoreFilters(page);
    expect(await count(filters), "More filters").toBe(1);
    await filters.getByRole("button", { name: "Cancel", exact: true }).click();
    const dialog = await openServiceState(page);
    expect(await count(dialog), "Service state dialog").toBe(1);
  });
}

/** One hint's contract: hover and focus open it, Enter pins it, Escape closes it, and the trigger names its body. */
async function exerciseHint(page: Page, trigger: Locator, bodyId: string) {
  const body = page.locator(`#${bodyId}`);
  await expect(trigger).toHaveAttribute("aria-controls", bodyId);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();
  await trigger.hover();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await expect(body).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();
  // Pinned: it stays open when the pointer passes over and leaves it.
  await trigger.hover();
  await page.mouse.move(1, 1);
  await expect(body).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await trigger.focus();
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();
}

test("the Investigate, Experiment drawer, and Service state hints open, pin, and close (#147)", async ({ page }) => {
  test.setTimeout(120_000);
  await observeCommands(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await completed(page, "saga-uncompensated");
  const afterRun = await commands(page);

  await exerciseHint(page, page.getByRole("button", { name: "About these results", exact: true }), "investigate-help");

  await openExperiment(page);
  await exerciseHint(page, experimentDrawer(page).getByRole("button", { name: "About the experiment", exact: true }), "experiment-help");
  // Escape closed the hint only; the drawer is still open.
  await expect(experimentDrawer(page)).toBeVisible();
  await experimentDrawer(page).getByRole("button", { name: "Close", exact: true }).click();

  const dialog = await openServiceState(page);
  await exerciseHint(page, dialog.getByRole("button", { name: "About service state", exact: true }), "service-state-help");
  // Escape closed the hint only; the modal dialog is still open.
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  expect(await commands(page)).toEqual(afterRun);
});

test("the checkout Run overview's hint opens, pins, and closes (#147)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1534, height: 897 });
  await page.goto("/");
  await completed(page);
  await exerciseHint(page, page.getByRole("button", { name: "About these results", exact: true }), "investigate-help");
});
