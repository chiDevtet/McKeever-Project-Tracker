import { beforeAll, describe, expect, it } from "vitest";
import { addDays } from "@/domain/dates";
import { computePlanningIssues } from "@/domain/issues";
import { todayInTimeZone } from "@/domain/tz";
import type { Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { divisionForecast } from "@/server/services/division";
import * as history from "@/server/services/history";
import { applyPlanOps, getPlanView } from "@/server/services/plans";
import { getProgressView, updateProgress } from "@/server/services/progress";
import { makeProject, makeUser, refreshViewer } from "./helpers";

const blank = { actualStart: null, actualFinish: null, percentComplete: null, holdReason: null, holdReviewDate: null, note: null };

function activity(key: string, name: string, start: string, finish: string) {
  return { type: "addActivity" as const, activity: { key, code: "", name, phaseId: null, areaId: null, systemId: null, calendarKey: null, plannedStart: start, plannedFinish: finish, notes: null, sortOrder: 0, archived: false } };
}

describe("manual progress (A18)", () => {
  let admin: Viewer;
  let projectId: string;
  let today: string;
  const v = { cable: 0 };

  beforeAll(async () => {
    admin = await makeUser({ admin: true });
    const project = await makeProject(admin, { timezone: "America/New_York" });
    projectId = project.id;
    admin = await refreshViewer(admin);
    today = todayInTimeZone("America/New_York");
    const plan = (await getPlanView(admin, projectId)).data;
    const pool = plan.nodes.find((n) => n.kind === "POOL")!;
    await applyPlanOps(admin, {
      planId: plan.plan.id,
      expectedRevision: plan.plan.revision,
      ops: [
        activity("cable", "Pull fire alarm cable", addDays(today, -20), addDays(today, 10)),
        activity("term", "Terminate devices", addDays(today, 11), addDays(today, 20)),
        { type: "addLink", predecessorKey: "cable", successorKey: "term", lagDays: 0 },
        { type: "setWeeks", nodeKey: pool.key, values: [{ week: "2026-10-26", headcount: 6 }] },
        { type: "addNode", node: { key: "cable-crew", parentKey: pool.key, kind: "RESERVATION", name: "Cable crew", role: "Installer", phaseId: null, areaId: null, systemId: null, activityKey: "cable", calendarKey: null, notes: null, sortOrder: 0 } },
        { type: "setWeeks", nodeKey: "cable-crew", values: [{ week: "2026-10-26", headcount: 4 }] },
      ],
    });
  });

  const update = (patch: Partial<Parameters<typeof updateProgress>[1]>, viewer = admin) => updateProgress(viewer, { projectId, activityKey: "cable", expectedVersion: v.cable, status: "NOT_STARTED", ...blank, ...patch });

  it("rejects future actual dates, a finish before the start, and completion without actual dates", async () => {
    await expect(update({ status: "IN_PROGRESS", actualStart: addDays(today, 3) })).rejects.toThrow(/actual start cannot be in the future/);
    await expect(update({ status: "COMPLETE", actualStart: addDays(today, -5), actualFinish: addDays(today, -6) })).rejects.toThrow(/finish cannot be before the actual start/);
    await expect(update({ status: "COMPLETE", actualStart: addDays(today, -5) })).rejects.toThrow(/requires an actual finish/);
    await expect(update({ status: "COMPLETE", actualFinish: addDays(today, -1) })).rejects.toThrow(/requires an actual start/);
    await expect(update({ status: "ON_HOLD", actualStart: addDays(today, -5) })).rejects.toThrow(/why the work is on hold/);
    expect(await prisma.activityProgress.count({ where: { projectId } })).toBe(0);
  });

  it("records who updated progress and when, completes at 100 percent, and audits an explicit reopen", async () => {
    let r = await update({ status: "IN_PROGRESS", actualStart: addDays(today, -18), percentComplete: 40, note: "Level 1 pulled" });
    v.cable = r.version;
    // A stale editor cannot overwrite the newer update.
    await expect(updateProgress(admin, { projectId, activityKey: "cable", expectedVersion: 0, status: "IN_PROGRESS", ...blank, actualStart: addDays(today, -18), percentComplete: 50 })).rejects.toThrow(/updated by someone else/);
    r = await update({ status: "COMPLETE", actualStart: addDays(today, -18), actualFinish: addDays(today, -1), percentComplete: 80 });
    v.cable = r.version;
    expect(r.progress).toMatchObject({ status: "COMPLETE", percentComplete: 100 });
    await expect(update({ status: "IN_PROGRESS", actualStart: addDays(today, -18) })).rejects.toThrow(/Reopening completed work requires a reason/);
    r = await update({ status: "IN_PROGRESS", actualStart: addDays(today, -18), percentComplete: 90, reopenReason: "Punch list found missing devices" });
    v.cable = r.version;
    const view = await getProgressView(admin, projectId);
    const events = view.events.filter((e) => e.activityKey === "cable");
    expect(events.map((e) => e.kind)).toEqual(["REOPEN", "STATUS", "STATUS"]);
    expect(events[0].note).toContain("Punch list found missing devices");
    expect(events.every((e) => e.actor === admin.name)).toBe(true);
    expect(await prisma.auditEvent.count({ where: { projectId, action: "progress.reopen" } })).toBe(1);
    // Planned dates are untouched by progress.
    const plan = (await getPlanView(admin, projectId)).data;
    expect(plan.activities.find((a) => a.key === "cable")).toMatchObject({ plannedStart: addDays(today, -20), plannedFinish: addDays(today, 10) });
  });

  it("holding work keeps its reservations and flags them for review", async () => {
    const r = await update({ status: "ON_HOLD", actualStart: addDays(today, -18), percentComplete: 90, holdReason: "Ceiling access closed by GC", holdReviewDate: addDays(today, 7) });
    v.cable = r.version;
    const plan = (await getPlanView(admin, projectId)).data;
    expect(plan.nodes.find((n) => n.key === "cable-crew")).toBeDefined();
    expect(plan.entries.filter((e) => e.nodeKey === "cable-crew").map((e) => e.headcount)).toEqual([4]);
    const issue = computePlanningIssues(plan).find((i) => i.category === "on-hold");
    expect(issue?.message).toMatch(/Ceiling access closed by GC.*1 staffing reservation kept for review/);
  });

  it("viewers cannot record progress", async () => {
    const viewer = await makeUser({ grants: [[projectId, "FOREMAN_VIEWER"]] });
    await expect(update({ status: "IN_PROGRESS", actualStart: addDays(today, -18) }, viewer)).rejects.toThrow();
    expect((await getProgressView(viewer, projectId)).rows.length).toBe(2);
  });

  it("splits remaining work without moving the historical start", async () => {
    const plan = (await getPlanView(admin, projectId)).data;
    const res = await applyPlanOps(admin, { planId: plan.plan.id, expectedRevision: plan.plan.revision, ops: [{ type: "splitActivity", key: "cable", newKey: "cable-rem", remainingStart: addDays(today, 14), remainingFinish: addDays(today, 18), name: "Pull fire alarm cable (remaining)", moveReservations: [] }] });
    const after = res.data;
    const orig = after.activities.find((a) => a.key === "cable")!;
    const rem = after.activities.find((a) => a.key === "cable-rem")!;
    expect(orig.plannedStart).toBe(addDays(today, -20));
    expect(orig.plannedFinish < rem.plannedStart).toBe(true);
    expect(rem).toMatchObject({ plannedStart: addDays(today, 14), plannedFinish: addDays(today, 18) });
    expect(after.links).toEqual([{ predecessorKey: "cable-rem", successorKey: "term", lagDays: 0 }]);
    // Recorded actuals stay with the original activity.
    expect(after.progress.find((p) => p.activityKey === "cable")?.actualStart).toBe(addDays(today, -18));
  });
});

describe("baselines, scenarios, promotion, and restore (A13)", () => {
  let admin: Viewer;
  let projectId: string;
  let workingId: string;
  let poolKey: string;
  const week = "2027-03-01";

  beforeAll(async () => {
    admin = await makeUser({ admin: true });
    projectId = (await makeProject(admin)).id;
    admin = await refreshViewer(admin);
    const plan = (await getPlanView(admin, projectId)).data;
    workingId = plan.plan.id;
    poolKey = plan.nodes.find((n) => n.kind === "POOL")!.key;
    await applyPlanOps(admin, { planId: workingId, expectedRevision: plan.plan.revision, ops: [activity("rough", "Rough-in", week, addDays(week, 4)), { type: "setWeeks", nodeKey: poolKey, values: [{ week, headcount: 4 }] }] });
  });

  const divisionPeak = async () => {
    const d = await divisionForecast(admin, { projectIds: [projectId], from: week, to: week });
    return d.forecast.weeks.find((w) => w.week === week)!.installerPeak;
  };

  it("a scenario stays out of the live division forecast until it is promoted", async () => {
    const baseline = await history.createBaseline(admin, { planId: workingId, name: "Preliminary baseline" });
    const baseRow = await prisma.planSnapshot.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(await divisionPeak()).toBe(4);

    const { id: scenarioId } = await history.createScenario(admin, { projectId, name: "Accelerated (8 installers)" });
    let scenario = (await getPlanView(admin, projectId, scenarioId)).data;
    expect(scenario.plan.kind).toBe("SCENARIO");
    expect(scenario.activities.map((a) => a.key)).toEqual(["rough"]);
    expect(scenario.entries.find((e) => e.nodeKey === poolKey)?.headcount).toBe(4);
    await applyPlanOps(admin, { planId: scenarioId, expectedRevision: scenario.plan.revision, ops: [{ type: "setWeeks", nodeKey: poolKey, values: [{ week, headcount: 8 }] }] });
    scenario = (await getPlanView(admin, projectId, scenarioId)).data;

    // Scenario edits do not touch the working plan or the division forecast.
    expect(await divisionPeak()).toBe(4);
    const working = (await getPlanView(admin, projectId)).data;
    expect(working.entries.find((e) => e.nodeKey === poolKey)?.headcount).toBe(4);

    const cmp = await history.comparePlan(admin, { projectId, other: { planId: scenarioId } });
    expect(cmp.comparison.totals.base.peakInstallers).toBe(4);
    expect(cmp.comparison.totals.other.peakInstallers).toBe(8);
    expect(cmp.comparison.totals.other.installerHours).toBe(2 * cmp.comparison.totals.base.installerHours);
    expect(cmp.comparison.staffingRowsChanged).toBe(1);

    // A stale promotion preview is rejected.
    await expect(history.promoteScenario(admin, { scenarioId, expectedScenarioRevision: scenario.plan.revision - 1, expectedWorkingRevision: working.plan.revision })).rejects.toThrow(/changed since you previewed/);
    const promoted = await history.promoteScenario(admin, { scenarioId, expectedScenarioRevision: scenario.plan.revision, expectedWorkingRevision: working.plan.revision });
    expect(promoted.revision).toBe(working.plan.revision + 1);
    expect(await divisionPeak()).toBe(8);

    // The baseline is unchanged; the prior working state is kept as a backup snapshot.
    const baseAfter = await prisma.planSnapshot.findUniqueOrThrow({ where: { id: baseline.id } });
    expect(baseAfter.dataHash).toBe(baseRow.dataHash);
    const backup = await prisma.planSnapshot.findFirstOrThrow({ where: { projectId, kind: "REVISION_BACKUP" } });
    expect(backup.planRevision).toBe(working.plan.revision);
    // The promoted scenario is read-only.
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: scenarioId } })).status).toBe("PROMOTED");
    await expect(applyPlanOps(admin, { planId: scenarioId, expectedRevision: scenario.plan.revision, ops: [{ type: "setWeeks", nodeKey: poolKey, values: [{ week, headcount: 9 }] }] })).rejects.toThrow();
    const revs = await prisma.planRevision.findMany({ where: { planId: workingId }, orderBy: { revision: "desc" }, take: 1 });
    expect(revs[0].kind).toBe("PROMOTE");
  });

  it("restoring a baseline creates a new revision and keeps actual progress", async () => {
    const today = todayInTimeZone("America/New_York");
    await updateProgress(admin, { projectId, activityKey: "rough", expectedVersion: 0, status: "IN_PROGRESS", ...blank, actualStart: today });
    const before = (await getPlanView(admin, projectId)).data;
    const baseline = await prisma.planSnapshot.findFirstOrThrow({ where: { projectId, kind: "BASELINE" } });
    const res = await history.restoreSnapshot(admin, { snapshotId: baseline.id, expectedWorkingRevision: before.plan.revision });
    expect(res.revision).toBe(before.plan.revision + 1);
    const after = (await getPlanView(admin, projectId)).data;
    expect(after.entries.find((e) => e.nodeKey === poolKey)?.headcount).toBe(4);
    expect(after.progress.find((p) => p.activityKey === "rough")).toMatchObject({ status: "IN_PROGRESS", actualStart: today });
    // History is not erased.
    const h = await history.getHistory(admin, projectId);
    expect(h.revisions.map((r) => r.kind).slice(0, 2)).toEqual(["RESTORE", "PROMOTE"]);
    expect(h.snapshots.filter((s) => s.kind === "REVISION_BACKUP")).toHaveLength(2);
  });

  it("viewers can read history but cannot create, promote, or restore", async () => {
    const viewer = await makeUser({ grants: [[projectId, "INTERNAL_VIEWER"]] });
    const h = await history.getHistory(viewer, projectId);
    expect(h.plans.length).toBe(2);
    await expect(history.createScenario(viewer, { projectId, name: "x" })).rejects.toThrow();
    await expect(history.createBaseline(viewer, { planId: workingId, name: "x" })).rejects.toThrow();
    await expect(history.restoreSnapshot(viewer, { snapshotId: h.snapshots[0].id, expectedWorkingRevision: 1 })).rejects.toThrow();
  });
});
