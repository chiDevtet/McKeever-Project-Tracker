import { expect, test } from "@playwright/test";
import { ADMIN, openProject, signIn } from "./helpers";

test("imports the supplied PDF for review without changing the plan, then commits it", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, ADMIN);
  const projectId = await openProject(page, "CMH139", "imports");
  const before = await page.request.post("/api/rpc/plans.view", { data: { projectId } }).then((r) => r.json());
  await page.setInputFiles("input[name=file]", "fixtures/source/CMH139_Preliminary_Schedule_2026-10-15.pdf");
  await page.fill("input[name=label]", "2026.10.15 Preliminary");
  await page.getByRole("button", { name: /Upload and extract/ }).click();
  await expect(page).toHaveURL(/imports\/[0-9a-f-]+$/);
  await expect(page.getByText("Current: Needs review")).toBeVisible({ timeout: 240_000 });
  const search = page.getByPlaceholder("Fire Alarm | VESDA | ERRS | ERRC");
  for (const [id, page_, start, finish] of [
    ["P1ER.1140", "26", "2027-06-01", "2027-06-07"],
    ["P1RP.1210", "28", "2027-06-21", "2027-07-02"],
    ["P1CX.2000", "31", "2027-07-06", "2027-07-07"],
  ]) {
    await search.fill(id);
    const row = page.locator("[role=rowgroup] [role=row]").first();
    await expect(row).toContainText(id);
    await expect(row).toContainText(page_);
    await expect(row.getByLabel("Reviewed date").nth(0)).toHaveValue(start);
    await expect(row.getByLabel("Reviewed date").nth(1)).toHaveValue(finish);
  }
  await search.fill("P1ER.1140");
  await page.locator("[role=rowgroup] [role=row]").first().click();
  await expect(page.getByAltText("Source schedule page 26")).toBeVisible();
  await search.fill("Fire Alarm | VESDA | ERRS | ERRC");
  await page.getByRole("button", { name: "Include as our scope" }).click();
  await expect(page.getByText("✓ Saved")).toBeVisible();
  await page.getByRole("button", { name: "Validate" }).click();
  await expect(page.getByText("Current: Validated")).toBeVisible();
  await page.getByRole("button", { name: "Commit source version" }).click();
  await expect(page.getByText("Current: Committed")).toBeVisible();
  const after = await page.request.post("/api/rpc/plans.view", { data: { projectId } }).then((r) => r.json());
  expect(after.result.data.plan.revision).toBe(before.result.data.plan.revision);
  expect(after.result.data.activities).toEqual(before.result.data.activities);
});

test("generates a PDF and an Excel workbook that download as real files", async ({ page }) => {
  await signIn(page, ADMIN);
  await openProject(page, "CMH139", "reports");
  const before = await page.locator('a:has-text("Download (")').count();
  await page.getByRole("button", { name: /Generate PDF \+ XLSX/ }).click();
  await expect.poll(async () => page.locator('a:has-text("Download (")').count(), { timeout: 120_000 }).toBeGreaterThanOrEqual(before + 2);
  const hrefs = await page.locator('a:has-text("Download (")').evaluateAll((as) => as.slice(0, 2).map((a) => (a as HTMLAnchorElement).href));
  const kinds = [];
  for (const href of hrefs) {
    const res = await page.request.get(href);
    expect(res.ok()).toBe(true);
    const body = await res.body();
    kinds.push(body.subarray(0, 4).toString("latin1"));
  }
  expect(kinds.sort()).toEqual(["%PDF", "PK\u0003\u0004"].sort());
});
