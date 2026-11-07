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

test("CMH139 shows the seeded manpower forecast as installer and ground support capacity", async ({ page }) => {
  await signIn(page, ADMIN);
  await openProject(page, "CMH139", "manpower");
  await showWeek(page, "2027-07-05");
  // July 2027 in the 6 Nov 2026 forecast: installation 9-12 and ground support 2-3, planned at the upper figure.
  const row = (key: string, week: string) => page.locator(`[data-cell="node:${key}|${week}"]`);
  await expect(row("cmh139-installer-pool", "2027-07-05")).toHaveText("12");
  await expect(row("cmh139-ground-support", "2027-07-05")).toHaveText("3");
  // August: up to 12 + 4, the forecast's short-duration combined peak of 16.
  await expect(row("cmh139-ground-support", "2027-08-02")).toHaveText("4");
  await expect(page.getByText("Ground support — ACE site safety").first()).toBeVisible();
  await expect(page.getByText(/Phase \d installers \(planned\)/)).toHaveCount(0);
});

test("grid edits save with visible status, persist on reload, and reject fractional people", async ({ page }) => {
  await signIn(page, ADMIN);
  await openProject(page, "CMH139", "manpower");
  // Weeks after the seed-owned forecast range (through 30 Apr 2028), where the pool has nothing scheduled.
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
