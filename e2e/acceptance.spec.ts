import { expect, test, type Page } from "@playwright/test";
import { ADMIN, signIn } from "./helpers";

async function rpc<T = Record<string, unknown>>(page: Page, name: string, input: unknown): Promise<T> {
  const res = await page.request.post(`/api/rpc/${name}`, { data: input });
  const body = await res.json();
  if (!body.ok) throw new Error(`${name}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

async function weekTotals(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}/manpower`);
  await page.locator("input[type=date]").first().fill("2027-03-01");
  const out: Record<string, string> = {};
  for (const row of ["Peak installers onsite", "Peak total onsite", "Installer hours", "Leadership hours", "Total onsite hours", "Project calendar hours"]) {
    const tr = page.locator("tr", { has: page.locator("td,th", { hasText: new RegExp(`^${row}$`) }) }).first();
    out[row] = (await tr.locator("td").nth(0).innerText()).trim();
  }
  return out;
}

test("A03 on screen and A08 calendar acceleration with preview, cancel, and apply", async ({ page }) => {
  await signIn(page, ADMIN);
  const project = await rpc<{ id: string }>(page, "projects.create", { code: `ACC${Date.now().toString(36).toUpperCase()}`, name: "Acceptance check (illustrative)" });
  const view = await rpc<{ data: { plan: { id: string; revision: number }; nodes: { key: string; kind: string }[] } }>(page, "plans.view", { projectId: project.id });
  const pool = view.data.nodes.find((n) => n.kind === "POOL")!.key;
  const lead = (key: string, name: string, role: string) => ({ type: "upsertLeadership", assignment: { key, personId: null, personName: name, role, responsibilitySystemIds: [], responsibilityPhaseIds: [], responsibilityNote: null, startDate: "2027-03-01", endDate: "2027-03-05", onsiteMode: "PROJECT_CALENDAR", onsiteWeekdays: [], onsiteHours: null, onsiteStart: null, offsiteHoursPerWeek: null, dayOverrides: [], notes: null, sortOrder: 0 } });
  await rpc(page, "plans.applyOps", { planId: view.data.plan.id, expectedRevision: view.data.plan.revision, ops: [{ type: "setWeeks", nodeKey: pool, values: [{ week: "2027-03-01", headcount: 8 }] }, lead("pm", "Illustrative PM", "Project manager"), lead("fm", "Illustrative foreman", "Main foreman")] });

  // A03: 10 peak onsite, 320 installer hours, 80 leadership hours, 400 total.
  expect(await weekTotals(page, project.id)).toMatchObject({ "Peak total onsite": "10", "Installer hours": "320", "Leadership hours": "80", "Total onsite hours": "400" });

  const previewSixTens = async () => {
    await page.goto(`/projects/${project.id}/setup`);
    await page.getByRole("button", { name: "Add period" }).click();
    await page.getByLabel("Period start").fill("2027-03-01");
    await page.getByLabel("Period end").fill("2027-03-07");
    await page.getByLabel("Period label").fill("Acceleration week");
    await page.getByRole("button", { name: "Add period to draft" }).click();
    await page.getByRole("button", { name: "Preview calendar change" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("tr", { hasText: "01 Mar 2027" })).toContainText("320 → 480");
    await expect(dialog.locator("tr", { hasText: "01 Mar 2027" })).toContainText("8 → 8");
    return dialog;
  };
  // A08: preview shows 480 installer hours with peak eight; cancel leaves the week unchanged.
  await (await previewSixTens()).getByRole("button", { name: "Cancel" }).click();
  expect(await weekTotals(page, project.id)).toMatchObject({ "Installer hours": "320", "Project calendar hours": "40" });
  await (await previewSixTens()).getByRole("button", { name: /Apply/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await weekTotals(page, project.id)).toMatchObject({ "Peak installers onsite": "8", "Installer hours": "480", "Project calendar hours": "60" });
});
