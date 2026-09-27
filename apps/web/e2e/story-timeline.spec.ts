import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Observation, RuntimeProjectionSet, WorkerCommand, WorkerEvent } from "@distlab/contracts";

declare global {
  interface Window {
    storyEvidence: { commands: WorkerCommand[]; events: WorkerEvent[] };
  }
}

async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.storyEvidence = { commands: [], events: [] };
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", event => window.storyEvidence.events.push(structuredClone(event.data)));
      }
      override postMessage(command: WorkerCommand) {
        window.storyEvidence.commands.push(structuredClone(command));
        super.postMessage(command);
      }
    };
  });
}

async function latestProjection(page: Page): Promise<RuntimeProjectionSet> {
  return page.evaluate(() => {
    const latest = window.storyEvidence.events.filter(event => "projection" in event).at(-1);
    if (!latest || !("projection" in latest)) throw new Error("Missing worker projection");
    return latest.projection;
  });
}

async function commandTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => window.storyEvidence.commands.map(command => command.type));
}

/** Independent restatement of the teaching rule: only stored milestone records. */
const STORY_TYPES = new Set([
  "network.request.sent", "network.request.delivered", "network.request.dropped", "network.request.timedout",
  "network.response.sent", "network.response.received", "network.response.dropped",
  "message.published", "message.delivered", "message.acknowledged", "message.ack.stale", "message.retry.scheduled",
  "database.transaction.committed", "database.transaction.rolledback", "external.effect.committed",
  "fault.effect.selected", "fault.rule.matched",
]);

function expectedMilestones(observations: readonly Observation[]): readonly Observation[] {
  return observations.filter(observation => STORY_TYPES.has(observation.type) || observation.type.startsWith("fault."));
}

function rowSelector(observation: Observation): string {
  return `.story-table button[data-observation-id="${observation.id}"]`;
}

async function runScenario(page: Page, scenario: string) {
  await page.goto("/");
  await page.getByLabel("Scenario", { exact: true }).selectOption(scenario);
  await page.getByRole("button", { name: "Load scenario" }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
}

test("Story reduces a completed checkout to labeled milestones and keeps Learning and Raw", async ({ page }) => {
  test.setTimeout(90_000);
  await observeWorker(page);
  await page.setViewportSize({ width: 1534, height: 897 });
  await runScenario(page, "normal");
  const observations = (await latestProjection(page)).history.observations;
  const before = await commandTypes(page);

  await expect(page.getByRole("button", { name: "Story", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Learning", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".timeline-count")).toHaveText(
    new RegExp(`^\\d+ teaching milestones from ${observations.length} recorded observations\\.`),
  );
  const rows = page.locator(".story-table tbody tr");
  const milestoneCount = await rows.count();
  expect(milestoneCount).toBeGreaterThan(0);
  expect(milestoneCount).toBeLessThan(observations.length);
  // Order and identity come only from canonical observation sequence and ids.
  const expected = expectedMilestones(observations);
  const tableRows = page.locator(".story-table tbody tr");
  const tableText = await tableRows.allInnerTexts();
  const rowIds = await page.locator(".story-table button[data-observation-id]").evaluateAll(
    buttons => buttons.map(button => button.getAttribute("data-observation-id") ?? ""));
  expect(rowIds).toEqual(expected.map(observation => observation.id));
  const sequences = tableText.map(text => Number(/#(\d+)/.exec(text)?.[1]));
  expect(sequences).toEqual(expected.map(observation => observation.sequence));
  for (const [index, observation] of expected.entries()) {
    expect(tableText[index]).toContain(`t=${observation.time}`);
    expect(tableText[index]).toContain(observation.source);
  }

  // Accessible summary, shapes, and labeled boundaries.
  await expect(page.locator(".story-view")).toContainText("no elapsed duration between milestones is stored");
  await expect(page.locator("#story-summary")).toContainText("component lanes");
  await expect(page.locator("#story-summary")).toContainText("The first milestone is recorded at virtual time 0");
  const legend = await page.locator(".story-legend li").allInnerTexts();
  expect(legend.length).toBeGreaterThan(1);
  for (const entry of legend) expect(entry).toMatch(/[A-Za-z]/);
  await expect(page.locator(".story-time[data-boundary='true']").first()).toContainText("t=");
  await expect(page.locator(".story-milestone[data-selected='false']").first()).toBeVisible();

  const sent = expected.find(observation => observation.type === "network.request.sent")!;
  const tableRow = page.locator(rowSelector(sent));
  const stripMilestone = page.locator(".story-strip .story-milestone").filter({ hasText: "Request sent" }).first();

  // A visual milestone and its accessible row produce the same detail and emphasis.
  await stripMilestone.click();
  const fromStrip = await page.getByRole("region", { name: "Observation detail" }).innerText();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  const cueFromStrip = await page.locator("#movement-cue").innerText();
  expect(fromStrip).toContain(sent.id);
  expect(cueFromStrip).toContain("Request sent");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await page.getByRole("button", { name: "Story", exact: true }).click();
  await tableRow.click();
  expect(await page.getByRole("region", { name: "Observation detail" }).innerText()).toBe(fromStrip);
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  expect(await page.locator("#movement-cue").innerText()).toBe(cueFromStrip);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await expect(tableRow).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".story-table tr[data-selected='true']")).toHaveCount(1);
  await expect(page.locator(".story-milestone[data-selected='true']")).toHaveCount(1);

  // Story selection and playback stay inside the presentation layer.
  expect(await commandTypes(page)).toEqual(before);
  await page.getByRole("button", { name: "Play timeline" }).click();
  await expect(page.locator("#timeline-playback")).toContainText("Playing the visible timeline.");
  await page.getByRole("button", { name: "Pause timeline" }).click();
  expect(await commandTypes(page)).toEqual(before);
  await page.getByRole("button", { name: "Story", exact: true }).click();

  // Learning and Raw keep every record.
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await expect(page.locator(".timeline-count")).toContainText("records summarized");
  await expect(page.locator(".learning-rows, .learning-group").first()).toBeVisible();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await expect(page.locator(".timeline-count")).toContainText(`${observations.length} of ${observations.length}`);
  await page.getByRole("button", { name: "Story", exact: true }).click();
  await expect(page.locator(".timeline-count")).toContainText("teaching milestones from");

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "e2e/evidence/issue-67-story-timeline-normal.png", fullPage: true });
});

test("response-lost Story milestones stay linked to their records without new commands", async ({ page }) => {
  test.setTimeout(90_000);
  await observeWorker(page);
  await page.setViewportSize({ width: 1534, height: 897 });
  await runScenario(page, "response-lost");
  const observations = (await latestProjection(page)).history.observations;
  const before = await commandTypes(page);

  const expected = ["Request sent", "Request delivered", "Response sent", "Response received",
    "External side effect committed", "Response dropped", "Message retry scheduled", "Request timed out",
    "Message delivered", "Transaction rolled back", "Message acknowledged"];
  for (const label of expected) {
    await expect(page.locator(".story-milestone").filter({ hasText: label }).first()).toBeVisible();
  }
  const dropped: Observation = observations.find(observation => observation.type === "network.response.dropped")!;
  const timedOut = observations.find(observation => observation.type === "network.request.timedout")!;
  const rolledBack = observations.find(observation => observation.type === "database.transaction.rolledback")!;

  const dropRow = page.locator(rowSelector(dropped));
  await page.locator(".story-strip .story-milestone").filter({ hasText: "Response dropped" }).first().click();
  const stripDetail = await page.getByRole("region", { name: "Observation detail" }).innerText();
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  const stripCue = await page.locator("#movement-cue").innerText();
  expect(stripDetail).toContain(dropped.id);
  expect(stripCue).toContain("Response dropped");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
  await page.getByRole("button", { name: "Story", exact: true }).click();
  await dropRow.click();
  expect(await page.getByRole("region", { name: "Observation detail" }).innerText()).toBe(stripDetail);
  await page.getByRole("tab", { name: "Architecture", exact: true }).click();
  expect(await page.locator("#movement-cue").innerText()).toBe(stripCue);
  await expect(page.locator(".react-flow__node.is-involved")).toHaveCount(2);
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();

  await dropRow.click();
  await expect(page.locator("#timeline-feedback")).toContainText(`Selected #${dropped.sequence}`);

  // A timeout is a distinct stored fact from the dropped response and the commit.
  for (const [label, observation] of [["Request timed out", timedOut], ["Transaction rolled back", rolledBack]] as const) {
    await page.locator(rowSelector(observation)).click();
    const detail = page.getByRole("region", { name: "Observation detail" });
    await expect(detail).toContainText(observation.id);
    await expect(page.locator("#timeline-feedback")).toContainText(`Selected #${observation.sequence}`);
    expect(await page.locator(".story-table tr[data-selected='true'] button").innerText()).toBe(label);
  }
  await expect(page.locator(".story-table tr[data-selected='true']")).toHaveCount(1);
  expect(await commandTypes(page)).toEqual(before);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "e2e/evidence/issue-67-story-timeline-response-lost.png", fullPage: true });
});
