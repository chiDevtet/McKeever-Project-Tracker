import { expect, test } from "@playwright/test";
import { ADMIN, openProject, signIn } from "./helpers";

const cell = (page: import("@playwright/test").Page, week: string) => page.locator(`[data-cell^="node:"][data-cell$="|${week}"]`).first();

test("grid edits save with visible status, persist on reload, and reject fractional people", async ({ page }) => {
  await signIn(page, ADMIN);
  await openProject(page, "CMH139", "manpower");
  await page.locator("input[type=date]").first().fill("2027-06-07");
  await cell(page, "2027-06-07").click();
  await page.keyboard.type("8");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Saved · revision \d+/)).toBeVisible();
  await page.reload();
  await page.locator("input[type=date]").first().fill("2027-06-07");
  await expect(cell(page, "2027-06-07")).toHaveText("8");
  await expect(page.getByText("Peak onsite (period)")).toBeVisible();

  await cell(page, "2027-06-07").click();
  await page.keyboard.type("2.5");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/whole number/i).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.locator("input[type=date]").first().fill("2027-06-07");
  await expect(cell(page, "2027-06-07")).toHaveText("8");
});

test("a stale window cannot overwrite a newer revision; the operator reconciles explicitly", async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  for (const p of [a, b]) {
    await signIn(p, ADMIN);
    await openProject(p, "CMH139", "manpower");
    await p.locator("input[type=date]").first().fill("2027-06-07");
  }
  await cell(a, "2027-06-14").click();
  await a.keyboard.type("5");
  await a.keyboard.press("Enter");
  await expect(a.getByText(/Saved · revision \d+/)).toBeVisible();
  // b still holds the older revision.
  await cell(b, "2027-06-21").click();
  await b.keyboard.type("4");
  await b.keyboard.press("Enter");
  const dialog = b.getByRole("alertdialog", { name: "Newer revision saved elsewhere" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("nothing was overwritten");
  await dialog.getByRole("button", { name: "Reload and re-apply my change" }).click();
  await expect(b.getByText(/Saved · revision \d+/)).toBeVisible();
  await a.reload();
  await a.locator("input[type=date]").first().fill("2027-06-07");
  await expect(cell(a, "2027-06-14")).toHaveText("5");
  await expect(cell(a, "2027-06-21")).toHaveText("4");
});
