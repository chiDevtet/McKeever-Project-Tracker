import { z } from "zod";
import { dateFromDb, dateToDb, isISODate } from "@/domain/dates";
import { normalizeProgress, validateProgress, type ProgressDraft } from "@/domain/progress";
import { todayInTimeZone } from "@/domain/tz";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { assertProjectAccess, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { badRequest, conflict, notFound, ValidationFailed } from "@/server/errors";
import { loadPlanData } from "@/server/plan-store";
import { snapshotFromRow } from "@/server/snapshots";

const isoDate = z.string().refine(isISODate, "Enter a valid date");

export const progressUpdateInput = z.object({
  projectId: z.string(),
  activityKey: z.string(),
  /** Version of the progress record the editor started from; 0 when there was none. */
  expectedVersion: z.number().int().min(0),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETE", "ON_HOLD"]),
  actualStart: isoDate.nullable(),
  actualFinish: isoDate.nullable(),
  percentComplete: z.number().min(0).max(100).nullable(),
  holdReason: z.string().max(1000).nullable(),
  holdReviewDate: isoDate.nullable(),
  note: z.string().max(4000).nullable(),
  reopenReason: z.string().max(1000).nullable().optional(),
});

/**
 * Record a manual progress update. Progress is project-scoped (shared by the
 * working plan and scenarios) and never changes staffing, reservations, or
 * milestones. Every update keeps an event with who recorded it and when.
 */
export async function updateProgress(viewer: Viewer, raw: z.input<typeof progressUpdateInput>) {
  const input = progressUpdateInput.parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const project = await prisma.project.findUniqueOrThrow({ where: { id: input.projectId } });
  const activity = await prisma.activity.findFirst({ where: { projectId: input.projectId, key: input.activityKey, archivedAt: null, plan: { kind: "WORKING" } } });
  if (!activity) throw notFound("Activity");
  return prisma.$transaction(async (tx) => {
    const prev = await tx.activityProgress.findUnique({ where: { projectId_activityKey: { projectId: input.projectId, activityKey: input.activityKey } } });
    if ((prev?.version ?? 0) !== input.expectedVersion) throw staleProgress(prev?.version ?? 0);
    const draft: ProgressDraft = { status: input.status, actualStart: input.actualStart, actualFinish: input.actualFinish, percentComplete: input.percentComplete, holdReason: input.holdReason, holdReviewDate: input.holdReviewDate, reopenReason: input.reopenReason ?? null };
    const problems = validateProgress(prev ? { status: prev.status } : null, draft, todayInTimeZone(project.timezone));
    if (problems.length) throw new ValidationFailed(problems.map((p) => ({ code: `progress.${p.field}`, message: p.message, refs: [{ kind: "activity" as const, key: input.activityKey }] })));
    const next = normalizeProgress(input.activityKey, draft);
    const before = prev ? { status: prev.status, actualStart: dateFromDb(prev.actualStart), actualFinish: dateFromDb(prev.actualFinish), percentComplete: prev.percentComplete === null ? null : Number(prev.percentComplete), holdReason: prev.holdReason, holdReviewDate: dateFromDb(prev.holdReviewDate) } : null;
    const after = { status: next.status, actualStart: next.actualStart, actualFinish: next.actualFinish, percentComplete: next.percentComplete, holdReason: next.holdReason, holdReviewDate: next.holdReviewDate };
    const unchanged = before && JSON.stringify(before) === JSON.stringify(after);
    if (unchanged && !input.note?.trim()) throw badRequest("Nothing changed. Add a progress note or change the status or dates.");
    const data = { status: next.status, actualStart: dateToDb(next.actualStart), actualFinish: dateToDb(next.actualFinish), percentComplete: next.percentComplete, holdReason: next.holdReason, holdReviewDate: dateToDb(next.holdReviewDate), updatedById: viewer.userId };
    // Conditional write: a concurrent update of the same record fails instead of overwriting it.
    if (prev) {
      const n = await tx.activityProgress.updateMany({ where: { id: prev.id, version: input.expectedVersion }, data: { ...data, version: { increment: 1 } } });
      if (n.count === 0) throw staleProgress(input.expectedVersion);
    } else await tx.activityProgress.create({ data: { projectId: input.projectId, activityKey: input.activityKey, ...data } });
    const saved = { version: input.expectedVersion + 1 };
    const reopened = prev?.status === "COMPLETE" && next.status !== "COMPLETE";
    const kind = reopened ? "REOPEN" : unchanged ? "NOTE" : prev?.status !== next.status ? "STATUS" : "UPDATE";
    const note = [reopened ? `Reopened: ${input.reopenReason!.trim()}` : null, input.note?.trim() || null].filter(Boolean).join("\n") || null;
    await tx.progressEvent.create({ data: { projectId: input.projectId, activityKey: input.activityKey, kind, before: (before ?? undefined) as Prisma.InputJsonValue | undefined, after: after as Prisma.InputJsonValue, note, actorId: viewer.userId } });
    await audit(tx, viewer, {
      projectId: input.projectId,
      action: reopened ? "progress.reopen" : "progress.update",
      entityType: "Activity",
      entityId: activity.id,
      summary: `${activity.code} ${reopened ? "reopened" : "progress"}: ${before?.status ?? "NOT_STARTED"} → ${next.status}${next.percentComplete !== null ? ` (${next.percentComplete}%)` : ""}`,
      before,
      after: { ...after, note },
    });
    return { version: saved.version, progress: next };
  }).catch((err: unknown) => {
    // Two first updates at once: the unique record makes the second one stale.
    if ((err as { code?: string }).code === "P2002") throw staleProgress(1);
    throw err;
  });
}

const staleProgress = (currentVersion: number) => conflict("This activity's progress was updated by someone else since you opened it. Reload to see the latest update; your entry is kept so you can re-apply it.", { currentVersion });

/** Working-plan activities with progress, recent history, and latest-baseline dates. */
export async function getProgressView(viewer: Viewer, projectId: string) {
  await assertProjectAccess(viewer, projectId, "read");
  const working = await prisma.plan.findFirst({ where: { projectId, kind: "WORKING" } });
  if (!working) throw notFound("Working plan");
  const [data, records, events, baseline] = await Promise.all([
    loadPlanData(prisma, working.id),
    prisma.activityProgress.findMany({ where: { projectId } }),
    prisma.progressEvent.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.planSnapshot.findFirst({ where: { projectId, kind: "BASELINE" }, orderBy: { createdAt: "desc" } }),
  ]);
  const actorIds = [...new Set([...events.map((e) => e.actorId), ...records.map((r) => r.updatedById)].filter((x): x is string => Boolean(x)))];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const baselineActs = baseline ? new Map(snapshotFromRow(baseline).plan.activities.map((a) => [a.key, a])) : null;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
  return {
    data,
    today: todayInTimeZone(project.timezone),
    baseline: baseline ? { id: baseline.id, name: baseline.name, createdAt: baseline.createdAt.toISOString() } : null,
    rows: data.activities
      .filter((a) => !a.archived)
      .map((a) => {
        const r = records.find((x) => x.activityKey === a.key);
        const b = baselineActs?.get(a.key);
        return {
          key: a.key,
          version: r?.version ?? 0,
          updatedBy: r?.updatedById ? (actors.get(r.updatedById) ?? null) : null,
          updatedAt: r?.updatedAt.toISOString() ?? null,
          baseline: b ? { start: b.plannedStart, finish: b.plannedFinish } : null,
          reservations: data.nodes.filter((n) => n.activityKey === a.key).map((n) => ({ key: n.key, name: n.name })),
        };
      }),
    events: events.map((e) => ({ id: e.id, activityKey: e.activityKey, kind: e.kind, before: e.before as Record<string, unknown> | null, after: e.after as Record<string, unknown> | null, note: e.note, actor: e.actorId ? (actors.get(e.actorId) ?? "Unknown user") : "system", createdAt: e.createdAt.toISOString() })),
  };
}
