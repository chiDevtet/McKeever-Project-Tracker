import { describe, expect, it } from "vitest";
import { buildReportDataset, reportSettingsSchema } from "@/domain/report";
import { applyPlanOps, getPlanView } from "@/server/services/plans";
import { saveArea, savePhase } from "@/server/services/structure";
import { makeProject, makeUser, refreshViewer } from "./helpers";

describe("independent project structure (A02)", () => {
  it("overlapping phases, nested ROMP areas, a shared admin area, and an activity with no area all save and group correctly", async () => {
    let admin = await makeUser({ admin: true });
    const projectId = (await makeProject(admin)).id;
    admin = await refreshViewer(admin);
    const building = await saveArea(admin, { projectId, kind: "BUILDING", name: "Building D" });
    const romp1 = await saveArea(admin, { projectId, parentId: building.id, kind: "ROMP", name: "ROMP 01" });
    const romp3 = await saveArea(admin, { projectId, parentId: building.id, kind: "ROMP", name: "ROMP 03" });
    const hall = await saveArea(admin, { projectId, parentId: romp1.id, kind: "DATA_HALL", name: "Data Hall 1" });
    const adminArea = await saveArea(admin, { projectId, kind: "OTHER", name: "Admin" });
    // Phase 1 and Phase 2 overlap on ROMP 01; the admin area belongs to no phase.
    const p1 = await savePhase(admin, { projectId, name: "Phase 1", areaIds: [romp1.id, romp3.id] });
    const p2 = await savePhase(admin, { projectId, name: "Phase 2", areaIds: [romp1.id] });
    const view = (await getPlanView(admin, projectId)).data;
    const res = await applyPlanOps(admin, {
      planId: view.plan.id,
      expectedRevision: view.plan.revision,
      ops: [
        { type: "setPhaseWindow", phaseId: p1.id, start: "2027-05-03", finish: "2027-07-02", note: null },
        { type: "setPhaseWindow", phaseId: p2.id, start: "2027-06-01", finish: "2027-08-27", note: null },
        { type: "addActivity", activity: { key: "hall", code: "", name: "Data hall devices", phaseId: p1.id, areaId: hall.id, systemId: null, calendarKey: null, plannedStart: "2027-05-10", plannedFinish: "2027-05-21", notes: null, sortOrder: 0, archived: false } },
        { type: "addActivity", activity: { key: "admin", code: "", name: "Admin area devices", phaseId: null, areaId: adminArea.id, systemId: null, calendarKey: null, plannedStart: "2027-06-07", plannedFinish: "2027-06-11", notes: null, sortOrder: 1, archived: false } },
        { type: "addActivity", activity: { key: "noarea", code: "", name: "Programming (no area)", phaseId: p2.id, areaId: null, systemId: null, calendarKey: null, plannedStart: "2027-08-02", plannedFinish: "2027-08-06", notes: null, sortOrder: 2, archived: false } },
      ],
    });
    const data = (await getPlanView(admin, projectId)).data;
    expect(data.activities).toEqual(res.data.activities);
    expect(data.areas.find((a) => a.id === hall.id)?.parentId).toBe(romp1.id);
    expect(data.phases.find((p) => p.id === p1.id)?.areaIds.sort()).toEqual([romp1.id, romp3.id].sort());
    expect(data.phases.find((p) => p.id === p2.id)?.areaIds).toEqual([romp1.id]);
    const ctx = { companyName: "x", preparedBy: "x", generatedAt: "2026-10-29T00:00:00Z", snapshotId: "x", snapshotName: null, sources: [] };
    const byArea = buildReportDataset(data, reportSettingsSchema.parse({ detail: "AREA_BREAKDOWN" }), ctx);
    expect(byArea.areas.find((a) => a.name === "Admin")?.phases).toEqual([]);
    expect(byArea.areas.find((a) => a.name === "ROMP 01")?.phases.sort()).toEqual(["Phase 1", "Phase 2"]);
    expect(byArea.areas.find((a) => a.name === "Data Hall 1")?.depth).toBe(2);
    const byActivity = buildReportDataset(data, reportSettingsSchema.parse({ detail: "ACTIVITY_DETAIL" }), ctx);
    expect(byActivity.activities.map((a) => [a.name, a.phase, a.area])).toEqual([
      ["Data hall devices", "Phase 1", "Data Hall 1"],
      ["Admin area devices", null, "Admin"],
      ["Programming (no area)", "Phase 2", null],
    ]);
    const byPhase = buildReportDataset(data, reportSettingsSchema.parse({ detail: "PHASE_OVERVIEW" }), ctx);
    expect(byPhase.phases.map((p) => [p.name, p.window.start, p.window.finish])).toEqual([
      ["Phase 1", "2027-05-03", "2027-07-02"],
      ["Phase 2", "2027-06-01", "2027-08-27"],
    ]);
  });
});
