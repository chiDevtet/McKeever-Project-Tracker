import { z } from "zod";
import { formatDate } from "@/domain/dates";
import { planOpsSchema, type PlanOp } from "@/domain/ops";
import type { PlanData } from "@/domain/plan";
import { assertPlanAccess, assertProjectAccess, canEdit, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { notFound } from "@/server/errors";
import { loadPlanData, mutatePlan } from "@/server/plan-store";

export interface PlanListItem {
  id: string;
  kind: "WORKING" | "SCENARIO";
  name: string;
  status: string;
  revision: number;
  basedOnRevision: number | null;
  updatedAt: string;
}

export interface PlanView {
  data: PlanData;
  plans: PlanListItem[];
  canEdit: boolean;
  people: { id: string; displayName: string; title: string | null }[];
}

/** Load a plan (default: the working plan) with access checks. */
export async function getPlanView(viewer: Viewer, projectId: string, planId?: string | null): Promise<PlanView> {
  await assertProjectAccess(viewer, projectId, "read");
  const plans = await prisma.plan.findMany({ where: { projectId, status: { not: "ARCHIVED" } }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] });
  const target = planId ? plans.find((p) => p.id === planId) : plans.find((p) => p.kind === "WORKING");
  if (!target) throw notFound("Plan");
  const [data, people] = await Promise.all([
    loadPlanData(prisma, target.id),
    prisma.person.findMany({ where: { workspaceId: viewer.workspaceId, archivedAt: null }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, title: true } }),
  ]);
  return {
    data,
    plans: plans.map((p) => ({ id: p.id, kind: p.kind, name: p.name, status: p.status, revision: p.revision, basedOnRevision: p.basedOnRevision, updatedAt: p.updatedAt.toISOString() })),
    canEdit: canEdit(viewer, projectId) && target.status === "ACTIVE",
    people,
  };
}

export const applyPlanOpsInput = z.object({
  planId: z.string().min(1),
  expectedRevision: z.number().int().min(1),
  ops: planOpsSchema,
  summary: z.string().max(500).optional(),
});

export async function applyPlanOps(viewer: Viewer, raw: z.input<typeof applyPlanOpsInput>) {
  const input = applyPlanOpsInput.parse(raw);
  const { plan } = await assertPlanAccess(viewer, input.planId, "edit");
  if (plan.status !== "ACTIVE") throw notFound("Editable plan");
  const result = await mutatePlan(viewer, input.planId, input.expectedRevision, input.ops, { summary: input.summary ?? describeOps(input.ops) });
  return { revision: result.revision, data: result.data };
}

/** Short human-readable summary of a list of ops for revision history. */
export function describeOps(ops: PlanOp[]): string {
  const parts = ops.slice(0, 6).map((op) => {
    switch (op.type) {
      case "setWeeks":
        return op.values.length === 1
          ? `Week of ${formatDate(op.values[0].week)} set to ${op.values[0].headcount ?? "blank"}`
          : `${op.values.length} weekly values set (${formatDate(op.values[0].week)}–${formatDate(op.values[op.values.length - 1].week)})`;
      case "setDay":
        return `Day ${formatDate(op.date)} set to ${op.headcount ?? "weekly default"}`;
      case "setBlocks":
        return `${op.blocks.length} time block(s) on ${formatDate(op.date)}`;
      case "clearOverrides":
        return `Cleared day overrides ${formatDate(op.from)}–${formatDate(op.to)}`;
      case "increaseWorkforce":
        return `Increased workforce in ${op.values.length} week(s)`;
      case "addNode":
        return `Added ${op.node.kind === "CREW" ? "crew" : "reservation"} "${op.node.name}"`;
      case "updateNode":
        return "Updated staffing row";
      case "removeNode":
        return "Removed staffing row";
      case "releaseNode":
        return `Returned reservation to shared work from ${formatDate(op.from)}`;
      case "splitCrew":
        return `Split ${op.headcount} into crew "${op.name}"`;
      case "shiftNodeEntries":
        return `Moved staffing ${op.amount} ${op.mode === "weeks" ? "week(s)" : "working day(s)"}`;
      case "addActivity":
        return `Added activity "${op.activity.name}"`;
      case "updateActivity":
        return "Updated activity";
      case "setActivityDates":
        return `Activity dates ${formatDate(op.start)}–${formatDate(op.finish)}`;
      case "addLink":
        return "Added dependency";
      case "updateLink":
        return "Changed dependency lag";
      case "removeLink":
        return "Removed dependency";
      case "linkMilestone":
        return "Linked milestone";
      case "unlinkMilestone":
        return "Unlinked milestone";
      case "setCalendar":
        return `Calendar "${op.calendar.name}" updated`;
      case "removeCalendar":
        return "Removed calendar";
      case "upsertLeadership":
        return `Leadership ${op.assignment.personName} (${op.assignment.role})`;
      case "removeLeadership":
        return "Removed leadership assignment";
      case "shiftLeadership":
        return `Moved leadership assignment ${op.days} day(s)`;
      case "setPhaseWindow":
        return "Phase window updated";
    }
  });
  return parts.join("; ") + (ops.length > 6 ? `; and ${ops.length - 6} more change(s)` : "");
}

export async function listRevisions(viewer: Viewer, planId: string) {
  await assertPlanAccess(viewer, planId, "read");
  const rows = await prisma.planRevision.findMany({ where: { planId }, orderBy: { revision: "desc" }, take: 200 });
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const names = new Map(actors.map((a) => [a.id, a.name]));
  return rows.map((r) => ({ revision: r.revision, kind: r.kind, summary: r.summary, actor: r.actorId ? (names.get(r.actorId) ?? "Unknown") : "system", createdAt: r.createdAt.toISOString(), snapshotId: r.snapshotId }));
}
