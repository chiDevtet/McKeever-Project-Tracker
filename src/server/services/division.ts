import { z } from "zod";
import { addDays, dateFromDb, dateToDb, isISODate, startOfWeek, type ISODate } from "@/domain/dates";
import { computeDivision } from "@/domain/division";
import { planDateRange } from "@/domain/metrics";
import { todayInTimeZone } from "@/domain/tz";
import { audit } from "@/server/audit";
import { accessibleProjectFilter, requireAdmin, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { loadPlanData } from "@/server/plan-store";
import { summarizePlan } from "@/server/services/summaries";

export interface DivisionQuery {
  from?: string;
  to?: string;
  projectIds?: string[];
  role?: string;
}

/** Live division forecast from working plans only (scenarios are excluded until promoted). */
export async function divisionForecast(viewer: Viewer, q: DivisionQuery) {
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: viewer.workspaceId } });
  const projects = await prisma.project.findMany({
    where: { ...accessibleProjectFilter(viewer), status: { not: "ARCHIVED" } },
    include: { plans: { where: { kind: "WORKING" }, select: { id: true } } },
    orderBy: { code: "asc" },
  });
  const selected = q.projectIds?.length ? projects.filter((p) => q.projectIds!.includes(p.id)) : projects;
  const plans = await Promise.all(selected.filter((p) => p.plans[0]).map((p) => loadPlanData(prisma, p.plans[0].id)));
  const today = todayInTimeZone(ws.divisionTimezone);
  let from: ISODate | null = q.from && isISODate(q.from) ? startOfWeek(q.from) : null;
  let to: ISODate | null = q.to && isISODate(q.to) ? startOfWeek(q.to) : null;
  if (!from || !to) {
    const ranges = plans.map(planDateRange).filter(Boolean) as { start: ISODate; end: ISODate }[];
    from ??= ranges.length ? startOfWeek(ranges.map((r) => r.start).sort()[0]) : startOfWeek(today);
    to ??= ranges.length ? startOfWeek(ranges.map((r) => r.end).sort().at(-1)!) : addDays(startOfWeek(today), 7 * 25);
  }
  if (to < from) to = from;
  const limits = await prisma.availabilityLimit.findMany({ where: { workspaceId: viewer.workspaceId }, orderBy: { startDate: "asc" } });
  const roleFilter = q.role && q.role !== "all" && q.role !== "leadership" ? [q.role] : undefined;
  const forecast = computeDivision(plans, from, to, {
    timezone: ws.divisionTimezone,
    roles: q.role === "leadership" ? [] : roleFilter,
    includeLeadership: !roleFilter,
    availability: limits.map((l) => ({ role: l.role, startDate: dateFromDb(l.startDate)!, endDate: dateFromDb(l.endDate)!, maxHeadcount: l.maxHeadcount })),
  });
  return {
    from,
    to,
    forecast,
    projects: projects.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status })),
    summaries: plans.map((d) => ({ projectId: d.project.id, code: d.project.code, name: d.project.name, status: d.project.status, revision: d.plan.revision, summary: summarizePlan(d, today) })),
    roles: ws.installerRoles,
    limits: limits.map((l) => ({ id: l.id, role: l.role, startDate: dateFromDb(l.startDate)!, endDate: dateFromDb(l.endDate)!, maxHeadcount: l.maxHeadcount, note: l.note })),
  };
}

const limitInput = z.object({ role: z.string().trim().min(1).max(80), startDate: z.string().refine(isISODate), endDate: z.string().refine(isISODate), maxHeadcount: z.number().int().min(0).max(100_000), note: z.string().max(500).nullable().default(null) }).refine((v) => v.endDate >= v.startDate, "End date is before start date");

export async function addAvailabilityLimit(viewer: Viewer, raw: z.input<typeof limitInput>) {
  requireAdmin(viewer);
  const input = limitInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const l = await tx.availabilityLimit.create({ data: { workspaceId: viewer.workspaceId, role: input.role, startDate: dateToDb(input.startDate), endDate: dateToDb(input.endDate), maxHeadcount: input.maxHeadcount, note: input.note } });
    await audit(tx, viewer, { action: "availability.add", entityType: "AvailabilityLimit", entityId: l.id, summary: `Availability ${input.role} ≤ ${input.maxHeadcount} ${input.startDate}–${input.endDate}`, after: input });
    return { id: l.id };
  });
}

export async function removeAvailabilityLimit(viewer: Viewer, raw: { id: string }) {
  requireAdmin(viewer);
  const l = await prisma.availabilityLimit.findFirst({ where: { id: raw.id, workspaceId: viewer.workspaceId } });
  if (!l) throw notFound("Availability limit");
  await prisma.$transaction(async (tx) => {
    await tx.availabilityLimit.delete({ where: { id: l.id } });
    await audit(tx, viewer, { action: "availability.remove", entityType: "AvailabilityLimit", entityId: l.id, summary: `Removed availability limit ${l.role}` });
  });
  return { ok: true };
}
