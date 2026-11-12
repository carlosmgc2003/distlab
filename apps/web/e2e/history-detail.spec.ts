import { expect, test } from "./support/test.ts";
import type { Page } from "@playwright/test";
import { loadLesson } from "./support/lesson.ts";
import { viewButton } from "./support/history.ts";

/**
 * Observation detail is the docked right column of Recorded history (#146): it never floats over the
 * rows, the history toolbar, or the tabs, and it is the one visible statement of the selection.
 */

const views = ["Story diagram", "Story table"] as const;
const firstRow: Readonly<Record<(typeof views)[number], string>> = {
  "Story diagram": "#timeline-rows .story-milestone",
  "Story table": "#timeline-rows .story-table button[data-observation-id]",
};

async function completedHistory(page: Page) {
  await page.goto("/");
  await loadLesson(page, "response-lost");
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("READY");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText("COMPLETED");
  await page.getByRole("tab", { name: "Recorded history", exact: true }).click();
}

/** Records every text a live region takes, in order, from now on. */
async function recordLiveRegions(page: Page) {
  await page.evaluate(() => {
    const seen: { region: string; text: string }[] = [];
    (window as unknown as { liveTexts: typeof seen }).liveTexts = seen;
    for (const region of document.querySelectorAll("[aria-live], [role=status], [role=alert], [role=log]")) {
      const name = region.id || region.getAttribute("aria-label") || region.className;
      new MutationObserver(() => seen.push({ region: name, text: region.textContent ?? "" }))
        .observe(region, { childList: true, characterData: true, subtree: true });
    }
  });
}

/**
 * Elements outside `#timeline-rows` whose visible text contains `pattern`: rendered, not clipped to
 * an `sr-only` box, and not inside a closed disclosure.
 */
function visibleTextOutsideRows(page: Page, pattern: string) {
  return page.evaluate(source => {
    const matcher = new RegExp(source);
    const rows = document.getElementById("timeline-rows");
    // React splits text into several nodes, so match the deepest element whose whole text matches.
    const found = [...document.body.querySelectorAll("*")].filter(element => {
      if (!matcher.test(element.textContent ?? "") || rows?.contains(element)) return false;
      if ([...element.children].some(child => matcher.test(child.textContent ?? ""))) return false;
      if (!element.checkVisibility({ visibilityProperty: true })) return false;
      const box = element.getBoundingClientRect();
      return box.width > 1 && box.height > 1;
    });
    return found.map(element => ({ tag: element.tagName.toLowerCase(), className: element.className, text: (element.textContent ?? "").trim() }));
  }, pattern);
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1534, height: 897 }]) {
  test(`the docked detail covers no tab, toolbar, or row at ${viewport.width}x${viewport.height} in every view, and states the selection once`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await completedHistory(page);
    const detail = page.locator("#inspection-panel");
    await expect(detail).toContainText("Select an observation to see its detail.");
    for (const view of views) {
      await viewButton(page, view).click();
      await expect(viewButton(page, view)).toHaveAttribute("aria-pressed", "true");
      const row = page.locator(firstRow[view]).first();
      await row.click();
      await expect(row).toHaveAttribute("aria-pressed", "true");
      const header = detail.locator(".detail-header");
      await expect(header).toHaveText(/^Observation #\d+ · .+ · t=\d+$/);
      const sequence = /#(\d+)/.exec(await header.innerText())![1]!;

      const box = (await detail.boundingBox())!;
      for (const [name, locator] of [
        ["tablist", page.getByRole("tablist", { name: "Investigation workspace" })],
        ["history heading", page.locator(".history-heading")],
        ["filter row", page.locator(".story-filter-bar")],
        ["rows", page.locator("#timeline-rows")],
      ] as const) {
        const other = (await locator.boundingBox())!;
        const overlaps = box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height;
        expect(overlaps, `${view}: the detail overlaps the ${name}`).toBe(false);
      }

      const statements = await visibleTextOutsideRows(page, `#${sequence}(?!\\d)`);
      expect(statements, `${view}: #${sequence} is visible once, in the detail header`).toEqual([
        { tag: "h3", className: "detail-header", text: await header.innerText() },
      ]);
      expect(await visibleTextOutsideRows(page, "Step #"), `${view}: no visible Step #`).toEqual([]);
    }
  });
}

test("a selection is announced once, by one live region", async ({ page }) => {
  await completedHistory(page);
  await viewButton(page, "Story table").click();
  await recordLiveRegions(page);
  const rows = page.locator("#timeline-rows .story-table button[data-observation-id]");
  await rows.nth(1).click();
  const sequence = /#(\d+)/.exec(await page.locator("#inspection-panel .detail-header").innerText())![1]!;
  const mentions = async () => (await page.evaluate(() => (window as unknown as { liveTexts: { region: string; text: string }[] }).liveTexts))
    .filter(entry => new RegExp(`#${sequence}(?!\\d)`).test(entry.text));
  await expect.poll(mentions).toHaveLength(1);
  expect((await mentions())[0]!.region).toBe("timeline-feedback");
  // Each further selection is announced once more, by the same region.
  await rows.nth(2).click();
  const next = /#(\d+)/.exec(await page.locator("#inspection-panel .detail-header").innerText())![1]!;
  expect(next).not.toBe(sequence);
  const announced = (await page.evaluate(() => (window as unknown as { liveTexts: { region: string; text: string }[] }).liveTexts))
    .filter(entry => new RegExp(`#${next}(?!\\d)`).test(entry.text));
  expect(announced.map(entry => entry.region)).toEqual(["timeline-feedback"]);
});

test("an active filter shows its result count once, next to the filter row", async ({ page }) => {
  await completedHistory(page);
  await expect(page.locator(".timeline-shown")).toHaveCount(0);
  await page.getByLabel("Show", { exact: true }).selectOption("faults-and-timeouts");
  const shown = page.locator(".story-filter-bar .timeline-shown");
  await expect(shown).toHaveText(/^\d+ of \d+ milestones shown$/);
  const [count, total] = (await shown.innerText()).match(/\d+/g)!;
  expect(await visibleTextOutsideRows(page, `\\b${count} of ${total}\\b`)).toHaveLength(1);
  await expect(page.getByText(/Visible observation \d+ of \d+/)).toBeHidden();
});
