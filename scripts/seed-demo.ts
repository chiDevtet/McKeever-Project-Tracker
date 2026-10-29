import "dotenv/config";
import { addDays } from "@/domain/dates";
import type { PlanOp } from "@/domain/ops";
import { viewerForUser, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { createScenario } from "@/server/services/history";
import { createPerson } from "@/server/services/people";
import { applyPlanOps, getPlanView } from "@/server/services/plans";
import { createProject } from "@/server/services/projects";
import { saveArea, savePhase } from "@/server/services/structure";

/**
 * pnpm db:seed:demo — an explicitly separate, illustrative dataset for
 * training and demonstration. It never touches CMH139: the projects are coded
 * DEMO-A and DEMO-B, are named as illustrative, and use made-up personnel.
 * Requires an administrator (run pnpm admin:bootstrap and accept the invite).
 */

const weeks = (from: string, n: number, headcount: number) => Array.from({ length: n }, (_, i) => ({ week: addDays(from, i * 7), headcount }));

function act(key: string, name: string, start: string, finish: string, extra: { phaseId?: string; areaId?: string; systemId?: string } = {}): PlanOp {
  return { type: "addActivity", activity: { key, code: "", name, phaseId: extra.phaseId ?? null, areaId: extra.areaId ?? null, systemId: extra.systemId ?? null, calendarKey: null, plannedStart: start, plannedFinish: finish, notes: "Illustrative demo data", sortOrder: 0, archived: false } };
}

function leader(key: string, personId: string | null, personName: string, role: string, startDate: string, endDate: string, weekdays: number[] | null, systemIds: string[]): PlanOp {
  return {
    type: "upsertLeadership",
    assignment: { key, personId, personName, role, responsibilitySystemIds: systemIds, responsibilityPhaseIds: [], responsibilityNote: null, startDate, endDate, onsiteMode: weekdays ? "WEEKDAYS" : "PROJECT_CALENDAR", onsiteWeekdays: weekdays ?? [], onsiteHours: weekdays ? 8 : null, onsiteStart: null, offsiteHoursPerWeek: role === "Project manager" ? 16 : null, dayOverrides: [], notes: "Illustrative demo data", sortOrder: 0 },
  };
}

async function plan(admin: Viewer, projectId: string, ops: PlanOp[], planId?: string) {
  const view = await getPlanView(admin, projectId, planId);
  return applyPlanOps(admin, { planId: view.data.plan.id, expectedRevision: view.data.plan.revision, ops, summary: "Illustrative demo data" });
}

async function main() {
  const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  const adminMember = ws && (await prisma.workspaceMember.findFirst({ where: { workspaceId: ws.id, role: "ADMINISTRATOR", disabledAt: null }, orderBy: { createdAt: "asc" } }));
  if (!adminMember) throw new Error("No administrator exists yet. Run pnpm admin:bootstrap and accept the invitation first.");
  const admin = (await viewerForUser(adminMember.userId))!;
  if (await prisma.project.findFirst({ where: { workspaceId: admin.workspaceId, code: "DEMO-A" } })) {
    console.log("[demo] DEMO-A already exists; nothing to do.");
    return;
  }

  const foreman = await createPerson(admin, { displayName: "Jordan Demo (illustrative foreman)", title: "Foreman" });
  const pm = await createPerson(admin, { displayName: "Casey Demo (illustrative PM)", title: "Project manager" });
  const systems = [
    { key: "fire-alarm", name: "Fire alarm", sourceAliases: ["Fire Alarm"] },
    { key: "vesda", name: "VESDA", sourceAliases: ["VESDA"] },
  ];

  // DEMO-A: eight installers, nested allocations, part-time PM.
  const a = await createProject(admin, { code: "DEMO-A", name: "Illustrative demo A — not real project data", description: "Training dataset with made-up dates, crews, and personnel.", systems });
  const v = (await viewerForUser(admin.userId))!;
  const building = await saveArea(v, { projectId: a.id, kind: "BUILDING", name: "Building A" });
  const romp = await saveArea(v, { projectId: a.id, parentId: building.id, kind: "ROMP", name: "ROMP 1" });
  const hall = await saveArea(v, { projectId: a.id, parentId: romp.id, kind: "DATA_HALL", name: "Data Hall 1" });
  const elec = await saveArea(v, { projectId: a.id, parentId: romp.id, kind: "ROOM", name: "Electrical Room 1" });
  await saveArea(v, { projectId: a.id, kind: "OTHER", name: "Admin area (outside phases)" });
  const p1 = await savePhase(v, { projectId: a.id, name: "Phase 1", areaIds: [romp.id] });
  const p2 = await savePhase(v, { projectId: a.id, name: "Phase 2", areaIds: [romp.id] });
  const view = await getPlanView(v, a.id);
  const fa = view.data.systems.find((s) => s.name === "Fire alarm")!.id;
  const pool = view.data.nodes.find((n) => n.kind === "POOL")!.key;
  const start = "2027-03-01";
  await plan(v, a.id, [
    act("demo-a-rough", "Electrical Room 1 — fire alarm rough-in", start, "2027-03-12", { phaseId: p1.id, areaId: elec.id, systemId: fa }),
    act("demo-a-cable", "Data Hall 1 — pull fire alarm cable", "2027-03-08", "2027-03-26", { phaseId: p1.id, areaId: hall.id, systemId: fa }),
    act("demo-a-term", "Data Hall 1 — terminate devices", "2027-03-31", "2027-04-09", { phaseId: p1.id, areaId: hall.id, systemId: fa }),
    act("demo-a-p2", "Phase 2 — rough-in", "2027-03-22", "2027-04-16", { phaseId: p2.id, areaId: romp.id }),
    act("demo-a-admin", "Admin area — devices (no phase)", "2027-04-12", "2027-04-16"),
    { type: "addLink", predecessorKey: "demo-a-cable", successorKey: "demo-a-term", lagDays: 2 },
    { type: "setPhaseWindow", phaseId: p1.id, start, finish: "2027-04-09", note: null },
    { type: "setPhaseWindow", phaseId: p2.id, start: "2027-03-22", finish: "2027-04-16", note: null },
    { type: "setWeeks", nodeKey: pool, values: weeks(start, 7, 8) },
    { type: "addNode", node: { key: "demo-a-p1", parentKey: pool, kind: "RESERVATION", name: "Phase 1 envelope", role: "Installer", phaseId: p1.id, areaId: null, systemId: null, activityKey: null, calendarKey: null, notes: null, sortOrder: 0 } },
    { type: "setWeeks", nodeKey: "demo-a-p1", values: weeks(start, 4, 8) },
    { type: "addNode", node: { key: "demo-a-elec", parentKey: "demo-a-p1", kind: "RESERVATION", name: "Electrical Room 1", role: "Installer", phaseId: p1.id, areaId: elec.id, systemId: fa, activityKey: "demo-a-rough", calendarKey: null, notes: null, sortOrder: 0 } },
    { type: "setWeeks", nodeKey: "demo-a-elec", values: weeks(start, 2, 3) },
    { type: "addNode", node: { key: "demo-a-hall", parentKey: "demo-a-p1", kind: "CREW", name: "Data Hall cable crew", role: "Installer", phaseId: p1.id, areaId: hall.id, systemId: fa, activityKey: "demo-a-cable", calendarKey: null, notes: null, sortOrder: 1 } },
    { type: "setWeeks", nodeKey: "demo-a-hall", values: weeks("2027-03-08", 3, 5) },
    leader("demo-a-pm", pm.id, "Casey Demo (illustrative PM)", "Project manager", start, "2027-04-16", [1, 2], []),
    leader("demo-a-fm", foreman.id, "Jordan Demo (illustrative foreman)", "Main foreman", start, "2027-04-09", null, view.data.systems.map((s) => s.id)),
  ]);
  const scenario = await createScenario(v, { projectId: a.id, name: "Illustrative acceleration — ten installers" });
  await plan(v, a.id, [{ type: "setWeeks", nodeKey: pool, values: weeks(start, 6, 10) }], scenario.id);

  // DEMO-B: peaks later, and the same foreman overlaps, so the division view shows an aligned peak and a name conflict.
  const b = await createProject(admin, { code: "DEMO-B", name: "Illustrative demo B — not real project data", description: "Training dataset with made-up dates, crews, and personnel.", systems });
  const vb = (await viewerForUser(admin.userId))!;
  const bView = await getPlanView(vb, b.id);
  const bPool = bView.data.nodes.find((n) => n.kind === "POOL")!.key;
  await plan(vb, b.id, [
    act("demo-b-rough", "Office fit-out — fire alarm rough-in", "2027-04-05", "2027-04-30"),
    { type: "setWeeks", nodeKey: bPool, values: weeks("2027-04-05", 4, 6) },
    leader("demo-b-fm", foreman.id, "Jordan Demo (illustrative foreman)", "Foreman", "2027-04-05", "2027-04-30", null, []),
  ]);
  console.log("[demo] Created DEMO-A (with an illustrative scenario) and DEMO-B. These are training data, not CMH139 records.");
}

main()
  .catch((err) => {
    console.error(`[demo] failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
