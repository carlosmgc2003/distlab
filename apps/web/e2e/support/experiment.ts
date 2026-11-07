import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * The one place browser tests reach the Experiment drawer (#143): opened from ④ Experiment's
 * **Change the experiment…**, with a Design choices section, a Faults section, and one footer.
 */

/** The ④ Experiment trigger. Its name gains "unapplied changes" while the draft differs from the applied overlay. */
export function experimentTrigger(page: Page): Locator {
  return page.getByRole("complementary", { name: "Lesson", exact: true }).getByRole("button", { name: /^Change the experiment…/ });
}

export function experimentDrawer(page: Page): Locator {
  return page.getByRole("region", { name: "Change the experiment", exact: true });
}

export function faultsSection(page: Page): Locator {
  return experimentDrawer(page).getByRole("region", { name: "Faults", exact: true });
}

export function choicesSection(page: Page): Locator {
  return experimentDrawer(page).getByRole("region", { name: "Design choices", exact: true });
}

export function applyAndRestart(page: Page): Locator {
  return experimentDrawer(page).getByRole("button", { name: "Apply and restart", exact: true });
}

/** Opens the drawer if it is closed. */
export async function openExperiment(page: Page): Promise<void> {
  const trigger = experimentTrigger(page);
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(experimentDrawer(page)).toBeVisible();
}
