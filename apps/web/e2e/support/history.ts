import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/**
 * The Recorded history filter controls (#145): Show and Component in the toolbar, everything else in the
 * More filters dialog. Tests reach the dialog through these helpers so later layout changes touch one file.
 */

export function moreFilters(page: Page): Locator {
  return page.getByRole("dialog", { name: "More filters", exact: true });
}

export function moreFiltersTrigger(page: Page): Locator {
  return page.getByRole("button", { name: "More filters…", exact: true });
}

/** Opens More filters and returns the dialog. */
export async function openMoreFilters(page: Page): Promise<Locator> {
  await moreFiltersTrigger(page).click();
  await expect(moreFilters(page)).toBeVisible();
  return moreFilters(page);
}

/** Applies the dialog's edits and waits for it to close. */
export async function applyMoreFilters(page: Page): Promise<void> {
  await moreFilters(page).getByRole("button", { name: "Apply", exact: true }).click();
  await expect(moreFilters(page)).toBeHidden();
}

/** Fills one text field in the open dialog, closing its suggestion list with Escape. */
export async function fillFilterField(page: Page, field: "type" | "traceId" | "eventId" | "entityKind" | "entityId", value: string): Promise<void> {
  const label = { type: "Type", traceId: "Trace", eventId: "Event", entityKind: "Entity kind", entityId: "Entity id" }[field];
  await moreFilters(page).getByLabel("Filter by", { exact: true }).selectOption(field);
  const input = moreFilters(page).getByLabel(label, { exact: true });
  await input.fill(value);
  // Escape closes an open suggestion list without closing the dialog.
  if ((await input.getAttribute("aria-expanded")) === "true") await input.press("Escape");
}

/** Narrows Recorded history to one Type through More filters, in one call. */
export async function filterByType(page: Page, type: string): Promise<void> {
  await openMoreFilters(page);
  await fillFilterField(page, "type", type);
  await applyMoreFilters(page);
}

/** The view switch's buttons: Story diagram and Story table. */
export function viewButton(page: Page, name: "Story diagram" | "Story table"): Locator {
  return page.getByRole("group", { name: "Timeline view", exact: true }).getByRole("button", { name, exact: true });
}
