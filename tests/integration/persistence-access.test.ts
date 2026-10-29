import { beforeAll, describe, expect, it } from "vitest";
import { computeMeasures } from "@/domain/metrics";
import { viewerForUser, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { enqueueJob, QUEUES } from "@/server/jobs/queue";
import { loadPlanData, mutatePlan } from "@/server/plan-store";
import { applyPlanOps, getPlanView } from "@/server/services/plans";
import { setUserStatus } from "@/server/services/users";
import { runJob } from "@/worker/runner";
import { makeProject, makeUser, refreshViewer, workspaceId } from "./helpers";

const WEEK = "2027-06-07";

describe("persistence, edit conflicts, and atomic saves (A07, A23)", () => {
  let admin: Viewer;
  let projectId: string;
  let planId: string;
  let pool: string;

  beforeAll(async () => {
    admin = await makeUser({ admin: true });
    projectId = (await makeProject(admin)).id;
    admin = await refreshViewer(admin);
    const v = (await getPlanView(admin, projectId)).data;
    planId = v.plan.id;
    pool = v.nodes.find((n) => n.kind === "POOL")!.key;
  });

  it("saves, reloads, and reproduces dates, staffing, and totals", async () => {
    const v = (await getPlanView(admin, projectId)).data;
    const saved = await applyPlanOps(admin, {
      planId,
      expectedRevision: v.plan.revision,
      ops: [
        { type: "addActivity", activity: { key: "a1", code: "", name: "Rough-in", phaseId: null, areaId: null, systemId: null, calendarKey: null, plannedStart: WEEK, plannedFinish: "2027-06-11", notes: "note", sortOrder: 0, archived: false } },
        { type: "setWeeks", nodeKey: pool, values: [{ week: WEEK, headcount: 8 }] },
        { type: "setDay", nodeKey: pool, date: "2027-06-09", headcount: 6, hours: 10 },
      ],
    });
    const reloaded = await loadPlanData(prisma, planId);
    expect(reloaded.activities).toEqual(saved.data.activities);
    expect(reloaded.entries).toEqual(saved.data.entries);
    const a = computeMeasures(saved.data, WEEK, WEEK).totals;
    const b = computeMeasures(reloaded, WEEK, WEEK).totals;
    expect(b).toEqual(a);
    expect(b).toMatchObject({ peakInstallers: 8, installerHours: 4 * 8 * 8 + 6 * 10 });
  });

  it("rejects a stale edit instead of overwriting the newer revision", async () => {
    const v = (await getPlanView(admin, projectId)).data;
    await applyPlanOps(admin, { planId, expectedRevision: v.plan.revision, ops: [{ type: "setWeeks", nodeKey: pool, values: [{ week: WEEK, headcount: 9 }] }] });
    // A second browser still holding the old revision.
    await expect(applyPlanOps(admin, { planId, expectedRevision: v.plan.revision, ops: [{ type: "setWeeks", nodeKey: pool, values: [{ week: WEEK, headcount: 2 }] }] })).rejects.toMatchObject({ status: 409, code: "stale_revision" });
    const now = await loadPlanData(prisma, planId);
    expect(now.entries.find((e) => e.nodeKey === pool && e.kind === "WEEK")?.headcount).toBe(9);
  });

  it("concurrent saves from one revision: exactly one wins", async () => {
    const v = (await getPlanView(admin, projectId)).data;
    const results = await Promise.allSettled([3, 4, 5].map((n) => applyPlanOps(admin, { planId, expectedRevision: v.plan.revision, ops: [{ type: "setWeeks", nodeKey: pool, values: [{ week: "2027-06-14", headcount: n }] }] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: planId } })).revision).toBe(v.plan.revision + 1);
  });

  it("a failed multi-record save leaves no half-applied plan", async () => {
    const before = await loadPlanData(prisma, planId);
    // The second op is invalid, so the first must not be applied either.
    await expect(applyPlanOps(admin, { planId, expectedRevision: before.plan.revision, ops: [{ type: "setWeeks", nodeKey: pool, values: [{ week: "2027-06-21", headcount: 7 }] }, { type: "removeNode", key: "does-not-exist" }] })).rejects.toThrow();
    // A failure after rows are written (inside the transaction) rolls everything back, including the revision.
    await expect(
      mutatePlan(admin, planId, before.plan.revision, [{ type: "setWeeks", nodeKey: pool, values: [{ week: "2027-06-21", headcount: 7 }] }], {
        summary: "test",
        alsoWrite: async () => {
          throw new Error("simulated failure after writing");
        },
      }),
    ).rejects.toThrow(/simulated failure/);
    const after = await loadPlanData(prisma, planId);
    expect(after.plan.revision).toBe(before.plan.revision);
    expect(after.entries).toEqual(before.entries);
    expect(await prisma.planRevision.count({ where: { planId, revision: before.plan.revision + 1 } })).toBe(0);
  });

  it("sequential reservations count once; an overlapping duplicate reservation is rejected with the conflict identified (A07)", async () => {
    const v = (await getPlanView(admin, projectId)).data;
    const r = await applyPlanOps(admin, {
      planId,
      expectedRevision: v.plan.revision,
      ops: [
        { type: "setWeeks", nodeKey: pool, values: [{ week: "2027-07-05", headcount: 4 }] },
        { type: "addNode", node: { key: "crew-a", parentKey: pool, kind: "RESERVATION", name: "Crew A", role: "Installer", phaseId: null, areaId: null, systemId: null, activityKey: null, calendarKey: null, notes: null, sortOrder: 0 } },
        { type: "setBlocks", nodeKey: "crew-a", date: "2027-07-06", blocks: [{ startTime: "07:00", endTime: "10:00", headcount: 4 }, { startTime: "11:00", endTime: "15:00", headcount: 4 }] },
      ],
    });
    const day = computeMeasures(r.data, "2027-07-05", "2027-07-05", {}, { days: true }).days.find((d) => d.start === "2027-07-06")!;
    expect(day.installerPeak).toBe(4);
    const before = await loadPlanData(prisma, planId);
    const attempt = applyPlanOps(admin, {
      planId,
      expectedRevision: r.revision,
      ops: [
        { type: "addNode", node: { key: "crew-b", parentKey: pool, kind: "RESERVATION", name: "Crew B", role: "Installer", phaseId: null, areaId: null, systemId: null, activityKey: null, calendarKey: null, notes: null, sortOrder: 1 } },
        { type: "setBlocks", nodeKey: "crew-b", date: "2027-07-06", blocks: [{ startTime: "09:00", endTime: "13:00", headcount: 4 }] },
      ],
    });
    await expect(attempt).rejects.toMatchObject({ status: 422, code: "validation_failed" });
    await expect(attempt).rejects.toThrow(/Installers — shared workforce/);
    expect((await loadPlanData(prisma, planId)).nodes).toEqual(before.nodes);
  });
});

describe("project and permission isolation (A22)", () => {
  let admin: Viewer;
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    admin = await makeUser({ admin: true });
    projectA = (await makeProject(admin)).id;
    projectB = (await makeProject(admin)).id;
    admin = await refreshViewer(admin);
  });

  it("an internal viewer reads only assigned projects and cannot modify them", async () => {
    const viewer = await makeUser({ grants: [[projectA, "INTERNAL_VIEWER"]] });
    const view = await getPlanView(viewer, projectA);
    expect(view.canEdit).toBe(false);
    await expect(applyPlanOps(viewer, { planId: view.data.plan.id, expectedRevision: view.data.plan.revision, ops: [{ type: "setWeeks", nodeKey: view.data.nodes[0].key, values: [{ week: WEEK, headcount: 1 }] }] })).rejects.toMatchObject({ status: 403 });
    // Another project is invisible (404, not 403, so its existence is not disclosed).
    await expect(getPlanView(viewer, projectB)).rejects.toMatchObject({ status: 404 });
    const planB = await prisma.plan.findFirstOrThrow({ where: { projectId: projectB } });
    await expect(applyPlanOps(viewer, { planId: planB.id, expectedRevision: planB.revision, ops: [{ type: "setWeeks", nodeKey: "x", values: [{ week: WEEK, headcount: 1 }] }] })).rejects.toMatchObject({ status: 404 });
  });

  it("a project manager edits only assigned projects; a disabled user has no session viewer", async () => {
    const pm = await makeUser({ grants: [[projectA, "PROJECT_MANAGER"]] });
    const view = await getPlanView(pm, projectA);
    expect(view.canEdit).toBe(true);
    await expect(getPlanView(pm, projectB)).rejects.toMatchObject({ status: 404 });
    await setUserStatus(admin, { userId: pm.userId, disabled: true });
    expect(await viewerForUser(pm.userId)).toBeNull();
  });
});

describe("background jobs are idempotent", () => {
  it("re-enqueueing with the same key returns the same job, and a finished job is not run again", async () => {
    const ws = await workspaceId();
    const key = `test:${Date.now()}`;
    const a = await enqueueJob({ workspaceId: ws, projectId: null, kind: QUEUES.reportRender, payload: { test: true }, idempotencyKey: key, createdById: null });
    const b = await enqueueJob({ workspaceId: ws, projectId: null, kind: QUEUES.reportRender, payload: { test: true }, idempotencyKey: key, createdById: null });
    expect(b.id).toBe(a.id);
    let runs = 0;
    await runJob(a.id, async () => {
      runs++;
      return { ok: true };
    });
    expect(await runJob(a.id, async () => {
      runs++;
      return { ok: true };
    })).toBeNull();
    expect(runs).toBe(1);
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SUCCEEDED");
  });
});
