import { expect, test } from "@playwright/test";
import { ADMIN, openProject, signIn } from "./helpers";

const cell = (page: import("@playwright/test").Page, week: string) => page.locator(`[data-cell^="node:"][data-cell$="|${week}"]`).first();

/** Show ten weeks from `week`, retrying until hydration has finished and the column is shown. */
async function showWeek(page: import("@playwright/test").Page, week: string) {
  const later = new Date(Date.parse(`${week}T00:00:00Z`) + 70 * 86_400_000).toISOString().slice(0, 10);
  await expect(async () => {
    await page.locator("input[type=date]").nth(1).fill(later);
    await page.locator("input[type=date]").first().fill(week);
    await expect(cell(page, week)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test("CMH139 shows the seeded phase reservations and pool capacity in the grid", async ({ page }) => {
  await signIn(page, ADMIN);
  await openProject(page, "CMH139", "manpower");
  await showWeek(page, "2027-05-31");
  // Phases 1-3 are active the week of 31 May 2027: 3 x 8 planned installers.
  await expect(cell(page, "2027-05-31")).toHaveText("24");
  for (const n of [1, 2, 3, 4, 5, 6]) await expect(page.getByText(`Phase ${n} installers (planned)`).first()).toBeVisible();
});

test("grid edits save with visible status, persist on reload, and reject fractional people", async ({ page }) => {
  await signIn(page, ADMIN);
  await openProject(page, "CMH139", "manpower");
  // Weeks after the last phase window (28 Apr 2028), where the pool has no reservations to supply.
  await showWeek(page, "2028-05-08");
  await cell(page, "2028-05-08").click();
  await page.keyboard.type("8");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Saved · revision \d+/)).toBeVisible();
  await page.reload();
  await showWeek(page, "2028-05-08");
  await expect(cell(page, "2028-05-08")).toHaveText("8");
  await expect(page.getByText("Peak onsite (period)")).toBeVisible();

  await cell(page, "2028-05-08").click();
  await page.keyboard.type("2.5");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/whole number/i).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await showWeek(page, "2028-05-08");
  await expect(cell(page, "2028-05-08")).toHaveText("8");
});

test("a stale window cannot overwrite a newer revision; the operator reconciles explicitly", async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  for (const p of [a, b]) {
    await signIn(p, ADMIN);
    await openProject(p, "CMH139", "manpower");
    await showWeek(p, "2028-05-08");
  }
  await cell(a, "2028-05-15").click();
  await a.keyboard.type("5");
  await a.keyboard.press("Enter");
  await expect(a.getByText(/Saved · revision \d+/)).toBeVisible();
  // b still holds the older revision.
  await cell(b, "2028-05-22").click();
  await b.keyboard.type("4");
  await b.keyboard.press("Enter");
  const dialog = b.getByRole("alertdialog", { name: "Newer revision saved elsewhere" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("nothing was overwritten");
  await dialog.getByRole("button", { name: "Reload and re-apply my change" }).click();
  await expect(b.getByText(/Saved · revision \d+/)).toBeVisible();
  await a.reload();
  await showWeek(a, "2028-05-08");
  await expect(cell(a, "2028-05-15")).toHaveText("5");
  await expect(cell(a, "2028-05-22")).toHaveText("4");
});
