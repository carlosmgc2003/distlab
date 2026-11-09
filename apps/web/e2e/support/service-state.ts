import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * The one place browser tests reach the Service state dialog (#142): a modal opened from ③ Investigate's
 * **Show service state**, holding the commerce per-service facts or checkout's Distributed state.
 */

export function serviceStateButton(page: Page): Locator {
  return page.getByRole("complementary", { name: "Lesson", exact: true }).getByRole("button", { name: "Show service state", exact: true });
}

export function serviceStateDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: /^Service state at t=/ });
}

/** Opens the dialog and returns it. */
export async function openServiceState(page: Page): Promise<Locator> {
  await serviceStateButton(page).click();
  await expect(serviceStateDialog(page)).toBeVisible();
  return serviceStateDialog(page);
}

/** Closes the dialog with Escape, as a keyboard user would. */
export async function closeServiceState(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(serviceStateDialog(page)).toBeHidden();
}

/** Runs `inspect` with the dialog open, then closes it. */
export async function inServiceState<T>(page: Page, inspect: (dialog: Locator) => Promise<T>): Promise<T> {
  const dialog = await openServiceState(page);
  const result = await inspect(dialog);
  await closeServiceState(page);
  return result;
}
