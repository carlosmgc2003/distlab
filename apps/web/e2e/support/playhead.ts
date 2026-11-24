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
