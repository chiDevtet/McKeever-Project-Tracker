import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dateFromDb, dateToDb, isISODate } from "@/domain/dates";
import { planOpsSchema } from "@/domain/ops";
import { compareSourceRows, type ComparableRow } from "@/domain/source-diff";
import type { ImportFormat, Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { assertPlanAccess, assertProjectAccess, type Viewer } from "@/server/authz";
import { prisma, type Tx } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";
import { columnMappingSchema, readSheet, type ExtractedSchedule } from "@/server/imports/extraction";
import { enqueueJob, QUEUES } from "@/server/jobs/queue";
import { sha256, storeFile } from "@/server/services/files";
import { mutatePlan } from "@/server/plan-store";
import { storage } from "@/server/storage/storage";

/** Reviewed values of one source row (original values are kept separately). */
export const reviewedSchema = z.object({
  externalId: z.string().trim().max(80).nullable(),
  name: z.string().trim().max(1000),
  start: z.string().refine(isISODate).nullable(),
  finish: z.string().refine(isISODate).nullable(),
  originalDuration: z.number().nullable(),
  remainingDuration: z.number().nullable(),
  /** scope: our installation work; prerequisite: external work we depend on; reference: context only. */
  role: z.enum(["scope", "prerequisite", "reference"]),
  note: z.string().max(1000).nullable(),
  /** Resolution of an uncertain match (possible renumbering): treat as new, or same activity as a prior ID. */
  sameAs: z.string().max(80).nullable(),
});
export type Reviewed = z.infer<typeof reviewedSchema>;

const num = (s: string | null | undefined) => (s && /^-?\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : null);

function reviewedFromOriginal(r: ExtractedSchedule["rows"][number]): Reviewed {
  return { externalId: r.externalId, name: r.name, start: r.start?.date ?? null, finish: r.finish?.date ?? null, originalDuration: num(r.od), remainingDuration: num(r.rd), role: "reference", note: null, sameAs: null };
}

function detectFormat(filename: string, contentType: string): ImportFormat | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (contentType === "application/pdf" || ext === "pdf") return "PDF";
  if (ext === "csv" || contentType === "text/csv") return "CSV";
  if (ext === "xlsx" || contentType.includes("spreadsheetml")) return "XLSX";
  return null;
}

// Upload ---------------------------------------------------------------------

export async function createImport(viewer: Viewer, input: { projectId: string; lineageId: string | null; newLineageName: string | null; label: string; sourceDate: string | null; filename: string; contentType: string; bytes: Uint8Array }) {
  await assertProjectAccess(viewer, input.projectId, "edit");
  const format = detectFormat(input.filename, input.contentType);
  if (!format) throw badRequest("Upload a text-based PDF schedule, a CSV file, or an Excel .xlsx workbook.");
  if (format === "PDF" && new TextDecoder().decode(input.bytes.slice(0, 5)) !== "%PDF-") throw badRequest("The file is not a valid PDF.");
  if (input.bytes.byteLength > 60 * 1024 * 1024) throw badRequest("Schedule files are limited to 60 MB.");
  if (input.sourceDate && !isISODate(input.sourceDate)) throw badRequest("Invalid source date");
  const hash = sha256(input.bytes);
  const session = await prisma.$transaction(async (tx) => {
    let lineageId = input.lineageId;
    if (!lineageId) {
      const name = (input.newLineageName ?? "").trim();
      if (!name) throw badRequest("Choose a source schedule lineage or name a new one.");
      const l = await tx.sourceLineage.upsert({ where: { projectId_name: { projectId: input.projectId, name } }, update: {}, create: { projectId: input.projectId, name, kind: format === "PDF" ? "PDF_SCHEDULE" : "SPREADSHEET" } });
      lineageId = l.id;
    } else if (!(await tx.sourceLineage.findFirst({ where: { id: lineageId, projectId: input.projectId } }))) throw notFound("Source lineage");
    const identical = await tx.sourceVersion.findFirst({ where: { lineageId, sha256: hash }, orderBy: { versionNumber: "desc" } });
    const latest = await tx.sourceVersion.findFirst({ where: { lineageId }, orderBy: { versionNumber: "desc" } });
    const file = await storeFile(tx, { workspaceId: viewer.workspaceId, projectId: input.projectId, kind: "SOURCE_SCHEDULE", filename: input.filename, contentType: format === "PDF" ? "application/pdf" : format === "CSV" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: input.bytes, immutable: true, createdById: viewer.userId });
    const s = await tx.importSession.create({
      data: { projectId: input.projectId, lineageId, fileId: file.id, format, status: "UPLOADED", fileSha256: hash, label: input.label.trim() || input.filename, sourceDate: dateToDb(input.sourceDate), compareToVersionId: latest?.id ?? null, identicalToVersionId: identical?.id ?? null, createdById: viewer.userId, extractionMeta: { timeline: [{ status: "UPLOADED", at: new Date().toISOString() }] } },
    });
    await audit(tx, viewer, { projectId: input.projectId, action: "import.upload", entityType: "ImportSession", entityId: s.id, summary: `Uploaded ${input.filename} for import${identical ? ` (identical to version ${identical.versionNumber})` : ""}` });
    return s;
  });
  if (format === "PDF") await startExtraction(viewer, session.id);
  return { id: session.id, format, identicalToVersionId: session.identicalToVersionId };
}

async function loadSession(viewer: Viewer, sessionId: string, access: "read" | "edit") {
  const s = await prisma.importSession.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound("Import");
  await assertProjectAccess(viewer, s.projectId, access);
  return s;
}

async function startExtraction(viewer: Viewer, sessionId: string) {
  const s = await prisma.importSession.update({ where: { id: sessionId }, data: { status: "EXTRACTING", revision: { increment: 1 } } });
  const job = await enqueueJob({ workspaceId: viewer.workspaceId, projectId: s.projectId, kind: QUEUES.importExtract, payload: { sessionId }, idempotencyKey: `extract:${sessionId}:${s.revision}`, createdById: viewer.userId });
  await prisma.importSession.update({ where: { id: sessionId }, data: { jobId: job.id } });
  return job;
}

/** Headers and first rows of a spreadsheet, for column mapping. */
export async function sheetPreview(viewer: Viewer, raw: { sessionId: string; sheet?: string | null }) {
  const s = await loadSession(viewer, raw.sessionId, "read");
  if (s.format === "PDF") throw badRequest("Column mapping applies to CSV and Excel imports.");
  const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: s.fileId } });
  const { sheets, rows } = await readSheet(await storage().get(file.storageKey), s.format, raw.sheet ?? null);
  return { sheets, rows: rows.slice(0, 25).map((r) => r.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? "" : String(v)))) };
}

export async function setMappingAndExtract(viewer: Viewer, raw: { sessionId: string; mapping: z.input<typeof columnMappingSchema> }) {
  const s = await loadSession(viewer, raw.sessionId, "edit");
  if (!["UPLOADED", "NEEDS_REVIEW", "FAILED", "EXTRACTED"].includes(s.status)) throw badRequest("This import can no longer be re-mapped.");
  const mapping = columnMappingSchema.parse(raw.mapping);
  await prisma.importSession.update({ where: { id: s.id }, data: { columnMapping: mapping as unknown as Prisma.InputJsonValue } });
  await startExtraction(viewer, s.id);
  return { ok: true };
}

export async function retryExtraction(viewer: Viewer, raw: { sessionId: string }) {
  const s = await loadSession(viewer, raw.sessionId, "edit");
  if (!["FAILED", "NEEDS_REVIEW", "EXTRACTED"].includes(s.status)) throw badRequest("Only failed or unreviewed imports can be re-extracted.");
  if (s.format !== "PDF" && !s.columnMapping) throw badRequest("Map the spreadsheet columns first.");
  await startExtraction(viewer, s.id);
  return { ok: true };
}

// Worker: extraction --------------------------------------------------------------

async function priorRecords(db: Tx, versionId: string | null): Promise<(ComparableRow & { id: string })[]> {
  if (!versionId) return [];
  const recs = await db.sourceRecord.findMany({ where: { versionId, changeKind: { not: "REMOVED" } } });
  return recs.map((r) => ({ id: r.id, externalId: r.externalId, name: r.name, start: dateFromDb(r.start), finish: dateFromDb(r.finish), originalDuration: r.originalDuration === null ? null : Number(r.originalDuration) }));
}

/**
 * Store extraction results for a session (idempotent: replaces rows of the
 * same session) and compare against the prior version. Called by the worker.
 */
export type PreviewResult = { pages: number; scale: number } | { error: string } | null;

export async function storeExtraction(sessionId: string, ex: ExtractedSchedule, previews: PreviewResult = null) {
  const s = await prisma.importSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (s.status === "COMMITTED" || s.status === "CANCELED") return { skipped: true };
  const rows = ex.rows;
  const prior = await priorRecords(prisma, s.compareToVersionId);
  const comparable = rows.filter((r) => r.kind !== "WBS");
  const { matches, removed } = compareSourceRows(
    comparable.map((r) => ({ externalId: r.externalId, name: r.name, start: r.start?.date ?? null, finish: r.finish?.date ?? null, originalDuration: num(r.od) })),
    prior,
  );
  const matchOf = new Map(comparable.map((r, i) => [r, matches[i]]));
  const priorRowIssues = new Map<string, string[]>();
  for (const i of ex.issues) if (i.externalId) priorRowIssues.set(i.externalId, [...(priorRowIssues.get(i.externalId) ?? []), i.message]);
  const empty = ex.issues.some((i) => i.kind === "empty") || comparable.length === 0;
  // Rows that were reviewed in the prior version start with its inclusion, role, and mapping.
  const priorReviewed = new Map(
    (s.compareToVersionId ? await prisma.sourceRecord.findMany({ where: { versionId: s.compareToVersionId, changeKind: { not: "REMOVED" } } }) : []).map((p) => [p.externalId, p]),
  );
  const scanned = ex.pages.length > 0 && ex.pages.every((p) => p.chars === 0);
  await prisma.$transaction(
    async (tx) => {
      await tx.importRow.deleteMany({ where: { sessionId } });
      const data: Prisma.ImportRowCreateManyInput[] = rows.map((r, i) => {
        const m = matchOf.get(r);
        // Carry the prior review by ID. A duplicate ID carries to every copy and a possible
        // renumbering carries from its candidate, so a reviewed row that became ambiguous
        // stays included and validation requires the operator to resolve it.
        const carried = (r.externalId ? priorReviewed.get(r.externalId) : undefined) ?? (m?.status === "UNCERTAIN" ? (m.candidates ?? []).map((c) => priorReviewed.get(c)).find((p) => p?.included) : undefined);
        const reviewed = reviewedFromOriginal(r);
        if (carried) reviewed.role = (carried.reviewed as unknown as Partial<Reviewed>).role ?? reviewed.role;
        return {
          sessionId,
          rowIndex: i,
          pageNumber: r.page,
          kind: r.kind,
          externalId: r.externalId,
          wbsPath: r.wbsPath,
          original: r as unknown as Prisma.InputJsonValue,
          reviewed: reviewed as unknown as Prisma.InputJsonValue,
          include: carried?.included ?? false,
          phaseId: carried?.phaseId ?? null,
          areaId: carried?.areaId ?? null,
          systemId: carried?.systemId ?? null,
          issues: (r.externalId ? (priorRowIssues.get(r.externalId) ?? []) : []) as unknown as Prisma.InputJsonValue,
          matchStatus: r.kind === "WBS" ? "WBS" : (m?.status ?? "ADDED"),
          matchDetail: (m ? { changes: m.changes, categories: m.categories, prior: m.prior, candidates: m.candidates, priorRecordId: carried?.id ?? null } : {}) as unknown as Prisma.InputJsonValue,
        };
      });
      for (let i = 0; i < data.length; i += 1000) await tx.importRow.createMany({ data: data.slice(i, i + 1000) });
      const issues = [
        ...ex.issues.map((i) => ({ severity: i.kind === "empty" || i.kind === "no-text" ? "error" : "warning", ...i })),
        ...(scanned ? [{ severity: "error", page: null, kind: "scanned", message: "No page contains extractable text; this looks like a scanned PDF. OCR is not supported. Upload a CSV or Excel export of the schedule, or enter activities manually on the Schedule tab." }] : []),
        ...(previews && "error" in previews ? [{ severity: "warning", page: null, kind: "preview", message: `Page previews could not be rendered (${previews.error}); the review grid still works and the original PDF can be opened directly.` }] : []),
      ];
      const meta = s.extractionMeta as { timeline?: unknown[] };
      await tx.importSession.update({
        where: { id: sessionId },
        data: {
          status: empty ? "FAILED" : "NEEDS_REVIEW",
          issues: issues as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          extractionMeta: {
            ...meta,
            timeline: [...(meta.timeline ?? []), { status: "EXTRACTED", at: new Date().toISOString(), rows: rows.length }, { status: empty ? "FAILED" : "NEEDS_REVIEW", at: new Date().toISOString() }],
            pageCount: ex.pageCount,
            pages: ex.pages.map((p) => ({ number: p.number, width: p.width, height: p.height, rows: p.rows, chars: p.chars, headerFound: p.headerFound })),
            previews: previews && "pages" in previews ? previews : null,
            title: ex.meta.title ?? null,
            runDate: ex.meta.runDate ?? null,
            dataDate: ex.meta.dataDate ?? null,
            removedFromPrior: removed.map((r) => ({ externalId: r.externalId, name: r.name, start: r.start, finish: r.finish })),
            counts: summarize(matches.map((m) => m.status), removed.length),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: 120_000 },
  );
  return { rows: rows.length, issues: ex.issues.length, empty };
}

function summarize(statuses: string[], removed: number) {
  const c: Record<string, number> = { removed };
  for (const s of statuses) c[s] = (c[s] ?? 0) + 1;
  return c;
}

export const previewKey = (fileId: string, page: number) => `previews/${fileId}/page-${page}.png`;

/** Read one rendered page preview after checking project access. */
export async function readPreviewPage(viewer: Viewer, raw: { sessionId: string; page: number }) {
  const s = await loadSession(viewer, raw.sessionId, "read");
  const previews = (s.extractionMeta as { previews?: { pages: number } | null }).previews;
  if (!previews || !Number.isInteger(raw.page) || raw.page < 1 || raw.page > previews.pages) throw notFound("Page preview");
  return storage().get(previewKey(s.fileId, raw.page));
}

export async function markExtractionFailed(sessionId: string, message: string) {
  const s = await prisma.importSession.findUnique({ where: { id: sessionId } });
  if (!s || s.status === "COMMITTED" || s.status === "CANCELED") return;
  const meta = s.extractionMeta as { timeline?: unknown[] };
  await prisma.importSession.update({
    where: { id: sessionId },
    data: { status: "FAILED", revision: { increment: 1 }, issues: [{ severity: "error", page: null, kind: "failure", message: `Extraction failed: ${message}. Current activities and staffing are unchanged. You can retry, or import a CSV/Excel export, or enter activities manually.` }] as unknown as Prisma.InputJsonValue, extractionMeta: { ...meta, timeline: [...(meta.timeline ?? []), { status: "FAILED", at: new Date().toISOString() }] } as unknown as Prisma.InputJsonValue },
  });
}

// Review ---------------------------------------------------------------------

export async function getImport(viewer: Viewer, raw: { sessionId: string }) {
  const s = await loadSession(viewer, raw.sessionId, "read");
  const [rows, lineage, job, compareTo, identical] = await Promise.all([
    prisma.importRow.findMany({ where: { sessionId: s.id }, orderBy: { rowIndex: "asc" } }),
    prisma.sourceLineage.findUniqueOrThrow({ where: { id: s.lineageId } }),
    s.jobId ? prisma.backgroundJob.findUnique({ where: { id: s.jobId } }) : null,
    s.compareToVersionId ? prisma.sourceVersion.findUnique({ where: { id: s.compareToVersionId } }) : null,
    s.identicalToVersionId ? prisma.sourceVersion.findUnique({ where: { id: s.identicalToVersionId } }) : null,
  ]);
  return {
    session: { id: s.id, projectId: s.projectId, status: s.status, format: s.format, label: s.label, fileId: s.fileId, sourceDate: dateFromDb(s.sourceDate), revision: s.revision, issues: s.issues as { severity: string; page: number | null; kind: string; message: string }[], meta: s.extractionMeta as Record<string, unknown>, columnMapping: s.columnMapping, createdAt: s.createdAt.toISOString() },
    lineage: { id: lineage.id, name: lineage.name },
    compareTo: compareTo ? { id: compareTo.id, versionNumber: compareTo.versionNumber, label: compareTo.label } : null,
    identicalTo: identical ? { id: identical.id, versionNumber: identical.versionNumber, label: identical.label } : null,
    job: job ? { status: job.status, progress: job.progress, message: job.message, error: job.error, attempts: job.attempts } : null,
    rows: rows.map((r) => ({ id: r.id, rowIndex: r.rowIndex, page: r.pageNumber, kind: r.kind, externalId: r.externalId, wbsPath: r.wbsPath, original: r.original as unknown as ExtractedSchedule["rows"][number], reviewed: r.reviewed as unknown as Reviewed, include: r.include, phaseId: r.phaseId, areaId: r.areaId, systemId: r.systemId, issues: r.issues as string[], matchStatus: r.matchStatus, matchDetail: r.matchDetail as Record<string, unknown> })),
  };
}

const rowChange = z.object({
  rowId: z.string(),
  include: z.boolean().optional(),
  reviewed: reviewedSchema.partial().optional(),
  phaseId: z.string().nullable().optional(),
  areaId: z.string().nullable().optional(),
  systemId: z.string().nullable().optional(),
});

/** Save review edits (include, corrections, mappings) with a session revision check. */
export async function updateRows(viewer: Viewer, raw: { sessionId: string; expectedRevision: number; changes: z.input<typeof rowChange>[] }) {
  const input = z.object({ sessionId: z.string(), expectedRevision: z.number().int(), changes: z.array(rowChange).min(1).max(5000) }).parse(raw);
  const s = await loadSession(viewer, input.sessionId, "edit");
  if (!["NEEDS_REVIEW", "VALIDATED", "EXTRACTED"].includes(s.status)) throw badRequest(`This import is ${s.status.toLowerCase()} and cannot be edited.`);
  const [phases, areas, systems] = await Promise.all([prisma.phase.findMany({ where: { projectId: s.projectId }, select: { id: true } }), prisma.area.findMany({ where: { projectId: s.projectId }, select: { id: true } }), prisma.system.findMany({ where: { projectId: s.projectId }, select: { id: true } })]);
  const ok = (list: { id: string }[], id: string | null | undefined) => id === undefined || id === null || list.some((x) => x.id === id);
  return prisma.$transaction(async (tx) => {
    const n = await tx.importSession.updateMany({ where: { id: s.id, revision: input.expectedRevision }, data: { revision: { increment: 1 }, status: "NEEDS_REVIEW" } });
    if (n.count === 0) throw badRequest("This import was changed in another window. Reload to see the latest review state.", { stale: true });
    const rows = await tx.importRow.findMany({ where: { sessionId: s.id, id: { in: input.changes.map((c) => c.rowId) } } });
    for (const c of input.changes) {
      const row = rows.find((r) => r.id === c.rowId);
      if (!row) throw notFound("Import row");
      if (!ok(phases, c.phaseId) || !ok(areas, c.areaId) || !ok(systems, c.systemId)) throw badRequest("A mapping refers to a phase, area, or system outside this project");
      const reviewed = c.reviewed ? reviewedSchema.parse({ ...(row.reviewed as object), ...c.reviewed }) : undefined;
      await tx.importRow.update({ where: { id: row.id }, data: { include: c.include, reviewed: reviewed as unknown as Prisma.InputJsonValue | undefined, externalId: reviewed ? reviewed.externalId : undefined, phaseId: c.phaseId, areaId: c.areaId, systemId: c.systemId } });
    }
    return { revision: input.expectedRevision + 1 };
  });
}

interface ValidationProblem {
  rowId: string | null;
  message: string;
}

async function validationProblems(db: Tx, sessionId: string): Promise<ValidationProblem[]> {
  const rows = await db.importRow.findMany({ where: { sessionId, include: true } });
  const out: ValidationProblem[] = [];
  const ids = new Map<string, number>();
  for (const r of rows) {
    const v = r.reviewed as unknown as Reviewed;
    if (r.kind === "WBS") out.push({ rowId: r.id, message: `WBS summary "${v.name}" cannot be included as an activity` });
    if (!v.externalId) out.push({ rowId: r.id, message: `Row ${r.rowIndex + 1} "${v.name.slice(0, 60)}" needs an external activity ID before it can be committed` });
    else ids.set(v.externalId, (ids.get(v.externalId) ?? 0) + 1);
    if (v.start && v.finish && v.finish < v.start) out.push({ rowId: r.id, message: `${v.externalId}: finish ${v.finish} is before start ${v.start}` });
    if (!v.start && !v.finish) out.push({ rowId: r.id, message: `${v.externalId ?? "Row"}: needs a start or finish date` });
    if (r.matchStatus === "UNCERTAIN" && v.sameAs === null && !(r.matchDetail as { resolvedNew?: boolean }).resolvedNew) {
      out.push({ rowId: r.id, message: `${v.externalId}: may be a renumbered activity (${((r.matchDetail as { candidates?: string[] }).candidates ?? []).join(", ")}). Choose "treat as new" or "same activity as".` });
    }
  }
  for (const [id, n] of ids) if (n > 1) out.push({ rowId: null, message: `External ID ${id} appears ${n} times among included rows. Exclude or correct duplicates.` });
  return out;
}

export async function resolveUncertain(viewer: Viewer, raw: { sessionId: string; rowId: string; expectedRevision: number; sameAs: string | null }) {
  const s = await loadSession(viewer, raw.sessionId, "edit");
  const row = await prisma.importRow.findFirst({ where: { id: raw.rowId, sessionId: s.id } });
  if (!row || row.matchStatus !== "UNCERTAIN") throw notFound("Uncertain row");
  const detail = row.matchDetail as { candidates?: string[] };
  if (raw.sameAs && !(detail.candidates ?? []).includes(raw.sameAs)) throw badRequest("Choose one of the listed prior IDs");
  return prisma.$transaction(async (tx) => {
    const n = await tx.importSession.updateMany({ where: { id: s.id, revision: raw.expectedRevision }, data: { revision: { increment: 1 }, status: "NEEDS_REVIEW" } });
    if (n.count === 0) throw badRequest("This import was changed in another window. Reload first.", { stale: true });
    await tx.importRow.update({ where: { id: row.id }, data: { reviewed: { ...(row.reviewed as object), sameAs: raw.sameAs } as Prisma.InputJsonValue, matchDetail: { ...(row.matchDetail as object), resolvedNew: raw.sameAs === null } as Prisma.InputJsonValue } });
    return { revision: raw.expectedRevision + 1 };
  });
}

export async function validateImport(viewer: Viewer, raw: { sessionId: string; expectedRevision: number }) {
  const s = await loadSession(viewer, raw.sessionId, "edit");
  if (!["NEEDS_REVIEW", "VALIDATED", "EXTRACTED"].includes(s.status)) throw badRequest(`This import is ${s.status.toLowerCase()}.`);
  if (s.identicalToVersionId) throw badRequest("This file is identical to an already committed version; there is nothing new to commit. Cancel this import.");
  const problems = await validationProblems(prisma, s.id);
  const included = await prisma.importRow.count({ where: { sessionId: s.id, include: true } });
  if (!included) problems.push({ rowId: null, message: "Include at least one row (scope, prerequisite, or reference) before validating." });
  const n = await prisma.importSession.updateMany({ where: { id: s.id, revision: raw.expectedRevision }, data: { status: problems.length ? "NEEDS_REVIEW" : "VALIDATED", revision: { increment: 1 } } });
  if (n.count === 0) throw badRequest("This import was changed in another window. Reload first.", { stale: true });
  return { valid: problems.length === 0, problems, revision: raw.expectedRevision + 1 };
}

/**
 * Commit a validated import as a new source version. Atomic and idempotent:
 * the version is unique per import session, so a retried commit returns the
 * existing version. The working plan is not modified here.
 */
export async function commitImport(viewer: Viewer, raw: { sessionId: string; expectedRevision: number }) {
  const s = await loadSession(viewer, raw.sessionId, "edit");
  const existing = await prisma.sourceVersion.findUnique({ where: { importSessionId: s.id } });
  if (existing) return { versionId: existing.id, versionNumber: existing.versionNumber, alreadyCommitted: true };
  if (s.status !== "VALIDATED") throw badRequest("Validate the import before committing.");
  return prisma.$transaction(
    async (tx) => {
      const n = await tx.importSession.updateMany({ where: { id: s.id, revision: raw.expectedRevision, status: "VALIDATED" }, data: { status: "COMMITTED", revision: { increment: 1 } } });
      if (n.count === 0) throw badRequest("This import changed since it was validated. Reload and validate again.", { stale: true });
      const problems = await validationProblems(tx, s.id);
      if (problems.length) throw badRequest(problems[0].message);
      const last = await tx.sourceVersion.findFirst({ where: { lineageId: s.lineageId }, orderBy: { versionNumber: "desc" } });
      const meta = s.extractionMeta as { dataDate?: string | null; removedFromPrior?: { externalId: string; name: string; start: string | null; finish: string | null }[]; counts?: Record<string, number>; pageCount?: number; title?: string | null; runDate?: string | null };
      const version = await tx.sourceVersion.create({
        data: { lineageId: s.lineageId, projectId: s.projectId, versionNumber: (last?.versionNumber ?? 0) + 1, label: s.label, sourceDate: s.sourceDate, dataDate: meta.dataDate && isISODate(meta.dataDate) ? dateToDb(meta.dataDate) : null, fileId: s.fileId, sha256: s.fileSha256, importSessionId: s.id, comparedToId: s.compareToVersionId, committedById: viewer.userId, summary: { counts: meta.counts ?? {}, pageCount: meta.pageCount ?? null, title: meta.title ?? null, runDate: meta.runDate ?? null } },
      });
      const allRows = await tx.importRow.findMany({ where: { sessionId: s.id, kind: { not: "WBS" } }, orderBy: { rowIndex: "asc" } });
      const rows = allRows.filter((r) => r.include);
      // Rows not selected during review are kept too (first occurrence per ID), so the
      // next version compares against the whole source rather than only the reviewed scope.
      const includedIds = new Set(rows.map((r) => (r.reviewed as unknown as Reviewed).externalId));
      const others: typeof allRows = [];
      for (const r of allRows) {
        const id = (r.reviewed as unknown as Reviewed).externalId;
        if (r.include || !id || includedIds.has(id)) continue;
        includedIds.add(id);
        others.push(r);
      }
      const records: Prisma.SourceRecordCreateManyInput[] = [...rows, ...others].map((r) => {
        const v = r.reviewed as unknown as Reviewed;
        const o = r.original as unknown as ExtractedSchedule["rows"][number];
        const d = r.matchDetail as { changes?: unknown[] };
        return {
          versionId: version.id,
          externalId: v.externalId!,
          kind: r.kind,
          name: v.name,
          wbsPath: r.wbsPath,
          pageNumber: r.pageNumber,
          start: dateToDb(v.start),
          finish: dateToDb(v.finish),
          originalDuration: v.originalDuration,
          remainingDuration: v.remainingDuration,
          startActual: o.start?.actual ?? false,
          finishActual: o.finish?.actual ?? false,
          startConstrained: o.start?.constraint ?? false,
          finishConstrained: o.finish?.constraint ?? false,
          original: o as unknown as Prisma.InputJsonValue,
          reviewed: v as unknown as Prisma.InputJsonValue,
          inScope: r.include && v.role === "scope",
          included: r.include,
          phaseId: r.phaseId,
          areaId: r.areaId,
          systemId: r.systemId,
          changeKind: r.matchStatus === "UNCERTAIN" ? (v.sameAs ? "CHANGED" : "ADDED") : ["UNCHANGED", "CHANGED", "RENAMED", "ADDED"].includes(r.matchStatus) ? r.matchStatus : "ADDED",
          changes: (d.changes ?? []) as Prisma.InputJsonValue,
        };
      });
      // Prior records missing from this version are kept as REMOVED; linked work is never deleted.
      const kept = new Set(records.map((r) => r.externalId));
      if (s.compareToVersionId) {
        const prior = await tx.sourceRecord.findMany({ where: { versionId: s.compareToVersionId, changeKind: { not: "REMOVED" } } });
        for (const p of prior) {
          if (kept.has(p.externalId)) continue;
          const renamedTo = rows.find((r) => (r.reviewed as unknown as Reviewed).sameAs === p.externalId);
          records.push({ versionId: version.id, externalId: p.externalId, kind: p.kind, name: p.name, wbsPath: p.wbsPath, pageNumber: p.pageNumber, start: p.start, finish: p.finish, originalDuration: p.originalDuration, remainingDuration: p.remainingDuration, original: p.original as Prisma.InputJsonValue, reviewed: p.reviewed as Prisma.InputJsonValue, inScope: p.inScope, included: p.included, phaseId: p.phaseId, areaId: p.areaId, systemId: p.systemId, changeKind: "REMOVED", changes: (renamedTo ? [{ field: "externalId", before: p.externalId, after: (renamedTo.reviewed as unknown as Reviewed).externalId }] : []) as Prisma.InputJsonValue });
          if (renamedTo) {
            // Same activity under a new ID: carry existing source links to the new ID.
            const links = await tx.activitySourceLink.findMany({ where: { projectId: s.projectId, lineageId: s.lineageId, externalId: p.externalId } });
            for (const l of links) await tx.activitySourceLink.upsert({ where: { activityKey_lineageId_externalId: { activityKey: l.activityKey, lineageId: s.lineageId, externalId: (renamedTo.reviewed as unknown as Reviewed).externalId! } }, update: {}, create: { projectId: s.projectId, activityKey: l.activityKey, lineageId: s.lineageId, externalId: (renamedTo.reviewed as unknown as Reviewed).externalId!, createdById: viewer.userId } });
          }
        }
      }
      for (let i = 0; i < records.length; i += 1000) await tx.sourceRecord.createMany({ data: records.slice(i, i + 1000) });
      await audit(tx, viewer, { projectId: s.projectId, action: "import.commit", entityType: "SourceVersion", entityId: version.id, summary: `Committed source version ${version.versionNumber} “${s.label}” with ${rows.length} reviewed rows (${others.length} further source rows kept for comparison)`, after: { counts: meta.counts ?? {}, removed: meta.removedFromPrior?.length ?? 0 } });
      return { versionId: version.id, versionNumber: version.versionNumber, alreadyCommitted: false };
    },
    { timeout: 120_000 },
  );
}

export async function cancelImport(viewer: Viewer, raw: { sessionId: string }) {
  const s = await loadSession(viewer, raw.sessionId, "edit");
  if (s.status === "COMMITTED") throw badRequest("A committed import cannot be canceled; its source version is history.");
  await prisma.$transaction(async (tx) => {
    await tx.importSession.update({ where: { id: s.id }, data: { status: "CANCELED", revision: { increment: 1 } } });
    await audit(tx, viewer, { projectId: s.projectId, action: "import.cancel", entityType: "ImportSession", entityId: s.id, summary: `Canceled import “${s.label}”; no plan records changed` });
  });
  return { ok: true };
}

// Lists and versions -------------------------------------------------------

export async function listImports(viewer: Viewer, raw: { projectId: string }) {
  await assertProjectAccess(viewer, raw.projectId, "read");
  const [sessions, lineages] = await Promise.all([
    prisma.importSession.findMany({ where: { projectId: raw.projectId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.sourceLineage.findMany({ where: { projectId: raw.projectId }, include: { versions: { orderBy: { versionNumber: "desc" } } }, orderBy: { name: "asc" } }),
  ]);
  return {
    sessions: sessions.map((s) => ({ id: s.id, label: s.label, status: s.status, format: s.format, lineageId: s.lineageId, createdAt: s.createdAt.toISOString(), identical: Boolean(s.identicalToVersionId), counts: ((s.extractionMeta as { counts?: Record<string, number> }).counts ?? {}) as Record<string, number> })),
    lineages: lineages.map((l) => ({ id: l.id, name: l.name, kind: l.kind, versions: l.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, label: v.label, sourceDate: dateFromDb(v.sourceDate), dataDate: dateFromDb(v.dataDate), committedAt: v.committedAt.toISOString(), fileId: v.fileId, summary: v.summary as Record<string, unknown> })) })),
  };
}

export async function versionRecords(viewer: Viewer, raw: { versionId: string; onlyChanged?: boolean; search?: string }) {
  const v = await prisma.sourceVersion.findUnique({ where: { id: raw.versionId }, include: { lineage: true } });
  if (!v) throw notFound("Source version");
  await assertProjectAccess(viewer, v.projectId, "read");
  const records = await prisma.sourceRecord.findMany({ where: { versionId: v.id, ...(raw.onlyChanged ? { changeKind: { not: "UNCHANGED" } } : {}), ...(raw.search ? { OR: [{ externalId: { contains: raw.search, mode: "insensitive" } }, { name: { contains: raw.search, mode: "insensitive" } }] } : {}) }, orderBy: [{ pageNumber: "asc" }, { externalId: "asc" }], take: 3000 });
  const links = await prisma.activitySourceLink.findMany({ where: { projectId: v.projectId, lineageId: v.lineageId, externalId: { in: records.map((r) => r.externalId) } } });
  return {
    version: { id: v.id, versionNumber: v.versionNumber, label: v.label, lineageId: v.lineageId, lineageName: v.lineage.name, sourceDate: dateFromDb(v.sourceDate), dataDate: dateFromDb(v.dataDate), comparedToId: v.comparedToId },
    records: records.map((r) => ({ id: r.id, externalId: r.externalId, kind: r.kind, name: r.name, page: r.pageNumber, start: dateFromDb(r.start), finish: dateFromDb(r.finish), originalDuration: r.originalDuration === null ? null : Number(r.originalDuration), startActual: r.startActual, finishActual: r.finishActual, startConstrained: r.startConstrained, finishConstrained: r.finishConstrained, inScope: r.inScope, included: r.included, role: (r.reviewed as unknown as Reviewed).role, changeKind: r.changeKind, changes: r.changes as { field: string; before: unknown; after: unknown }[], phaseId: r.phaseId, areaId: r.areaId, systemId: r.systemId, wbsPath: r.wbsPath, linkedActivityKeys: links.filter((l) => l.externalId === r.externalId).map((l) => l.activityKey) })),
  };
}

export type SourceRecordView = Awaited<ReturnType<typeof versionRecords>>["records"][number];

export async function linkSource(viewer: Viewer, raw: { projectId: string; activityKey: string; lineageId: string; externalId: string; remove?: boolean }) {
  const input = z.object({ projectId: z.string(), activityKey: z.string(), lineageId: z.string(), externalId: z.string().min(1).max(80), remove: z.boolean().optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const lineage = await prisma.sourceLineage.findFirst({ where: { id: input.lineageId, projectId: input.projectId } });
  if (!lineage) throw notFound("Source lineage");
  const act = await prisma.activity.findFirst({ where: { projectId: input.projectId, key: input.activityKey } });
  if (!act) throw notFound("Activity");
  await prisma.$transaction(async (tx) => {
    if (input.remove) await tx.activitySourceLink.deleteMany({ where: { activityKey: input.activityKey, lineageId: input.lineageId, externalId: input.externalId } });
    else await tx.activitySourceLink.upsert({ where: { activityKey_lineageId_externalId: { activityKey: input.activityKey, lineageId: input.lineageId, externalId: input.externalId } }, update: {}, create: { projectId: input.projectId, activityKey: input.activityKey, lineageId: input.lineageId, externalId: input.externalId, createdById: viewer.userId } });
    await audit(tx, viewer, { projectId: input.projectId, action: input.remove ? "source.unlink" : "source.link", entityType: "ActivitySourceLink", entityId: input.activityKey, summary: `${input.remove ? "Unlinked" : "Linked"} ${act.code} ${input.remove ? "from" : "to"} ${lineage.name} ${input.externalId}` });
  });
  return { ok: true };
}


// Applying a reviewed source version to a plan --------------------------------

const opsInput = z.array(z.unknown()).max(2000);

/**
 * Apply the operator-selected changes from a committed source version to a
 * plan in one transaction (plan ops plus an audit record of the version and
 * selections). Crew sizes, actuals, notes, and mappings are untouched because
 * the ops only change the selected dates and staffing shifts.
 */
export async function applySourceChanges(viewer: Viewer, raw: { planId: string; expectedRevision: number; versionId: string; ops: unknown[]; selected: string[] }) {
  const input = z.object({ planId: z.string(), expectedRevision: z.number().int(), versionId: z.string(), ops: opsInput, selected: z.array(z.string()).max(5000) }).parse(raw);
  const ops = planOpsSchema.parse(input.ops);
  const { plan } = await assertPlanAccess(viewer, input.planId, "edit");
  const version = await prisma.sourceVersion.findFirst({ where: { id: input.versionId, projectId: plan.projectId }, include: { lineage: true } });
  if (!version) throw notFound("Source version");
  const result = await mutatePlan(viewer, input.planId, input.expectedRevision, ops, {
    kind: "SOURCE_APPLY",
    summary: `Applied ${input.selected.length} reviewed change(s) from ${version.lineage.name} v${version.versionNumber} “${version.label}”`,
    alsoWrite: async (tx, after, before) => {
      await audit(tx, viewer, {
        projectId: plan.projectId,
        planId: input.planId,
        action: "source.apply",
        entityType: "SourceVersion",
        entityId: version.id,
        summary: `Applied source changes: ${input.selected.map((sel) => { const [externalId, key] = sel.split("|"); return `${externalId} → ${before.activities.find((a) => a.key === key)?.code ?? "activity"}`; }).join(", ")}`,
        before: before.activities.filter((a) => ops.some((o) => "key" in o && o.key === a.key)).map((a) => ({ key: a.key, code: a.code, start: a.plannedStart, finish: a.plannedFinish })),
        after: { activities: after.activities.filter((a) => ops.some((o) => "key" in o && o.key === a.key)).map((a) => ({ key: a.key, code: a.code, start: a.plannedStart, finish: a.plannedFinish })), selected: input.selected, version: version.versionNumber, opCount: ops.length },
      });
    },
  });
  return { revision: result.revision, data: result.data };
}

const newActivity = z.object({ name: z.string().trim().min(1).max(300), systemId: z.string().nullable(), phaseId: z.string().nullable(), areaId: z.string().nullable(), start: z.string().refine(isISODate), finish: z.string().refine(isISODate) });

/**
 * Create installation activities from source rows. One source row may support
 * several activities (for example a combined Fire Alarm / VESDA row); each gets
 * a source link and no staffing, so no capacity is duplicated.
 */
export async function createActivitiesFromSource(viewer: Viewer, raw: { planId: string; expectedRevision: number; versionId: string; items: { externalId: string; activities: z.input<typeof newActivity>[] }[] }) {
  const input = z.object({ planId: z.string(), expectedRevision: z.number().int(), versionId: z.string(), items: z.array(z.object({ externalId: z.string(), activities: z.array(newActivity).min(1).max(10) })).min(1).max(500) }).parse(raw);
  const { plan } = await assertPlanAccess(viewer, input.planId, "edit");
  const version = await prisma.sourceVersion.findFirst({ where: { id: input.versionId, projectId: plan.projectId }, include: { lineage: true } });
  if (!version) throw notFound("Source version");
  const records = await prisma.sourceRecord.findMany({ where: { versionId: version.id, externalId: { in: input.items.map((i) => i.externalId) } } });
  const links: { activityKey: string; externalId: string }[] = [];
  const ops = input.items.flatMap((item) => {
    const rec = records.find((r) => r.externalId === item.externalId);
    if (!rec || rec.changeKind === "REMOVED") throw badRequest(`Source row ${item.externalId} is not available in this version`);
    return item.activities.map((a) => {
      const key = randomUUID();
      links.push({ activityKey: key, externalId: item.externalId });
      return { type: "addActivity" as const, activity: { key, code: "", name: a.name, phaseId: a.phaseId, areaId: a.areaId, systemId: a.systemId, calendarKey: null, plannedStart: a.start, plannedFinish: a.finish, notes: `From ${version.lineage.name} ${item.externalId}`, sortOrder: 0, archived: false } };
    });
  });
  const result = await mutatePlan(viewer, input.planId, input.expectedRevision, ops, {
    kind: "SOURCE_CREATE",
    summary: `Created ${ops.length} installation activit${ops.length === 1 ? "y" : "ies"} from ${version.lineage.name} v${version.versionNumber}`,
    alsoWrite: async (tx) => {
      for (const l of links) await tx.activitySourceLink.create({ data: { projectId: plan.projectId, activityKey: l.activityKey, lineageId: version.lineageId, externalId: l.externalId, createdById: viewer.userId } });
    },
  });
  return { revision: result.revision, created: ops.length };
}
