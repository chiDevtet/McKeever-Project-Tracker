import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { addDays, dateFromDb, eachDay, startOfWeek } from "@/domain/dates";
import { checkCapacity, buildTree } from "@/domain/capacity";
import { expandAllNodes, projectResolver } from "@/domain/staffing";
import type { PlanData } from "@/domain/plan";
import { prisma } from "@/server/db";
import { loadPlanData } from "@/server/plan-store";
import { CMH139_POOL_KEY, phaseReservationKey, seedCmh139 } from "@/server/seed/cmh139";

const ROOT = path.resolve(".");

const WINDOWS: Record<string, [string, string, number[]]> = {
  "Phase 1": ["2027-05-20", "2027-12-10", [1, 3]],
  "Phase 2": ["2027-05-31", "2028-01-21", [2, 4]],
  "Phase 3": ["2027-05-31", "2028-02-18", [5, 7]],
  "Phase 4": ["2027-06-18", "2028-03-17", [6, 8]],
  "Phase 5": ["2027-07-23", "2028-04-14", [9, 11]],
  "Phase 6": ["2027-08-27", "2028-04-28", [10, 12]],
};

async function project() {
  return prisma.project.findFirstOrThrow({ where: { code: "CMH139" } });
}

async function working(): Promise<PlanData> {
  const p = await project();
  const plan = await prisma.plan.findFirstOrThrow({ where: { projectId: p.id, kind: "WORKING" } });
  return loadPlanData(prisma, plan.id);
}

/** Row counts of every record group the seed could duplicate. */
async function counts(projectId: string) {
  const [phases, areas, memberships, milestones, values, versions, nodes, entries, people, leaders, files] = await Promise.all([
    prisma.phase.count({ where: { projectId } }),
    prisma.area.count({ where: { projectId } }),
    prisma.phaseArea.count({ where: { phase: { projectId } } }),
    prisma.milestone.count({ where: { projectId } }),
    prisma.milestoneSourceValue.count({ where: { milestone: { projectId } } }),
    prisma.sourceVersion.count({ where: { projectId } }),
    prisma.allocationNode.count({ where: { projectId } }),
    prisma.staffingEntry.count({ where: { node: { projectId } } }),
    prisma.person.count(),
    prisma.leadershipAssignment.count({ where: { projectId } }),
    prisma.storedFile.count({ where: { projectId } }),
  ]);
  return { phases, areas, memberships, milestones, values, versions, nodes, entries, people, leaders, files };
}

/** Planned installers per working day from the expanded reservation blocks. */
function headcountOn(data: PlanData, nodeKey: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of expandAllNodes(data).get(nodeKey) ?? []) out.set(b.shiftDate, Math.max(out.get(b.shiftDate) ?? 0, b.headcount));
  return out;
}

function checkStaffing(data: PlanData) {
  const cal = projectResolver(data);
  const pool = data.nodes.find((n) => n.kind === "POOL" && n.role === "Installer")!;
  const phaseNodes = data.phases.map((ph) => data.nodes.filter((n) => n.phaseId === ph.id && n.parentKey === pool.key));
  // Exactly one installer reservation per phase, under the shared pool.
  for (const list of phaseNodes) expect(list).toHaveLength(1);
  const totals = new Map<string, number>();
  for (const ph of data.phases) {
    const [start, finish] = WINDOWS[ph.name];
    const node = data.nodes.find((n) => n.phaseId === ph.id && n.parentKey === pool.key)!;
    const days = headcountOn(data, node.key);
    // 8 on every working day of the exact window, nothing outside it.
    for (const d of eachDay(startOfWeek(start), addDays(startOfWeek(finish), 6))) {
      const expected = d >= start && d <= finish && cal.isWorkingDay(d) ? 8 : 0;
      expect(days.get(d) ?? 0, `${ph.name} ${d}`).toBe(expected);
      if (expected) totals.set(d, (totals.get(d) ?? 0) + 8);
    }
  }
  // The pool supplies exactly the sum of active phase reservations each day.
  const poolDays = headcountOn(data, pool.key);
  for (const [d, total] of totals) expect(poolDays.get(d), `pool ${d}`).toBe(total);
  expect(poolDays.get("2027-05-20")).toBe(8);
  expect(poolDays.get("2027-06-01")).toBe(24);
  expect(poolDays.get("2027-09-01")).toBe(48);
  expect(poolDays.get("2028-04-10")).toBe(16);
  expect(poolDays.get("2028-04-20")).toBe(8);
  expect(checkCapacity(data, expandAllNodes(data), buildTree(data.nodes))).toEqual([]);
}

describe("CMH139 seed reconciliation", () => {
  beforeAll(async () => {
    // The integration global setup seeds a fresh database; this checks that state first.
    await project();
  });

  it("a fresh seed creates exactly six phases with their ROMPs, exact windows, and milestone provenance", async () => {
    const p = await project();
    const phases = await prisma.phase.findMany({ where: { projectId: p.id }, include: { areas: { include: { area: true } } }, orderBy: { sortOrder: "asc" } });
    expect(phases.map((x) => x.name)).toEqual(Object.keys(WINDOWS));
    for (const ph of phases) expect(ph.areas.map((a) => a.area.code).sort()).toEqual(WINDOWS[ph.name][2].map((r) => `ROMP${String(r).padStart(2, "0")}`).sort());
    const data = await working();
    for (const ph of data.phases) {
      const w = data.phaseWindows.find((x) => x.phaseId === ph.id)!;
      expect([w.start, w.finish], ph.name).toEqual(WINDOWS[ph.name].slice(0, 2));
    }
    // Phase 1 NEA keeps both source values; nothing is confirmed by the seed.
    const nea = await prisma.milestone.findFirstOrThrow({ where: { projectId: p.id, code: "NEA", phase: { name: "Phase 1" } }, include: { values: true } });
    expect(nea.reviewStatus).toBe("NEEDS_REVIEW");
    expect(nea.date).toBeNull();
    expect(nea.values.map((v) => dateFromDb(v.date)).sort()).toEqual(["2027-10-11", "2027-10-18"]);
    // FEA is dated only for Phase 1.
    const fea = await prisma.milestone.findMany({ where: { projectId: p.id, code: "FEA" }, include: { values: true, phase: true } });
    for (const m of fea) {
      const dates = m.values.map((v) => dateFromDb(v.date)).filter(Boolean);
      expect(dates, m.phase!.name).toEqual(m.phase!.name === "Phase 1" ? ["2027-09-27"] : []);
    }
    // PCO comes from the schedule; Phase 6 PFHO and PCO are the same day.
    const p6 = await prisma.milestone.findMany({ where: { projectId: p.id, phase: { name: "Phase 6" }, code: { in: ["PFHO", "PCO", "SWD"] } }, include: { values: true } });
    const v = (code: string) => p6.find((m) => m.code === code)!.values.map((x) => dateFromDb(x.date));
    expect(v("PFHO")).toEqual(["2028-04-28"]);
    expect(v("PCO")).toEqual(["2028-04-28"]);
    expect(p6.find((m) => m.code === "SWD")!.values.find((x) => x.sourceLabel.includes("MS60000"))?.note).toMatch(/Gray Early Start Work Date, page 3/);
  });

  it("each phase has one reservation of 8 planned installers over its window, and the pool equals the sum of active reservations", async () => {
    const data = await working();
    checkStaffing(data);
    expect(data.nodes.filter((n) => n.key.startsWith("cmh139-phase-"))).toHaveLength(6);
    // Planned headcount only: no named installers, no invented leadership dates.
    expect(await prisma.person.count({ where: { displayName: { contains: "nstaller" } } })).toBe(0);
    expect(data.leadership.map((l) => [l.role, l.personName, l.startDate, l.endDate]).sort()).toEqual([
      ["Main foreman", "TBD", null, null],
      ["Project manager", "Tyler Sisia", null, null],
    ]);
  });

  it("re-running is idempotent", async () => {
    const p = await project();
    const before = await counts(p.id);
    const rev = (await working()).plan.revision;
    const run = await seedCmh139(ROOT);
    expect(run.created).toBe(false);
    expect(run.log.join("\n")).toMatch(/already up to date/);
    expect(await counts(p.id)).toEqual(before);
    expect((await working()).plan.revision).toBe(rev);
  });

  it("an older three-phase project without a workforce plan reconciles to six phases, keeping the project and operator data", async () => {
    const p = await project();
    const data = await working();
    // Recreate the older state: Phases 4-6, their milestones and windows, and all planned staffing are absent.
    const later = await prisma.phase.findMany({ where: { projectId: p.id, name: { in: ["Phase 4", "Phase 5", "Phase 6"] } } });
    await prisma.milestone.deleteMany({ where: { phaseId: { in: later.map((x) => x.id) } } });
    await prisma.phaseWindow.deleteMany({ where: { planId: data.plan.id } });
    await prisma.phase.deleteMany({ where: { id: { in: later.map((x) => x.id) } } });
    await prisma.allocationNode.deleteMany({ where: { planId: data.plan.id, key: { startsWith: "cmh139-phase-" } } });
    const pool = data.nodes.find((n) => n.kind === "POOL")!;
    await prisma.staffingEntry.deleteMany({ where: { node: { planId: data.plan.id, key: pool.key } } });
    expect(await prisma.phase.count({ where: { projectId: p.id } })).toBe(3);

    // Operator data that must survive: a confirmed milestone, actual progress, and an imported source version.
    const swd = await prisma.milestone.findFirstOrThrow({ where: { projectId: p.id, code: "SWD", phase: { name: "Phase 1" } } });
    await prisma.milestone.update({ where: { id: swd.id }, data: { date: new Date("2027-05-24T00:00:00Z"), reviewStatus: "CONFIRMED" } });
    await prisma.activityProgress.create({ data: { projectId: p.id, activityKey: "operator-activity", status: "IN_PROGRESS", actualStart: new Date("2026-10-26T00:00:00Z"), percentComplete: 10 } });
    const gray = await prisma.sourceLineage.findFirstOrThrow({ where: { projectId: p.id, kind: "PDF_SCHEDULE" } });
    const imported = await prisma.sourceVersion.create({ data: { lineageId: gray.id, projectId: p.id, versionNumber: 1, label: "Operator import", summary: {} } });
    await prisma.sourceRecord.create({ data: { versionId: imported.id, externalId: "P1ER.1140", name: "Phase 1 / Elec Rm - Fire Alarm / VESDA", original: {}, reviewed: {} } });
    const keep = async () => ({
      swd: await prisma.milestone.findUniqueOrThrow({ where: { id: swd.id }, select: { date: true, reviewStatus: true, adoptedValueId: true, notes: true } }),
      progress: await prisma.activityProgress.findMany({ where: { projectId: p.id } }),
      records: await prisma.sourceRecord.findMany({ where: { version: { projectId: p.id } } }),
      versions: await prisma.sourceVersion.findMany({ where: { projectId: p.id }, orderBy: { id: "asc" } }),
    });
    const kept = await keep();

    const run = await seedCmh139(ROOT);
    expect(run.created).toBe(false);
    expect((await project()).id).toBe(p.id);
    expect(run.log.join("\n")).toMatch(/6 phases: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6/);
    for (const name of Object.keys(WINDOWS)) expect(run.log.join("\n")).toContain(`${name} installers (planned): 8 planned installers, ${WINDOWS[name][0]} to ${WINDOWS[name][1]}`);
    const after = await working();
    expect(after.phases.map((x) => x.name)).toEqual(Object.keys(WINDOWS));
    for (const ph of after.phases) {
      const w = after.phaseWindows.find((x) => x.phaseId === ph.id)!;
      expect([w.start, w.finish]).toEqual(WINDOWS[ph.name].slice(0, 2));
    }
    checkStaffing(after);
    expect(await keep()).toEqual(kept);
    // The Phase 1 NEA discrepancy is still exactly two values, not duplicated.
    const nea = await prisma.milestoneSourceValue.findMany({ where: { milestone: { projectId: p.id, code: "NEA", phase: { name: "Phase 1" } } } });
    expect(nea).toHaveLength(2);

    // A second run changes nothing.
    const before = await counts(p.id);
    await seedCmh139(ROOT);
    expect(await counts(p.id)).toEqual(before);
  });

  it("a reservation edited after seeding is left as edited, and the pool follows it", async () => {
    const data = await working();
    const key = phaseReservationKey("phase-2");
    const node = await prisma.allocationNode.findFirstOrThrow({ where: { planId: data.plan.id, key } });
    // The operator plans 10 instead of 8 for one full week of Phase 2.
    await prisma.staffingEntry.updateMany({ where: { nodeId: node.id, kind: "WEEK", date: new Date("2027-08-02T00:00:00Z") }, data: { headcount: 10 } });
    const run = await seedCmh139(ROOT);
    expect(run.log.join("\n")).toMatch(/Phase 2 installers \(planned\): reservation staffing was edited after seeding; left as edited/);
    const after = await working();
    expect(after.entries.find((e) => e.nodeKey === key && e.date === "2027-08-02")?.headcount).toBe(10);
    // Phases 1-5 active that week: 4 x 8 + 10.
    expect(headcountOn(after, after.nodes.find((n) => n.kind === "POOL")!.key).get("2027-08-03")).toBe(42);
    expect(checkCapacity(after, expandAllNodes(after), buildTree(after.nodes))).toEqual([]);
    expect(CMH139_POOL_KEY).toBe("cmh139-installer-pool");
  });
});
