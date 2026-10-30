import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defaultCalendarDefinition, defaultWeekPattern } from "@/domain/calendar";
import { dateFromDb, dateToDb } from "@/domain/dates";
import { applyPhaseStaffing, type PhaseStaffing } from "@/domain/phase-plan";
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
  workforcePlans: z.array(z.object({ phaseKey: z.string(), role: z.string(), plannedHeadcount: z.number().int().min(1), window: z.literal("phase") })),
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

  // Planned installer headcount per phase over its exact window, nested under the shared pool.
  const data = await loadPlanData(prisma, s.workingId);
  const pool = data.nodes.find((n) => n.key === s.poolKey)!;
  const staffing: PhaseStaffing[] = plan.workforcePlans.map((w, i) => {
    const ph = plan.phases.find((p) => p.key === w.phaseKey)!;
    return {
      phaseId: s.phaseIds.get(w.phaseKey)!,
      nodeKey: phaseReservationKey(w.phaseKey),
      name: `${ph.name} installers (planned)`,
      notes: `Planned capacity: ${w.plannedHeadcount} installers from the Start Work Date through PCO (${ph.window.start} to ${ph.window.finish}), per the ${plan.source.label} Contract Milestones. Headcount, not named people.`,
      role: w.role,
      headcount: w.plannedHeadcount,
      start: ph.window.start,
      finish: ph.window.finish,
      sortOrder: i,
    };
  });
  const result = applyPhaseStaffing(data, pool, staffing);
  if (result.changed) {
    const r = await mutatePlan(null, s.workingId, data.plan.revision, () => result.data, {
      kind: "SEED",
      summary: `Seeded phase windows and planned installer headcount for ${staffing.length} phases`,
      workspaceId,
    });
    log.push(`Working plan updated to revision ${r.revision}`);
  } else log.push("Phase windows and planned staffing already up to date");
  for (const n of result.notes) log.push(n);

  if (opts.attachSourcePdf !== false) {
    const pdf = seed.sources.find((x) => x.path);
    if (pdf?.path) {
      const bytes = new Uint8Array(await readFile(path.join(repoRoot, pdf.path)));
      const hash = sha256(bytes);
      if (!(await prisma.storedFile.findFirst({ where: { projectId: s.projectId, sha256: hash } }))) {
        await prisma.$transaction(async (tx) => {
          const file = await storeFile(tx, { workspaceId, projectId: s.projectId, kind: "SOURCE_SCHEDULE", filename: "2026.10.15 AWS CMH139 Preliminary Schedule.pdf", contentType: "application/pdf", bytes, immutable: true, createdById: null });
          await tx.projectDocument.create({ data: { projectId: s.projectId, fileId: file.id, title: "2026.10.15 AWS CMH139 Preliminary Schedule (59 pages)", category: "SCHEDULE", notes: `Original construction schedule. SHA-256 ${hash}. Import it from the Imports tab to review activities.` } });
        });
        log.push("Attached the source schedule PDF as a project document (not imported)");
      }
    }
  }
  return { projectId: s.projectId, created: s.created, log };
}
