import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defaultCalendarDefinition, defaultWeekPattern } from "@/domain/calendar";
import { dateToDb } from "@/domain/dates";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { setParty } from "@/server/services/projects";
import { sha256, storeFile } from "@/server/services/files";

/**
 * Production seed for CMH139 from fixtures/seed/cmh139.preliminary.json.
 * Seeds configuration and reviewed candidates only: no installer counts,
 * no radio/cellular windows, no actual progress, no foreman name. Milestone
 * dates stay candidates (NEEDS_REVIEW) with their provenance; the Phase 1 NEA
 * discrepancy between the 16 and 23 October tables is kept as two source
 * values. Re-running is idempotent.
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
  workforcePlans: z.array(z.unknown()).length(0),
  actualProgress: z.array(z.unknown()).length(0),
  scopeItemsForConfirmation: z.array(z.string()),
});

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MILESTONE_NAMES: Record<string, string> = {
  SWD: "Start work date",
  FEA: "FEA",
  NEA: "NEA",
  H2C: "H2C",
  PFHO: "PFHO",
};

export async function seedCmh139(repoRoot: string, opts: { attachSourcePdf?: boolean } = {}) {
  const seed = seedSchema.parse(JSON.parse(await readFile(path.join(repoRoot, "fixtures/seed/cmh139.preliminary.json"), "utf8")));
  const log: string[] = [];

  let ws = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (!ws) {
    ws = await prisma.workspace.create({ data: { name: seed.workspace.name, appDisplayName: seed.workspace.applicationDisplayName } });
    log.push(`Created workspace ${ws.name}`);
  }
  const workspaceId = ws.id;

  const existing = await prisma.project.findUnique({ where: { workspaceId_code: { workspaceId, code: seed.project.code } } });
  if (existing) {
    log.push(`Project ${seed.project.code} already exists; seed left it unchanged.`);
    return { projectId: existing.id, log };
  }

  const project = await prisma.$transaction(
    async (tx) => {
      const scope = seed.scopeItemsForConfirmation.map((s) => `- ${s}`).join("\n");
      const project = await tx.project.create({
        data: {
          workspaceId,
          code: seed.project.code,
          name: seed.project.name,
          status: "PRELIMINARY",
          timezone: seed.project.timezone,
          description: `Preliminary configuration from reviewed seed candidates. Scope items to confirm (not established responsibilities):\n${scope}`,
        },
      });
      await setParty(tx, workspaceId, project.id, "CUSTOMER", seed.project.customer);
      await setParty(tx, workspaceId, project.id, "GENERAL_CONTRACTOR", seed.project.generalContractor);
      await setParty(tx, workspaceId, project.id, "OWNER", seed.project.owner);

      const systemIds = new Map<string, string>();
      for (const [i, s] of seed.systems.entries()) {
        const row = await tx.system.create({ data: { projectId: project.id, key: s.key, name: s.name, sourceAliases: s.sourceAliasesForReview ?? [], sortOrder: i } });
        systemIds.set(s.key, row.id);
      }

      // Calendar: Monday-start weeks, Monday-Friday eight-hour days, no exceptions.
      const open = seed.calendar.workingDays.map((d) => WEEKDAYS.indexOf(d) + 1);
      const pattern = defaultWeekPattern(seed.calendar.hoursPerWorkingDay).map((d, i) => (open.includes(i + 1) ? { ...d, open: true, hours: seed.calendar.hoursPerWorkingDay } : { ...d, open: false, hours: 0 }));
      const plan = await tx.plan.create({ data: { projectId: project.id, kind: "WORKING", name: "Working plan", revision: 1 } });
      await tx.calendar.create({ data: { planId: plan.id, key: "project", name: "Project calendar", timezone: seed.project.timezone, isDefault: true, definition: { ...defaultCalendarDefinition(), weekPattern: pattern } as unknown as Prisma.InputJsonValue } });
      await tx.allocationNode.create({ data: { planId: plan.id, projectId: project.id, key: randomUUID(), kind: "POOL", name: "Installers — shared workforce", role: "Installer" } });

      // Milestone correspondence as a reviewed manual source lineage with two versions.
      const lineage = await tx.sourceLineage.create({ data: { projectId: project.id, name: "ACE milestone correspondence", kind: "MANUAL_TABLE", description: "Milestone tables from ACE Electric email correspondence, entered through review. Email screenshots are references only." } });
      const versions = new Map<string, string>();
      const manualSources = seed.sources.filter((s) => s.kind.includes("milestone")).sort((a, b) => (a.sourceDate ?? "").localeCompare(b.sourceDate ?? ""));
      for (const [i, s] of manualSources.entries()) {
        const v = await tx.sourceVersion.create({
          data: { lineageId: lineage.id, projectId: project.id, versionNumber: i + 1, label: `ACE milestone table ${s.sourceDate}`, sourceDate: dateToDb(s.sourceDate ?? null), summary: { status: s.status ?? null, kind: s.kind, seedSourceKey: s.key } },
        });
        versions.set(s.key, v.id);
      }
      const labelFor = (key: string) => manualSources.find((s) => s.key === key);

      // Phases, ROMP areas (phase membership separate from the location hierarchy), milestones.
      for (const [i, ph] of seed.phases.entries()) {
        const phase = await tx.phase.create({ data: { projectId: project.id, key: ph.key, name: ph.name, sortOrder: i, description: `ROMPs ${ph.romps.join(" and ")} · ${ph.status}` } });
        for (const r of ph.romps) {
          const code = `ROMP${String(r).padStart(2, "0")}`;
          const area = (await tx.area.findFirst({ where: { projectId: project.id, code } })) ?? (await tx.area.create({ data: { projectId: project.id, kind: "ROMP", name: `ROMP ${String(r).padStart(2, "0")}`, code, sortOrder: r } }));
          await tx.phaseArea.create({ data: { phaseId: phase.id, areaId: area.id } });
        }
        let order = 0;
        for (const [code, date] of Object.entries(ph.milestoneCandidates)) {
          const m = await tx.milestone.create({
            data: { projectId: project.id, phaseId: phase.id, code, name: MILESTONE_NAMES[code] ?? code, date: null, reviewStatus: "NEEDS_REVIEW", sortOrder: i * 10 + order++, notes: date ? null : "Not specified in the source table." },
          });
          const src = labelFor(ph.sourceKey);
          await tx.milestoneSourceValue.create({
            data: { milestoneId: m.id, sourceVersionId: versions.get(ph.sourceKey) ?? null, sourceLabel: `ACE milestone table ${src?.sourceDate ?? ""}`.trim(), sourceDate: dateToDb(src?.sourceDate ?? null), date: dateToDb(date), note: date ? null : "Unspecified in this table" },
          });
          const disc = seed.sourceDiscrepancies.find((d) => `phase-${d.phase}` === ph.key && d.milestone === code);
          if (disc) {
            const earlier = labelFor(disc.earlier.sourceKey);
            await tx.milestoneSourceValue.create({
              data: { milestoneId: m.id, sourceVersionId: versions.get(disc.earlier.sourceKey) ?? null, sourceLabel: `ACE milestone table ${earlier?.sourceDate ?? ""}`.trim(), sourceDate: dateToDb(earlier?.sourceDate ?? null), date: dateToDb(disc.earlier.date), note: "Earlier table; retained as source history. Later value is adopted only through review." },
            });
          }
        }
      }

      // The PDF schedule lineage exists; its versions come only from the reviewed import workflow.
      await tx.sourceLineage.create({ data: { projectId: project.id, name: "Gray Construction master schedule", kind: "PDF_SCHEDULE", description: "Construction schedule PDFs from the general contractor." } });

      // Leadership candidates: Tyler Sisia as PM, main foreman TBD. Dates require operator selection.
      for (const [i, c] of seed.personnelCandidates.entries()) {
        let personId: string | null = null;
        if (c.name) {
          const person = (await tx.person.findFirst({ where: { workspaceId, displayName: c.name } })) ?? (await tx.person.create({ data: { workspaceId, displayName: c.name, title: "Fire alarm and low-voltage division lead" } }));
          personId = person.id;
        }
        await tx.leadershipAssignment.create({
          data: {
            planId: plan.id,
            projectId: project.id,
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
      await tx.planRevision.create({ data: { planId: plan.id, revision: 1, kind: "CREATE", summary: "Seeded CMH139 preliminary configuration" } });
      await audit(tx, null, { workspaceId, projectId: project.id, action: "seed.cmh139", entityType: "Project", entityId: project.id, summary: "Seeded CMH139 from fixtures/seed/cmh139.preliminary.json" });
      return project;
    },
    { timeout: 60_000 },
  );
  log.push(`Created project ${seed.project.code} with ${seed.phases.length} phases and ${seed.systems.length} systems`);

  if (opts.attachSourcePdf !== false) {
    const pdf = seed.sources.find((s) => s.path);
    if (pdf?.path) {
      const bytes = new Uint8Array(await readFile(path.join(repoRoot, pdf.path)));
      await prisma.$transaction(async (tx) => {
        const file = await storeFile(tx, { workspaceId, projectId: project.id, kind: "SOURCE_SCHEDULE", filename: "2026.10.15 AWS CMH139 Preliminary Schedule.pdf", contentType: "application/pdf", bytes, immutable: true, createdById: null });
        await tx.projectDocument.create({ data: { projectId: project.id, fileId: file.id, title: "2026.10.15 AWS CMH139 Preliminary Schedule (59 pages)", category: "SCHEDULE", notes: `Original construction schedule. SHA-256 ${sha256(bytes)}. Import it from the Imports tab to review activities.` } });
      });
      log.push("Attached the source schedule PDF as a project document (not imported)");
    }
  }
  return { projectId: project.id, log };
}
