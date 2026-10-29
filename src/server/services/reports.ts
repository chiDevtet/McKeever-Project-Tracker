import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dateToDb, isISODate } from "@/domain/dates";
import { computePlanningIssues } from "@/domain/issues";
import { validatePlan } from "@/domain/ops";
import { reportSettingsSchema, type ReportSettingsInput } from "@/domain/report";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { assertPlanAccess, assertProjectAccess, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { enqueueJob, QUEUES } from "@/server/jobs/queue";
import { createSnapshot, snapshotFromRow, type SnapshotData } from "@/server/snapshots";

// Presets ---------------------------------------------------------------------

export async function listPresets(viewer: Viewer, projectId: string) {
  await assertProjectAccess(viewer, projectId, "read");
  const rows = await prisma.exportPreset.findMany({ where: { workspaceId: viewer.workspaceId, OR: [{ projectId }, { projectId: null }] }, orderBy: { name: "asc" } });
  return rows.map((p) => ({ id: p.id, name: p.name, projectId: p.projectId, settings: reportSettingsSchema.parse(p.settings), revision: p.revision, updatedAt: p.updatedAt.toISOString() }));
}

/** Presets store settings only, never frozen project values. */
export async function savePreset(viewer: Viewer, raw: { projectId: string; scope: "project" | "workspace"; id?: string; name: string; settings: ReportSettingsInput; expectedRevision?: number }) {
  const input = z.object({ projectId: z.string(), scope: z.enum(["project", "workspace"]), id: z.string().optional(), name: z.string().trim().min(1).max(120), settings: reportSettingsSchema, expectedRevision: z.number().int().optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const projectId = input.scope === "project" ? input.projectId : null;
  return prisma.$transaction(async (tx) => {
    if (input.id) {
      const before = await tx.exportPreset.findFirst({ where: { id: input.id, workspaceId: viewer.workspaceId } });
      if (!before) throw notFound("Preset");
      if (input.expectedRevision !== undefined && before.revision !== input.expectedRevision) throw badRequest("This preset was changed by someone else. Reload presets and try again.");
      const p = await tx.exportPreset.update({ where: { id: input.id }, data: { name: input.name, settings: input.settings as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
      await audit(tx, viewer, { projectId: input.projectId, action: "preset.update", entityType: "ExportPreset", entityId: p.id, summary: `Updated preset ${p.name}`, before: before.settings, after: input.settings });
      return { id: p.id, revision: p.revision };
    }
    // Workspace presets have a NULL project, which a compound unique lookup cannot match.
    const existing = await tx.exportPreset.findFirst({ where: { workspaceId: viewer.workspaceId, projectId, name: input.name } });
    const p = existing
      ? await tx.exportPreset.update({ where: { id: existing.id }, data: { settings: input.settings as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } })
      : await tx.exportPreset.create({ data: { workspaceId: viewer.workspaceId, projectId, name: input.name, settings: input.settings as unknown as Prisma.InputJsonValue, createdById: viewer.userId } });
    await audit(tx, viewer, { projectId: input.projectId, action: "preset.save", entityType: "ExportPreset", entityId: p.id, summary: `Saved preset ${p.name}`, after: input.settings });
    return { id: p.id, revision: p.revision };
  });
}

export async function deletePreset(viewer: Viewer, raw: { projectId: string; id: string }) {
  await assertProjectAccess(viewer, raw.projectId, "edit");
  const p = await prisma.exportPreset.findFirst({ where: { id: raw.id, workspaceId: viewer.workspaceId } });
  if (!p) throw notFound("Preset");
  await prisma.$transaction(async (tx) => {
    await tx.exportPreset.delete({ where: { id: p.id } });
    await audit(tx, viewer, { projectId: raw.projectId, action: "preset.delete", entityType: "ExportPreset", entityId: p.id, summary: `Deleted preset ${p.name}` });
  });
  return { ok: true };
}

// Sources for generation -------------------------------------------------------

export async function listReportSources(viewer: Viewer, projectId: string) {
  await assertProjectAccess(viewer, projectId, "read");
  const [plans, snapshots] = await Promise.all([
    prisma.plan.findMany({ where: { projectId, status: "ACTIVE" }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }),
    prisma.planSnapshot.findMany({ where: { projectId, kind: "BASELINE" }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, planRevision: true, createdAt: true, planKind: true } }),
  ]);
  return {
    plans: plans.map((p) => ({ id: p.id, kind: p.kind, name: p.name, revision: p.revision })),
    baselines: snapshots.map((s) => ({ id: s.id, name: s.name, planRevision: s.planRevision, createdAt: s.createdAt.toISOString() })),
  };
}

/** Frozen snapshot content for previews and comparisons (access-checked). */
export async function getSnapshotData(viewer: Viewer, raw: { snapshotId: string }): Promise<SnapshotData & { id: string; name: string; kind: string }> {
  const s = await prisma.planSnapshot.findUnique({ where: { id: raw.snapshotId } });
  if (!s) throw notFound("Snapshot");
  await assertProjectAccess(viewer, s.projectId, "read");
  return { ...snapshotFromRow(s), id: s.id, name: s.name, kind: s.kind };
}

// Generation ----------------------------------------------------------------

const sourceInput = z.discriminatedUnion("kind", [z.object({ kind: z.literal("plan"), planId: z.string() }), z.object({ kind: z.literal("snapshot"), snapshotId: z.string() })]);

/**
 * Capture an immutable snapshot (or reuse a baseline) and queue rendering of
 * the requested formats from it. The worker builds the dataset from the
 * snapshot only, so later edits cannot change the files.
 */
export async function generateReport(viewer: Viewer, raw: { projectId: string; source: z.input<typeof sourceInput>; settings: ReportSettingsInput; presetId?: string | null; presetName?: string | null; requestId?: string }) {
  const input = z.object({ projectId: z.string(), source: sourceInput, settings: reportSettingsSchema, presetId: z.string().nullable().optional(), presetName: z.string().max(120).nullable().optional(), requestId: z.string().max(100).optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const requestId = input.requestId ?? randomUUID();
  const already = await prisma.backgroundJob.findUnique({ where: { idempotencyKey: `report:${requestId}` } });
  if (already) {
    const payload = already.payload as { snapshotId: string; reportIds: string[] };
    return { jobId: already.id, snapshotId: payload.snapshotId, reportIds: payload.reportIds };
  }
  let snapshotId: string;
  let exploratory = false;
  if (input.source.kind === "plan") {
    const { plan } = await assertPlanAccess(viewer, input.source.planId, "read");
    if (plan.projectId !== input.projectId) throw badRequest("Plan does not belong to this project");
    exploratory = plan.kind === "SCENARIO";
    const snap = await prisma.$transaction((tx) => createSnapshot(tx, { planId: plan.id, kind: "REPORT", name: `${input.settings.title} (${plan.kind === "WORKING" ? "working" : "scenario"} rev ${plan.revision})`, createdById: viewer.userId }), { timeout: 60_000 });
    snapshotId = snap.id;
  } else {
    const snap = await prisma.planSnapshot.findFirst({ where: { id: input.source.snapshotId, projectId: input.projectId } });
    if (!snap) throw notFound("Snapshot");
    exploratory = snap.planKind === "SCENARIO";
    snapshotId = snap.id;
  }
  const reportIds = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const format of input.settings.formats) {
      const r = await tx.generatedReport.create({
        data: { projectId: input.projectId, snapshotId, presetId: input.presetId ?? null, presetName: input.presetName ?? null, title: input.settings.title, format, settings: input.settings as unknown as Prisma.InputJsonValue, authorId: viewer.userId, authorName: input.settings.preparedBy || viewer.name, exploratory },
      });
      ids.push(r.id);
    }
    await audit(tx, viewer, { projectId: input.projectId, action: "report.generate", entityType: "PlanSnapshot", entityId: snapshotId, summary: `Generating ${input.settings.formats.join(" + ")} “${input.settings.title}”${exploratory ? " (exploratory scenario)" : ""}`, after: { settings: input.settings, reportIds: ids } });
    return ids;
  });
  const job = await enqueueJob({ workspaceId: viewer.workspaceId, projectId: input.projectId, kind: QUEUES.reportRender, payload: { snapshotId, reportIds }, idempotencyKey: `report:${requestId}`, createdById: viewer.userId });
  await prisma.generatedReport.updateMany({ where: { id: { in: reportIds } }, data: { jobId: job.id } });
  return { jobId: job.id, snapshotId, reportIds };
}

export async function listReports(viewer: Viewer, projectId: string) {
  await assertProjectAccess(viewer, projectId, "read");
  const [reports, submissions] = await Promise.all([
    prisma.generatedReport.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 200, include: { snapshot: { select: { planRevision: true, planKind: true, planName: true, kind: true, name: true } } } }),
    prisma.submission.findMany({ where: { projectId }, orderBy: { sequence: "desc" }, include: { reports: { select: { id: true, format: true, fileId: true } }, snapshot: { select: { planRevision: true, name: true } } } }),
  ]);
  const jobs = await prisma.backgroundJob.findMany({ where: { id: { in: [...new Set(reports.map((r) => r.jobId).filter(Boolean) as string[])] } } });
  return {
    reports: reports.map((r) => {
      const job = jobs.find((j) => j.id === r.jobId);
      return {
        id: r.id,
        title: r.title,
        format: r.format,
        status: r.status,
        error: r.error,
        fileId: r.fileId,
        sizeBytes: r.sizeBytes,
        sha256: r.sha256,
        datasetHash: r.datasetHash,
        snapshotId: r.snapshotId,
        planLabel: `${r.snapshot.planKind === "WORKING" ? "Working plan" : `Scenario ${r.snapshot.planName}`} rev ${r.snapshot.planRevision}${r.snapshot.kind === "BASELINE" ? ` · baseline ${r.snapshot.name}` : ""}`,
        exploratory: r.exploratory,
        authorName: r.authorName,
        presetName: r.presetName,
        createdAt: r.createdAt.toISOString(),
        readyAt: r.readyAt?.toISOString() ?? null,
        submissionId: r.submissionId,
        job: job ? { status: job.status, progress: job.progress, message: job.message, attempts: job.attempts } : null,
      };
    }),
    submissions: submissions.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      title: s.title,
      issueDate: s.issueDate.toISOString().slice(0, 10),
      recipientLabel: s.recipientLabel,
      reference: s.reference,
      recordedByName: s.recordedByName,
      createdAt: s.createdAt.toISOString(),
      planRevision: s.snapshot.planRevision,
      snapshotId: s.snapshotId,
      acknowledgedIssues: (s.acknowledgedIssues as { id: string; message: string }[]).length,
      files: s.reports.map((r) => ({ id: r.id, format: r.format, fileId: r.fileId })),
    })),
  };
}

/** Issues a submission must acknowledge, computed from the frozen snapshot. */
export async function submissionChecks(viewer: Viewer, raw: { projectId: string; snapshotId: string }) {
  await assertProjectAccess(viewer, raw.projectId, "read");
  const snap = await prisma.planSnapshot.findFirst({ where: { id: raw.snapshotId, projectId: raw.projectId } });
  if (!snap) throw notFound("Snapshot");
  const data = snapshotFromRow(snap).plan;
  return { blocking: validatePlan(data).map((i) => i.message), issues: computePlanningIssues(data).filter((i) => i.severity !== "info" || i.category === "milestone-unconfirmed"), exploratory: snap.planKind === "SCENARIO" };
}

const submissionInput = z.object({
  projectId: z.string(),
  snapshotId: z.string(),
  reportIds: z.array(z.string()).min(1),
  issueDate: z.string().refine(isISODate, "Choose an issue date"),
  recipientLabel: z.string().trim().min(1, "Recipient is required").max(200),
  reference: z.string().trim().max(200).nullable().default(null),
  acknowledgedIssueIds: z.array(z.string()).default([]),
});

/**
 * Record a formal submission of already-generated files. Validation failures
 * block; planning issues must each be acknowledged and are stored with the
 * submission. The app does not send anything to the recipient.
 */
export async function recordSubmission(viewer: Viewer, raw: z.input<typeof submissionInput>) {
  const input = submissionInput.parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const snap = await prisma.planSnapshot.findFirst({ where: { id: input.snapshotId, projectId: input.projectId } });
  if (!snap) throw notFound("Snapshot");
  if (snap.planKind === "SCENARIO") throw badRequest("Exports of an exploratory scenario cannot be recorded as a formal submission. Promote the scenario to the working plan first.");
  const reports = await prisma.generatedReport.findMany({ where: { id: { in: input.reportIds }, projectId: input.projectId } });
  if (reports.length !== input.reportIds.length) throw notFound("Report");
  if (reports.some((r) => r.snapshotId !== input.snapshotId)) throw badRequest("All files in a submission must come from the same snapshot.");
  if (reports.some((r) => r.status !== "READY")) throw badRequest("Wait until every file has finished generating.");
  if (reports.some((r) => r.submissionId)) throw badRequest("A file is already part of a recorded submission.");
  const data = snapshotFromRow(snap).plan;
  const blocking = validatePlan(data);
  if (blocking.length) throw badRequest(`The snapshot has data validation failures that block a submission: ${blocking[0].message}`);
  const required = computePlanningIssues(data).filter((i) => i.severity !== "info" || i.category === "milestone-unconfirmed");
  const missing = required.filter((i) => !input.acknowledgedIssueIds.includes(i.id));
  if (missing.length) throw badRequest(`Acknowledge every open planning item before recording the submission (${missing.length} not acknowledged).`, { missing: missing.map((m) => m.id) });
  return prisma.$transaction(async (tx) => {
    const last = await tx.submission.findFirst({ where: { projectId: input.projectId }, orderBy: { sequence: "desc" } });
    const sequence = (last?.sequence ?? 0) + 1;
    const s = await tx.submission.create({
      data: {
        projectId: input.projectId,
        snapshotId: input.snapshotId,
        sequence,
        title: `${reports[0].title} — Submission ${sequence}`,
        issueDate: dateToDb(input.issueDate),
        recipientLabel: input.recipientLabel,
        reference: input.reference,
        acknowledgedIssues: required.map((i) => ({ id: i.id, severity: i.severity, category: i.category, message: i.message, acknowledgedAt: new Date().toISOString(), acknowledgedBy: viewer.name })) as unknown as Prisma.InputJsonValue,
        recordedById: viewer.userId,
        recordedByName: viewer.name,
      },
    });
    await tx.generatedReport.updateMany({ where: { id: { in: input.reportIds } }, data: { submissionId: s.id } });
    await audit(tx, viewer, { projectId: input.projectId, action: "submission.record", entityType: "Submission", entityId: s.id, summary: `Recorded ${s.title} to ${input.recipientLabel} (issue date ${input.issueDate})`, after: { ...input, acknowledged: required.length } });
    return { id: s.id, sequence };
  });
}
