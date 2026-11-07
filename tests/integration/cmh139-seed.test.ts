import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { dateFromDb, eachDay } from "@/domain/dates";
import { checkCapacity, buildTree } from "@/domain/capacity";
import { dailyEntries, windowEntries } from "@/domain/phase-plan";
import { expandAllNodes, projectResolver } from "@/domain/staffing";
import type { PlanData } from "@/domain/plan";
import { prisma } from "@/server/db";
import { loadPlanData, mutatePlan } from "@/server/plan-store";
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

interface Range {
  text: string;
  low: number | null;
  high: number;
}
const FORECAST = JSON.parse(readFileSync(path.join(ROOT, "fixtures/seed/cmh139.manpower-forecast.json"), "utf8")) as { months: { month: string; installation: Range; support: Range; combined: Range }[] };
/** Upper figure of each monthly range, as read from the 6 Nov 2026 forecast. */
const HIGHS: Record<string, [number, number]> = {
  "2027-04": [6, 2],
  "2027-05": [4, 2],
  "2027-06": [9, 3],
  "2027-07": [12, 3],
  "2027-08": [12, 4],
  "2027-09": [8, 3],
  "2027-10": [8, 3],
  "2027-11": [8, 2],
  "2027-12": [3, 1],
  "2028-01": [3, 1],
  "2028-02": [3, 1],
  "2028-03": [3, 1],
};
const START = "2027-04-01";
const FINISH = "2028-03-01";
const GROUND_KEY = "cmh139-ground-support";

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

/** Planned headcount per working day from a node's expanded blocks. */
function headcountOn(data: PlanData, nodeKey: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of expandAllNodes(data).get(nodeKey) ?? []) out.set(b.shiftDate, (out.get(b.shiftDate) ?? 0) + b.headcount);
  return out;
}

const installerPool = (data: PlanData) => data.nodes.find((n) => n.kind === "POOL" && n.parentKey === null && n.role === "Installer")!;

function checkStaffing(data: PlanData) {
  const cal = projectResolver(data);
  const pool = installerPool(data);
  const ground = data.nodes.find((n) => n.kind === "POOL" && n.parentKey === null && n.role === "Ground support");
  expect(pool.key).toBe(CMH139_POOL_KEY);
  expect(ground).toMatchObject({ key: GROUND_KEY, name: "Ground support — ACE site safety" });
  const installers = headcountOn(data, pool.key);
  const support = headcountOn(data, GROUND_KEY);
  // The upper figure on every working day of each forecast month; nothing outside the period
  // (the installer pool is seed-owned through 30 Apr 2028, so the earlier phase capacity is gone).
  for (const d of eachDay("2027-03-01", "2028-05-31")) {
    const [inst, sup] = d >= START && d <= FINISH && cal.isWorkingDay(d) ? HIGHS[d.slice(0, 7)] : [0, 0];
    expect(installers.get(d) ?? 0, `installers ${d}`).toBe(inst);
    expect(support.get(d) ?? 0, `ground support ${d}`).toBe(sup);
  }
  expect(installers.get("2027-07-15")).toBe(12);
  expect(support.get("2027-08-16")).toBe(4);
  expect(installers.get("2028-03-01")).toBe(3);
  expect(installers.get("2028-03-02")).toBeUndefined();
  expect(checkCapacity(data, expandAllNodes(data), buildTree(data.nodes))).toEqual([]);
}

/** The state the 30 Oct 2026 seed left: 8 planned installers per phase, a pool equal to their sum, no ground support pool. */
function earlierSeedState(data: PlanData, edit?: (entries: PlanData["entries"]) => PlanData["entries"]): PlanData {
  const cal = projectResolver(data);
  const pool = installerPool(data);
  const dropped = new Set([GROUND_KEY, ...data.nodes.filter((n) => n.kind === "RESERVATION").map((n) => n.key)]);
  const nodes = data.nodes.filter((n) => !dropped.has(n.key));
  const entries = data.entries.filter((e) => !dropped.has(e.nodeKey) && e.nodeKey !== pool.key);
  const reservations: PlanData["entries"] = [];
  data.phases.forEach((ph, i) => {
    const key = phaseReservationKey(ph.key);
    nodes.push({ key, parentKey: pool.key, kind: "RESERVATION", name: `${ph.name} installers (planned)`, role: "Installer", phaseId: ph.id, areaId: null, systemId: null, activityKey: null, calendarKey: null, notes: "Planned headcount", sortOrder: i });
    const [start, finish] = WINDOWS[ph.name];
    reservations.push(...windowEntries(key, start, finish, 8, cal));
  });
  const edited = edit ? edit(reservations) : reservations;
  const withReservations = { ...data, nodes, entries: [...entries, ...edited] };
  const sums = new Map<string, number>();
  for (const n of nodes.filter((x) => x.parentKey === pool.key)) for (const [d, h] of headcountOn(withReservations, n.key)) sums.set(d, (sums.get(d) ?? 0) + h);
  return { ...withReservations, entries: [...entries, ...edited, ...dailyEntries(pool.key, (d) => sums.get(d) ?? 0, "2027-05-17", "2028-04-30", cal)] };
}

async function setPlan(data: PlanData, next: PlanData) {
  const p = await project();
  await mutatePlan(null, data.plan.id, data.plan.revision, () => next, { kind: "EDIT", summary: "test setup", workspaceId: p.workspaceId });
}

describe("CMH139 seed reconciliation", () => {
  beforeAll(async () => {
    // The integration global setup seeds a fresh database; this checks that state first.
    await project();
  });

  it("the forecast fixture matches the source figures", () => {
    expect(FORECAST.months.map((m) => [m.month, [m.installation.high, m.support.high]])).toEqual(Object.entries(HIGHS));
    for (const m of FORECAST.months) expect(m.installation.high + m.support.high, m.month).toBe(m.combined.high);
    expect(Math.max(...FORECAST.months.map((m) => m.combined.high))).toBe(16);
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

  it("staffing follows the manpower forecast: an installer pool and a ground support pool at the upper monthly figures, with no per-phase reservations", async () => {
    const data = await working();
    checkStaffing(data);
    expect(data.nodes.filter((n) => n.kind !== "POOL")).toEqual([]);
    expect(installerPool(data).notes).toMatch(/McKeever & Niekamp Electric manpower forecast of 2026-11-06 .*working leads included.*upper figure/);
    // Planned headcount only: no named installers, no invented leadership dates.
    expect(await prisma.person.count({ where: { displayName: { contains: "nstaller" } } })).toBe(0);
    expect(data.leadership.map((l) => [l.role, l.personName, l.startDate, l.endDate]).sort()).toEqual([
      ["Main foreman", "TBD", null, null],
      ["Project manager", "Tyler Sisia", null, null],
    ]);
    // Ground support is its own workforce role in the project workspace.
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: (await project()).workspaceId } });
    expect(JSON.stringify(ws)).toContain("Ground support");
  });

  it("attaches the schedule and the manpower forecast once each", async () => {
    const p = await project();
    const docs = await prisma.projectDocument.findMany({ where: { projectId: p.id } });
    const files = await prisma.storedFile.findMany({ where: { id: { in: docs.map((d) => d.fileId) } } });
    const fileOf = (fileId: string) => files.find((f) => f.id === fileId)!;
    const forecast = docs.filter((d) => d.title.startsWith("CMH139 revised manpower loading"));
    expect(forecast).toHaveLength(1);
    expect(forecast[0].category).toBe("CORRESPONDENCE");
    expect(fileOf(forecast[0].fileId)).toMatchObject({ kind: "ATTACHMENT", contentType: "application/pdf" });
    expect(docs.filter((d) => fileOf(d.fileId).kind === "SOURCE_SCHEDULE")).toHaveLength(1);
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
    // Recreate the older state: Phases 4-6, their milestones and windows, ground support and all planned staffing are absent.
    const later = await prisma.phase.findMany({ where: { projectId: p.id, name: { in: ["Phase 4", "Phase 5", "Phase 6"] } } });
    await prisma.milestone.deleteMany({ where: { phaseId: { in: later.map((x) => x.id) } } });
    await prisma.phaseWindow.deleteMany({ where: { planId: data.plan.id } });
    await prisma.phase.deleteMany({ where: { id: { in: later.map((x) => x.id) } } });
    await prisma.allocationNode.deleteMany({ where: { planId: data.plan.id, key: GROUND_KEY } });
    await prisma.staffingEntry.deleteMany({ where: { node: { planId: data.plan.id, key: CMH139_POOL_KEY } } });
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
    const log = run.log.join("\n");
    expect(log).toMatch(/6 phases: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6/);
    expect(log).toMatch(/Installers — shared workforce: forecast applied 2027-04-01 to 2028-04-30/);
    expect(log).toMatch(/Ground support — ACE site safety: workforce pool created/);
    expect(log).toContain("2027-08: installation 9-12 → 12, ground support 2-4 → 4 (combined up to 16; Phases 3-4 / offices)");
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

  it("the earlier 8-per-phase reservations are removed, and the forecast replaces the pool they summed to", async () => {
    const data = await working();
    await setPlan(data, earlierSeedState(data));
    const older = await working();
    expect(older.nodes.filter((n) => n.kind === "RESERVATION")).toHaveLength(6);
    expect(headcountOn(older, CMH139_POOL_KEY).get("2027-09-01")).toBe(48);

    const run = await seedCmh139(ROOT);
    for (const name of Object.keys(WINDOWS)) expect(run.log.join("\n")).toContain(`${name} installers (planned): removed (superseded by the manpower forecast)`);
    const after = await working();
    expect(after.nodes.filter((n) => n.kind === "RESERVATION")).toEqual([]);
    checkStaffing(after);
    const rev = after.plan.revision;
    await seedCmh139(ROOT);
    expect((await working()).plan.revision).toBe(rev);
  });

  it("an earlier reservation edited by an operator is kept when it fits the forecast, and the seed stops without changes when it does not", async () => {
    const key = phaseReservationKey("phase-2");
    // The operator replaced Phase 2's 8-a-day reservation with 3 for the week of 2 Aug 2027.
    const fits = (es: PlanData["entries"]) => [...es.filter((e) => e.nodeKey !== key), { ...es.find((e) => e.nodeKey === key && e.kind === "WEEK")!, date: "2027-08-02", headcount: 3 }];
    let data = await working();
    await setPlan(data, earlierSeedState(data, fits));
    const run = await seedCmh139(ROOT);
    expect(run.log.join("\n")).toMatch(/Phase 2 installers \(planned\): edited after seeding; kept as edited/);
    const after = await working();
    expect(after.nodes.filter((n) => n.kind === "RESERVATION").map((n) => n.key)).toEqual([key]);
    expect(headcountOn(after, key).get("2027-08-03")).toBe(3);
    checkStaffing(after);

    // An edit larger than the forecast (14 in July, where the forecast is up to 12) cannot be absorbed:
    // the seed reports it and leaves the plan exactly as it was.
    const tooMany = (es: PlanData["entries"]) => [...es.filter((e) => e.nodeKey !== key), { ...es.find((e) => e.nodeKey === key && e.kind === "WEEK")!, date: "2027-07-12", headcount: 14 }];
    data = await working();
    await setPlan(data, earlierSeedState(data, tooMany));
    const before = await working();
    await expect(seedCmh139(ROOT)).rejects.toThrow(/CMH139 staffing was not changed: Over capacity in "Installers — shared workforce" on 2027-07-12.*must fit within the forecast/s);
    const unchanged = await working();
    expect(unchanged.plan.revision).toBe(before.plan.revision);
    expect(unchanged.entries).toEqual(before.entries);

    // Reducing the edit lets the seed finish.
    await setPlan(unchanged, { ...unchanged, entries: unchanged.entries.map((e) => (e.nodeKey === key ? { ...e, headcount: 10 } : e)) });
    await seedCmh139(ROOT);
    const fixed = await working();
    expect(headcountOn(fixed, key).get("2027-07-13")).toBe(10);
    checkStaffing(fixed);
  });
});
