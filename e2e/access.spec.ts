import { expect, test } from "@playwright/test";
import { ADMIN, openProject, query, signIn, VIEWER } from "./helpers";

test("an internal viewer reads assigned projects only and cannot modify through the UI or direct requests", async ({ browser }) => {
  // Administrator creates a second project the viewer is not granted.
  const admin = await browser.newPage();
  await signIn(admin, ADMIN);
  await admin.goto("/projects");
  const code = `E2E${Date.now().toString(36).toUpperCase()}`;
  await admin.getByRole("button", { name: "New project" }).click();
  await admin.locator("#code").fill(code);
  await admin.locator("#name").fill("Isolation check");
  await admin.getByRole("dialog").locator("button[type=submit]").click();
  await expect(admin).toHaveURL(/\/projects\/[0-9a-f-]+\/manpower/);
  const otherId = admin.url().split("/projects/")[1].split("/")[0];

  const page = await browser.newPage();
  await signIn(page, VIEWER);
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: /CMH139/ }).first()).toBeVisible();
  await expect(page.getByText(code)).toHaveCount(0);
  const projectId = await openProject(page, "CMH139", "manpower");
  await expect(page.getByText("Read-only access")).toBeVisible();

  const view = await page.request.post("/api/rpc/plans.view", { data: { projectId } }).then((r) => r.json());
  const plan = view.result.data.plan;
  const pool = view.result.data.nodes.find((n: { kind: string }) => n.kind === "POOL");
  const edit = await page.request.post("/api/rpc/plans.applyOps", { data: { planId: plan.id, expectedRevision: plan.revision, ops: [{ type: "setWeeks", nodeKey: pool.key, values: [{ week: "2027-06-07", headcount: 99 }] }] } });
  expect(edit.status()).toBe(403);
  const other = await page.request.post("/api/rpc/plans.view", { data: { projectId: otherId } });
  expect(other.status()).toBe(404);
  // The page renders the not-found view (streamed pages may keep HTTP 200) and discloses nothing about the project.
  await page.goto(`/projects/${otherId}/manpower`);
  await expect(page.getByText(/not found|could not be found/i).first()).toBeVisible();
  await expect(page.getByText("Isolation check")).toHaveCount(0);

  // Files of a project the viewer cannot access are refused.
  const files = await query<{ id: string }>(`SELECT id FROM "StoredFile" WHERE "projectId" = $1 LIMIT 1`, [projectId]);
  if (files[0]) expect((await page.request.get(`/api/files/${files[0].id}`)).status()).toBe(200);
  const member = await query<{ userId: string }>(`SELECT "userId" FROM "WorkspaceMember" m JOIN "user" u ON u.id = m."userId" WHERE u.email = $1`, [VIEWER.email]);
  await admin.request.post("/api/rpc/users.revoke", { data: { projectId, userId: member[0].userId } });
  if (files[0]) expect((await page.request.get(`/api/files/${files[0].id}`)).status()).toBe(404);
  expect((await page.request.post("/api/rpc/plans.view", { data: { projectId } })).status()).toBe(404);
  await admin.request.post("/api/rpc/users.grant", { data: { projectId, userId: member[0].userId, role: "INTERNAL_VIEWER" } });
});
