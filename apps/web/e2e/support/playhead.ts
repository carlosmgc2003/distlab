import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** One control of the top bar's **Simulation execution** group (RFC 0002 P2). */
export function control(page: Page, name: string): Locator {
  return page.getByRole("group", { name: "Simulation execution" }).getByRole("button", { name, exact: true });
}

export function playheadPosition(page: Page): Locator {
  return page.getByRole("status", { name: "Playhead position" });
}

/** The narration heading of the milestone under the playhead, on one line, or "" when none is shown. */
export async function narrationHeading(page: Page): Promise<string> {
  const heading = page.locator(".flight-narration h4");
  if (await heading.count() === 0) return "";
  return (await heading.innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Steps the playhead to the next milestone that travels a link and whose stored headline is
 * `headline` (any movement when omitted). The first Step after a load executes the run.
 * Records that travel no link are stepped over.
 */
export async function stepToMovement(page: Page, headline?: string): Promise<void> {
  const step = control(page, "Step");
  const token = page.locator("[data-flight-token]");
  const matches = async () => await token.count() > 0
    && (headline === undefined || (await narrationHeading(page)).endsWith(` ${headline}`));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await step.getAttribute("aria-disabled") === "true" && await page.locator(".flight-narration").count() > 0) break;
    await step.click();
    await expect(playheadPosition(page)).toHaveText(/^Milestone \d+ of \d+/);
    if (await matches()) return;
  }
  expect(await narrationHeading(page), `a movement${headline ? ` "${headline}"` : ""} is under the playhead`).toMatch(headline ? new RegExp(` ${headline}$`) : /./);
}

/** The **Animation** switch above the graph (RFC 0002 P3). */
export function animationSwitch(page: Page): Locator {
  return page.getByRole("switch", { name: "Animation", exact: true });
}

/**
 * Turns Animation off, so `Run` shows the end of the run at once and ③ Investigate reveals the
 * outcome as soon as the run has executed (RFC 0002 P5). The setting survives lesson loads.
 */
export async function animationOff(page: Page): Promise<void> {
  const toggle = animationSwitch(page);
  const tab = page.getByRole("tab", { name: "Architecture", exact: true });
  await expect(tab).toBeVisible();
  if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
  await expect(toggle).toBeVisible();
  if (await toggle.isChecked()) await toggle.click();
  await expect(toggle).not.toBeChecked();
}

/** Runs the loaded lesson to its end with Animation off: the outcome is revealed at once. */
export async function runToEnd(page: Page): Promise<void> {
  await animationOff(page);
  await control(page, "Run").click();
  await expect(page.getByRole("status", { name: "Simulation status" })).toHaveText(/^(COMPLETED|FAILED)$/);
}
