import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defaultCalendarDefinition, defaultWeekPattern } from "@/domain/calendar";
import { dateFromDb, dateToDb } from "@/domain/dates";
import { applySeedStaffing, monthlyValue, windowEntries, type PoolForecast } from "@/domain/phase-plan";
import { projectResolver } from "@/domain/staffing";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { prisma, type Tx } from "@/server/db";
import { loadPlanData, mutatePlan } from "@/server/plan-store";
import { setParty } from "@/server/services/projects";
import { sha256, storeFile } from "@/server/services/files";

/**
 * Production seed and reconciliation for CMH139.
 *
 * Inputs: fixtures/seed/cmh139.preliminary.json (reviewed candidates from the
 * ACE milestone correspondence) and fixtures/seed/cmh139.phase-plan.json
 * (phase windows and schedule milestones from the Gray preliminary schedule
 * PDF, plus planned installer headcount per phase).
 *
 * Safe to run on a fresh database and on an existing CMH139 project: records
 * are found by stable identity (codes and keys) and only missing pieces are
 * added. The project is never deleted or recreated. Milestone dates and review
 * state, actual progress, imported source versions, and operator edits to
 * seed-owned staffing are left as they are; staffing changes go through the
 * validated plan mutation path with a new revision.
 *
 * Milestone dates stay candidates (NEEDS_REVIEW) with their provenance. The
 * Phase 1 NEA discrepancy between the 16 and 23 October tables is kept as two
 * source values. No FEA date is invented where the sources give none, no
 * installer is named, and no leadership dates are chosen.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const seedSchema = z.object({
  schemaVersion: z.literal(1),
  workspace: z.object({ name: z.string(), applicationDisplayName: z.string() }),
  project: z.object({ code: z.string(), name: z.string(), status: z.string(), customer: z.string(), generalContractor: z.string(), owner: z.string(), timezone: z.string() }),
  calendar: z.object({ weekStartsOn: z.literal("Monday"), workingDays: z.array(z.string()), hoursPerWorkingDay: z.number(), exceptions: z.array(z.unknown()) }),
  systems: z.array(z.object({ key: z.string(), name: z.string(), sourceAliasesForReview: z.array(z.string()).optional() })),
  personnelCandidates: z.array(z.object({ name: z.string().nullable(), displayName: z.string().optional(), projectRole: z.string(), responsibilitySystems: z.array(z.string()).optional(), assignmentDates: z.null() })),
  sources: z.array(z.object({ key: z.string(), kind: z.string(), sourceDate: isoDate.optional(), status: z.string().optional(), path: z.string().optional(), pageCount: z.number().optional() })),
  phases: z.array(z.object({ key: z.string(), name: z.string(), romps: z.array(z.number()), milestoneCandidates: z.record(z.string(), isoDate.nullable()), sourceKey: z.string(), status: z.string() })),
  sourceDiscrepancies: z.array(z.object({ phase: z.number(), milestone: z.string(), earlier: z.object({ date: isoDate, sourceKey: z.string() }), laterCandidate: z.object({ date: isoDate, sourceKey: z.string() }) })),
  // Staffing comes from the phase plan fixture, never from this candidates file.
  workforcePlans: z.array(z.unknown()).length(0),
  actualProgress: z.array(z.unknown()).length(0),
  scopeItemsForConfirmation: z.array(z.string()),
});

const phasePlanSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({ key: z.string(), label: z.string(), path: z.string(), section: z.string(), pages: z.array(z.number()) }),
  phases: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      romps: z.array(z.number()),
      scheduleWbs: z.string(),
      window: z.object({ start: isoDate, finish: isoDate }),
      scheduleMilestones: z.array(z.object({ code: z.string(), externalId: z.string(), scheduleLabel: z.string(), date: isoDate, page: z.number() })),
    }),
  ),
  // Superseded by the manpower forecast; kept empty.
  workforcePlans: z.array(z.unknown()).length(0),
});

const range = z.object({ text: z.string(), low: z.number().int().min(0).nullable(), high: z.number().int().min(0) });
const forecastSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({ key: z.string(), title: z.string(), issuer: z.string(), issued: isoDate, copy: z.string(), path: z.string(), pages: z.record(z.string(), z.number()) }),
  period: z.object({ start: isoDate, finish: isoDate }),
  basis: z.literal("high"),
  basisNote: z.string(),
  planningNotes: z.array(z.string()),
  pools: z.array(z.object({ key: z.string(), role: z.string(), name: z.string(), series: z.enum(["installation", "support"]), ownedThrough: isoDate })),
  supersedes: z.object({ description: z.string(), reservationKey: z.string(), headcount: z.number().int() }),
  months: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), installation: range, support: range, combined: range, activity: z.string(), installationWorkfront: z.string() })),
});

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MILESTONE_NAMES: Record<string, string> = { SWD: "Start work date", FEA: "FEA", NEA: "NEA", H2C: "H2C", PFHO: "PFHO", PCO: "PCO" };
const MILESTONE_ORDER = ["SWD", "FEA", "NEA", "H2C", "PFHO", "PCO"];
export const CMH139_POOL_KEY = "cmh139-installer-pool";
export const phaseReservationKey = (phaseKey: string) => `cmh139-${phaseKey}-installers`;

type Seed = z.infer<typeof seedSchema>;
type PhasePlan = z.infer<typeof phasePlanSchema>;

const sameDate = (a: Date | null, b: string | null) => (dateFromDb(a) ?? null) === b;

/** Add a milestone source value unless one with the same label and date already exists. */
async function ensureSourceValue(tx: Tx, milestoneId: string, v: { sourceVersionId: string | null; sourceLabel: string; sourceDate: string | null; date: string | null; note: string | null }) {
  const existing = await tx.milestoneSourceValue.findMany({ where: { milestoneId, sourceLabel: v.sourceLabel } });
  if (existing.some((e) => sameDate(e.date, v.date))) return false;
  await tx.milestoneSourceValue.create({ data: { milestoneId, sourceVersionId: v.sourceVersionId, sourceLabel: v.sourceLabel, sourceDate: dateToDb(v.sourceDate), date: dateToDb(v.date), note: v.note } });
  return true;
}

async function reconcileStructure(tx: Tx, seed: Seed, plan: PhasePlan, workspaceId: string, log: string[]) {
  const counts = { phases: 0, areas: 0, memberships: 0, milestones: 0, sourceValues: 0, systems: 0 };
  const scope = seed.scopeItemsForConfirmation.map((s) => `- ${s}`).join("\n");
  let project = await tx.project.findUnique({ where: { workspaceId_code: { workspaceId, code: seed.project.code } } });
  const created = !project;
  project ??= await tx.project.create({
    data: { workspaceId, code: seed.project.code, name: seed.project.name, status: "PRELIMINARY", timezone: seed.project.timezone, description: `Preliminary configuration from reviewed seed candidates. Scope items to confirm (not established responsibilities):\n${scope}` },
  });
  log.push(created ? `Created project ${seed.project.code}` : `Found project ${seed.project.code}; reconciling without recreating it`);
  const projectId = project.id;

  const parties = await tx.projectParty.findMany({ where: { projectId } });
  for (const [role, name] of [["CUSTOMER", seed.project.customer], ["GENERAL_CONTRACTOR", seed.project.generalContractor], ["OWNER", seed.project.owner]] as const) {
    if (!parties.some((p) => p.role === role)) await setParty(tx, workspaceId, projectId, role, name);
  }

  const systemIds = new Map<string, string>();
  for (const [i, s] of seed.systems.entries()) {
    let row = await tx.system.findFirst({ where: { projectId, key: s.key } });
    if (!row) {
      row = await tx.system.create({ data: { projectId, key: s.key, name: s.name, sourceAliases: s.sourceAliasesForReview ?? [], sortOrder: i } });
      counts.systems++;
    }
    systemIds.set(s.key, row.id);
  }

  // Working plan and project calendar (Monday-start weeks, Monday-Friday eight-hour days).
  const open = seed.calendar.workingDays.map((d) => WEEKDAYS.indexOf(d) + 1);
  let working = await tx.plan.findFirst({ where: { projectId, kind: "WORKING" } });
  if (!working) {
    working = await tx.plan.create({ data: { projectId, kind: "WORKING", name: "Working plan", revision: 1 } });
    await tx.planRevision.create({ data: { planId: working.id, revision: 1, kind: "CREATE", summary: "Seeded CMH139 preliminary configuration" } });
  }
  if (!(await tx.calendar.findFirst({ where: { planId: working.id } }))) {
    const pattern = defaultWeekPattern(seed.calendar.hoursPerWorkingDay).map((d, i) => (open.includes(i + 1) ? { ...d, open: true, hours: seed.calendar.hoursPerWorkingDay } : { ...d, open: false, hours: 0 }));
    await tx.calendar.create({ data: { planId: working.id, key: "project", name: "Project calendar", timezone: seed.project.timezone, isDefault: true, definition: { ...defaultCalendarDefinition(), weekPattern: pattern } as unknown as Prisma.InputJsonValue } });
  }
  const pool =
    (await tx.allocationNode.findFirst({ where: { planId: working.id, kind: "POOL", role: "Installer" }, orderBy: { sortOrder: "asc" } })) ??
    (await tx.allocationNode.create({ data: { planId: working.id, projectId, key: CMH139_POOL_KEY, kind: "POOL", name: "Installers — shared workforce", role: "Installer" } }));

  // Milestone correspondence as a reviewed manual source lineage with one version per table.
  const lineage =
    (await tx.sourceLineage.findFirst({ where: { projectId, name: "ACE milestone correspondence" } })) ??
    (await tx.sourceLineage.create({ data: { projectId, name: "ACE milestone correspondence", kind: "MANUAL_TABLE", description: "Milestone tables from ACE Electric email correspondence, entered through review. Email screenshots are references only." } }));
  const manualSources = seed.sources.filter((s) => s.kind.includes("milestone")).sort((a, b) => (a.sourceDate ?? "").localeCompare(b.sourceDate ?? ""));
  const versions = new Map<string, string>();
  const existingVersions = await tx.sourceVersion.findMany({ where: { lineageId: lineage.id }, orderBy: { versionNumber: "asc" } });
  for (const s of manualSources) {
    const label = `ACE milestone table ${s.sourceDate}`;
    let v = existingVersions.find((x) => (x.summary as { seedSourceKey?: string } | null)?.seedSourceKey === s.key || x.label === label);
    if (!v) {
      const versionNumber = Math.max(0, ...existingVersions.map((x) => x.versionNumber)) + 1;
      v = await tx.sourceVersion.create({ data: { lineageId: lineage.id, projectId, versionNumber, label, sourceDate: dateToDb(s.sourceDate ?? null), summary: { status: s.status ?? null, kind: s.kind, seedSourceKey: s.key } } });
      existingVersions.push(v);
    }
    versions.set(s.key, v.id);
  }
  const manualLabel = (key: string) => {
    const s = manualSources.find((x) => x.key === key);
    return { label: `ACE milestone table ${s?.sourceDate ?? ""}`.trim(), date: s?.sourceDate ?? null };
  };
  if (!(await tx.sourceLineage.findFirst({ where: { projectId, kind: "PDF_SCHEDULE" } }))) {
    // Versions of the schedule lineage come only from the reviewed import workflow.
    await tx.sourceLineage.create({ data: { projectId, name: "Gray Construction master schedule", kind: "PDF_SCHEDULE", description: "Construction schedule PDFs from the general contractor." } });
  }

  // Phases, ROMP areas (membership separate from the location hierarchy), milestones.
  const phaseIds = new Map<string, string>();
  const existingPhases = await tx.phase.findMany({ where: { projectId } });
  for (const [i, ph] of seed.phases.entries()) {
    const sched = plan.phases.find((p) => p.key === ph.key);
    let phase = existingPhases.find((p) => p.key === ph.key) ?? existingPhases.find((p) => p.name.trim().toLowerCase() === ph.name.toLowerCase());
    if (!phase) {
      phase = await tx.phase.create({ data: { projectId, key: ph.key, name: ph.name, sortOrder: i, description: `ROMPs ${ph.romps.join(" and ")}${sched ? ` · schedule WBS "${sched.scheduleWbs}"` : ""} · ${ph.status}` } });
      existingPhases.push(phase);
      counts.phases++;
    }
    phaseIds.set(ph.key, phase.id);
    const members = await tx.phaseArea.findMany({ where: { phaseId: phase.id } });
    for (const r of ph.romps) {
      const code = `ROMP${String(r).padStart(2, "0")}`;
      let area = await tx.area.findFirst({ where: { projectId, code } });
      if (!area) {
        area = await tx.area.create({ data: { projectId, kind: "ROMP", name: `ROMP ${String(r).padStart(2, "0")}`, code, sortOrder: r } });
        counts.areas++;
      }
      if (!members.some((m) => m.areaId === area.id)) {
        await tx.phaseArea.create({ data: { phaseId: phase.id, areaId: area.id } });
        counts.memberships++;
      }
    }

    const candidates: [string, string | null][] = Object.entries(ph.milestoneCandidates);
    if (sched?.scheduleMilestones.some((m) => m.code === "PCO") && !("PCO" in ph.milestoneCandidates)) candidates.push(["PCO", null]);
    for (const [code, date] of candidates) {
      const sm = sched?.scheduleMilestones.find((m) => m.code === code);
      let m = await tx.milestone.findFirst({ where: { projectId, phaseId: phase.id, code } });
      if (!m) {
        const fromCorrespondence = code in ph.milestoneCandidates;
        m = await tx.milestone.create({
          data: { projectId, phaseId: phase.id, code, name: MILESTONE_NAMES[code] ?? code, date: null, reviewStatus: "NEEDS_REVIEW", sortOrder: i * 10 + Math.max(0, MILESTONE_ORDER.indexOf(code)), notes: fromCorrespondence ? (date ? null : "Not specified in the source table.") : "From the Gray preliminary schedule; not in the ACE milestone table." },
        });
        counts.milestones++;
      }
      if (code in ph.milestoneCandidates) {
        const src = manualLabel(ph.sourceKey);
        if (await ensureSourceValue(tx, m.id, { sourceVersionId: versions.get(ph.sourceKey) ?? null, sourceLabel: src.label, sourceDate: src.date, date, note: date ? null : "Unspecified in this table" })) counts.sourceValues++;
        const disc = seed.sourceDiscrepancies.find((d) => `phase-${d.phase}` === ph.key && d.milestone === code);
        if (disc) {
          const earlier = manualLabel(disc.earlier.sourceKey);
          if (await ensureSourceValue(tx, m.id, { sourceVersionId: versions.get(disc.earlier.sourceKey) ?? null, sourceLabel: earlier.label, sourceDate: earlier.date, date: disc.earlier.date, note: "Earlier table; retained as source history. Later value is adopted only through review." })) counts.sourceValues++;
        }
      }
      if (sm) {
        // Schedule provenance; the label difference (for example "Gray Early Start Work Date") is kept in the note.
        if (await ensureSourceValue(tx, m.id, { sourceVersionId: null, sourceLabel: `${plan.source.label} (${sm.externalId})`, sourceDate: "2026-10-15", date: sm.date, note: `${sm.scheduleLabel}, page ${sm.page}` })) counts.sourceValues++;
      }
    }
  }

  // Leadership candidates: Tyler Sisia as PM, main foreman TBD. Dates require operator selection.
  const leaders = await tx.leadershipAssignment.findMany({ where: { planId: working.id } });
  for (const [i, c] of seed.personnelCandidates.entries()) {
    if (leaders.some((l) => l.role === c.projectRole)) continue;
    let personId: string | null = null;
    if (c.name) {
      const person = (await tx.person.findFirst({ where: { workspaceId, displayName: c.name } })) ?? (await tx.person.create({ data: { workspaceId, displayName: c.name, title: "Fire alarm and low-voltage division lead" } }));
      personId = person.id;
    }
    await tx.leadershipAssignment.create({
      data: {
        planId: working.id,
        projectId,
        key: randomUUID(),
        personId,
        placeholderName: c.name ?? c.displayName ?? "TBD",
        role: c.projectRole,
        responsibilitySystemIds: (c.responsibilitySystems ?? []).map((k) => systemIds.get(k)!).filter(Boolean),
        onsiteMode: "PROJECT_CALENDAR",
        onsiteWeekdays: open.filter((d) => d >= 1 && d <= 7),
        sortOrder: i,
        notes: c.name ? "Planned onsite full time initially; select assignment dates and onsite schedule." : "Main foreman to be named. Oversees all four systems; counts once.",
      },
    });
  }

  // Milestone codes used by the schedule (PCO) are offered when adding milestones.
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (!ws.milestoneCodes.includes("PCO")) await tx.workspace.update({ where: { id: workspaceId }, data: { milestoneCodes: [...ws.milestoneCodes, "PCO"] } });
  // The manpower forecast plans ACE site-safety ground support as its own workforce role.
  if (!ws.installerRoles.includes("Ground support")) await tx.workspace.update({ where: { id: workspaceId }, data: { installerRoles: [...ws.installerRoles, "Ground support"] } });

  const added = Object.entries(counts).filter(([, n]) => n > 0);
  if (added.length) {
    await audit(tx, null, { workspaceId, projectId, action: "seed.cmh139", entityType: "Project", entityId: projectId, summary: `CMH139 seed reconciliation added ${added.map(([k, n]) => `${n} ${k}`).join(", ")}` });
  }
  log.push(added.length ? `Added ${added.map(([k, n]) => `${n} ${k}`).join(", ")}` : "Project structure already complete");
  return { projectId, created, workingId: working.id, poolKey: pool.key, phaseIds };
}

export async function seedCmh139(repoRoot: string, opts: { attachSourcePdf?: boolean } = {}) {
  const seed = seedSchema.parse(JSON.parse(await readFile(path.join(repoRoot, "fixtures/seed/cmh139.preliminary.json"), "utf8")));
  const plan = phasePlanSchema.parse(JSON.parse(await readFile(path.join(repoRoot, "fixtures/seed/cmh139.phase-plan.json"), "utf8")));
  const forecast = forecastSchema.parse(JSON.parse(await readFile(path.join(repoRoot, "fixtures/seed/cmh139.manpower-forecast.json"), "utf8")));
  const log: string[] = [];

  let ws = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (!ws) {
    ws = await prisma.workspace.create({ data: { name: seed.workspace.name, appDisplayName: seed.workspace.applicationDisplayName } });
    log.push(`Created workspace ${ws.name}`);
  }
  const workspaceId = ws.id;

  const s = await prisma.$transaction((tx) => reconcileStructure(tx, seed, plan, workspaceId, log), { timeout: 120_000 });
  const phases = await prisma.phase.findMany({ where: { projectId: s.projectId }, orderBy: { sortOrder: "asc" }, select: { name: true } });
  log.push(`${phases.length} phases: ${phases.map((p) => p.name).join(", ")}`);

  // Phase windows from the schedule; staffing from the MNE manpower forecast (installation and ground support pools).
  const data = await loadPlanData(prisma, s.workingId);
  const cal = projectResolver(data);
  const months = (series: "installation" | "support") => forecast.months.map((m) => ({ month: m.month, headcount: m[series].high }));
  const fmt = (series: "installation" | "support") => forecast.months.map((m) => `${m.month} ${m[series].text}`).join(", ");
  const pools: PoolForecast[] = forecast.pools.map((p, i) => ({
    role: p.role,
    key: p.key,
    name: p.name,
    sortOrder: i,
    ownedFrom: forecast.period.start,
    ownedTo: p.ownedThrough,
    valueOn: monthlyValue(months(p.series), forecast.period.start, forecast.period.finish),
    notes: `Planned capacity from the ${forecast.source.issuer} manpower forecast of ${forecast.source.issued} (${p.series === "installation" ? "installation, working leads included" : "ACE site-safety ground support, incremental to installation"}), ${forecast.period.start} to ${forecast.period.finish}, at the upper figure of each monthly range: ${fmt(p.series)}. Ranges reflect intermittent activity; this is a planning envelope, not a roster or minimum.`,
  }));
  const windows = plan.phases.map((ph) => ({ phaseId: s.phaseIds.get(ph.key)!, name: ph.name, start: ph.window.start, finish: ph.window.finish, note: `Start Work Date through PCO, per the ${plan.source.label} (Contract Milestones).` }));
  const retire = plan.phases.map((ph) => {
    const key = forecast.supersedes.reservationKey.replace("{phaseKey}", ph.key);
    return { nodeKey: key, name: `${ph.name} installers (planned)`, expected: windowEntries(key, ph.window.start, ph.window.finish, forecast.supersedes.headcount, cal) };
  });
  const result = applySeedStaffing(data, { windows, retire, pools });
  if (result.changed) {
    try {
      const r = await mutatePlan(null, s.workingId, data.plan.revision, () => result.data, {
        kind: "SEED",
        summary: `Applied the ${forecast.source.issued} manpower forecast (installation up to ${Math.max(...months("installation").map((m) => m.headcount))}, ground support up to ${Math.max(...months("support").map((m) => m.headcount))}) and schedule phase windows`,
        workspaceId,
      });
      log.push(`Working plan updated to revision ${r.revision}`);
    } catch (err) {
      throw new Error(`CMH139 staffing was not changed: ${err instanceof Error ? err.message : String(err)}. Reservations under a pool must fit within the forecast; adjust them and run the seed again.`);
    }
  } else log.push("Phase windows and forecast staffing already up to date");
  for (const n of result.notes) log.push(n);
  for (const m of forecast.months) log.push(`  ${m.month}: installation ${m.installation.text} → ${m.installation.high}, ground support ${m.support.text} → ${m.support.high} (combined up to ${m.combined.high}; ${m.activity})`);

  if (opts.attachSourcePdf !== false) {
    const docs = [
      { path: seed.sources.find((x) => x.path)?.path, kind: "SOURCE_SCHEDULE" as const, filename: "2026.10.15 AWS CMH139 Preliminary Schedule.pdf", title: "2026.10.15 AWS CMH139 Preliminary Schedule (59 pages)", category: "SCHEDULE", notes: "Original construction schedule. Import it from the Imports tab to review activities." },
      { path: forecast.source.path, kind: "ATTACHMENT" as const, filename: "CMH139 Manpower Loading 2026-11-06.pdf", title: "CMH139 revised manpower loading, 6 Nov 2026 (ACE coordination copy)", category: "CORRESPONDENCE", notes: "MNE installation manpower and ACE site-safety support forecast, Apr 2027 to Mar 2028. Seeded as pool capacity at the upper figure of each monthly range." },
    ];
    for (const d of docs) {
      if (!d.path) continue;
      const bytes = new Uint8Array(await readFile(path.join(repoRoot, d.path)));
      const hash = sha256(bytes);
      if (await prisma.storedFile.findFirst({ where: { projectId: s.projectId, sha256: hash } })) continue;
      await prisma.$transaction(async (tx) => {
        const file = await storeFile(tx, { workspaceId, projectId: s.projectId, kind: d.kind, filename: d.filename, contentType: "application/pdf", bytes, immutable: true, createdById: null });
        await tx.projectDocument.create({ data: { projectId: s.projectId, fileId: file.id, title: d.title, category: d.category, notes: `${d.notes} SHA-256 ${hash}.` } });
      });
      log.push(`Attached ${d.title} as a project document`);
    }
  }
  return { projectId: s.projectId, created: s.created, log };
}
