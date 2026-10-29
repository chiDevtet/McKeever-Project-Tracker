import { z } from "zod";
import { comparePlans } from "@/domain/compare";
import type { PlanData } from "@/domain/plan";
import { audit } from "@/server/audit";
import { assertPlanAccess, assertProjectAccess, type Viewer } from "@/server/authz";
import { prisma, type Tx } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import { loadPlanData, mutatePlan, persistPlanDiff } from "@/server/plan-store";
import { createSnapshot, snapshotFromRow } from "@/server/snapshots";

const name = z.string().trim().min(1, "Name is required").max(200);

/** Plans, snapshots, revisions, and audit history for a project. */
export async function getHistory(viewer: Viewer, projectId: string) {
  await assertProjectAccess(viewer, projectId, "read");
  const [plans, snapshots, audits] = await Promise.all([
    prisma.plan.findMany({ where: { projectId }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }),
    prisma.planSnapshot.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, name: true, description: true, planId: true, planKind: true, planName: true, planRevision: true, dataHash: true, createdById: true, createdAt: true, submissions: { select: { id: true, sequence: true, recipientLabel: true, issueDate: true } } } }),
    prisma.auditEvent.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  const working = plans.find((p) => p.kind === "WORKING");
  const revisions = working ? await prisma.planRevision.findMany({ where: { planId: working.id }, orderBy: { revision: "desc" }, take: 200 }) : [];
  const userIds = [...new Set([...snapshots.map((s) => s.createdById), ...revisions.map((r) => r.actorId), ...plans.map((p) => p.createdById)].filter((x): x is string => Boolean(x)))];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    plans: plans.map((p) => ({ id: p.id, kind: p.kind, status: p.status, name: p.name, description: p.description, revision: p.revision, basedOnPlanId: p.basedOnPlanId, basedOnRevision: p.basedOnRevision, basedOnSnapshotId: p.basedOnSnapshotId, createdBy: p.createdById ? (users.get(p.createdById) ?? null) : null, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() })),
    snapshots: snapshots.map((s) => ({ id: s.id, kind: s.kind, name: s.name, description: s.description, planId: s.planId, planKind: s.planKind, planName: s.planName, planRevision: s.planRevision, dataHash: s.dataHash, createdBy: s.createdById ? (users.get(s.createdById) ?? null) : null, createdAt: s.createdAt.toISOString(), submissions: s.submissions.map((x) => ({ id: x.id, sequence: x.sequence, recipient: x.recipientLabel, issueDate: x.issueDate.toISOString().slice(0, 10) })) })),
    revisions: revisions.map((r) => ({ revision: r.revision, kind: r.kind, summary: r.summary, actor: r.actorId ? (users.get(r.actorId) ?? "Unknown user") : "system", createdAt: r.createdAt.toISOString() })),
    audit: audits.map((a) => ({ id: a.id, action: a.action, entityType: a.entityType, summary: a.summary, actor: a.actorName ?? "system", createdAt: a.createdAt.toISOString() })),
  };
}

export async function createBaseline(viewer: Viewer, raw: { planId: string; name: string; description?: string | null }) {
  const input = z.object({ planId: z.string(), name, description: z.string().max(2000).nullable().optional() }).parse(raw);
  const { plan } = await assertPlanAccess(viewer, input.planId, "edit");
  return prisma.$transaction(async (tx) => {
    const snap = await createSnapshot(tx, { planId: plan.id, kind: "BASELINE", name: input.name, description: input.description ?? null, createdById: viewer.userId });
    await audit(tx, viewer, { projectId: plan.projectId, planId: plan.id, action: "baseline.create", entityType: "PlanSnapshot", entityId: snap.id, summary: `Baseline “${input.name}” captured from ${plan.name} revision ${snap.planRevision}` });
    return { id: snap.id, revision: snap.planRevision };
  });
}

/** Copy plan-scoped records into an empty plan (keys are kept so the plans stay comparable). */
async function copyPlanContent(tx: Tx, targetPlanId: string, source: PlanData) {
  const target = await loadPlanData(tx, targetPlanId);
  await persistPlanDiff(tx, targetPlanId, target.project.id, target, withContent(target, source));
}

/**
 * The target plan with schedule, staffing, allocations, leadership, and
 * calendars taken from `source`. Project records (phases, areas, systems,
 * milestones) and actual progress stay as they are now; references to
 * project records that no longer exist are cleared rather than restored.
 */
export function withContent(target: PlanData, source: PlanData): PlanData {
  const phases = new Set(target.phases.map((p) => p.id));
  const areas = new Set(target.areas.map((a) => a.id));
  const systems = new Set(target.systems.map((s) => s.id));
  const milestones = new Set(target.milestones.map((m) => m.id));
  const ref = <T extends string | null>(id: T, set: Set<string>) => (id && set.has(id) ? id : null);
  const clone = structuredClone(source);
  return {
    ...target,
    calendars: clone.calendars,
    phaseWindows: clone.phaseWindows.filter((w) => phases.has(w.phaseId)),
    activities: clone.activities.map((a) => ({ ...a, phaseId: ref(a.phaseId, phases), areaId: ref(a.areaId, areas), systemId: ref(a.systemId, systems) })),
    links: clone.links,
    activityMilestones: clone.activityMilestones.filter((m) => milestones.has(m.milestoneId)),
    nodes: clone.nodes.map((n) => ({ ...n, phaseId: ref(n.phaseId, phases), areaId: ref(n.areaId, areas), systemId: ref(n.systemId, systems) })),
    entries: clone.entries,
    leadership: clone.leadership.map((l) => ({ ...l, responsibilitySystemIds: l.responsibilitySystemIds.filter((id) => systems.has(id)), responsibilityPhaseIds: l.responsibilityPhaseIds.filter((id) => phases.has(id)) })),
  };
}

/** Create an editable scenario from the working plan (or another plan) or from a snapshot. */
export async function createScenario(viewer: Viewer, raw: { projectId: string; name: string; description?: string | null; fromPlanId?: string | null; fromSnapshotId?: string | null }) {
  const input = z.object({ projectId: z.string(), name, description: z.string().max(2000).nullable().optional(), fromPlanId: z.string().nullable().optional(), fromSnapshotId: z.string().nullable().optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  return prisma.$transaction(
    async (tx) => {
      let source: PlanData;
      let basedOn: { basedOnPlanId: string | null; basedOnRevision: number | null; basedOnSnapshotId: string | null };
      if (input.fromSnapshotId) {
        const snap = await tx.planSnapshot.findFirst({ where: { id: input.fromSnapshotId, projectId: input.projectId } });
        if (!snap) throw notFound("Snapshot");
        source = snapshotFromRow(snap).plan;
        basedOn = { basedOnPlanId: snap.planId, basedOnRevision: snap.planRevision, basedOnSnapshotId: snap.id };
      } else {
        const from = input.fromPlanId ? await tx.plan.findFirst({ where: { id: input.fromPlanId, projectId: input.projectId } }) : await tx.plan.findFirst({ where: { projectId: input.projectId, kind: "WORKING" } });
        if (!from) throw notFound("Plan");
        source = await loadPlanData(tx, from.id);
        basedOn = { basedOnPlanId: from.id, basedOnRevision: from.revision, basedOnSnapshotId: null };
      }
      const plan = await tx.plan.create({ data: { projectId: input.projectId, kind: "SCENARIO", status: "ACTIVE", name: input.name, description: input.description ?? null, createdById: viewer.userId, ...basedOn } });
      await copyPlanContent(tx, plan.id, source);
      await tx.planRevision.create({ data: { planId: plan.id, revision: 1, kind: "CREATE", summary: `Scenario created from ${input.fromSnapshotId ? "snapshot" : source.plan.name} revision ${basedOn.basedOnRevision}`, actorId: viewer.userId } });
      await audit(tx, viewer, { projectId: input.projectId, planId: plan.id, action: "scenario.create", entityType: "Plan", entityId: plan.id, summary: `Scenario “${input.name}” created from ${source.plan.name} revision ${basedOn.basedOnRevision}` });
      return { id: plan.id };
    },
    { timeout: 60_000 },
  );
}

async function comparisonSource(viewer: Viewer, projectId: string, ref: { planId?: string | null; snapshotId?: string | null }): Promise<{ label: string; data: PlanData }> {
  if (ref.snapshotId) {
    const snap = await prisma.planSnapshot.findFirst({ where: { id: ref.snapshotId, projectId } });
    if (!snap) throw notFound("Snapshot");
    return { label: `${snap.name} (${snap.planName} r${snap.planRevision})`, data: snapshotFromRow(snap).plan };
  }
  const plan = await prisma.plan.findFirst({ where: { id: ref.planId ?? "", projectId } });
  if (!plan) throw notFound("Plan");
  return { label: `${plan.name} r${plan.revision}`, data: await loadPlanData(prisma, plan.id) };
}

/** Compare a scenario or snapshot (other) against a base (the working plan unless given). */
export async function comparePlan(viewer: Viewer, raw: { projectId: string; other: { planId?: string | null; snapshotId?: string | null }; base?: { planId?: string | null; snapshotId?: string | null } | null }) {
  await assertProjectAccess(viewer, raw.projectId, "read");
  const working = await prisma.plan.findFirst({ where: { projectId: raw.projectId, kind: "WORKING" } });
  const base = await comparisonSource(viewer, raw.projectId, raw.base ?? { planId: working?.id });
  const other = await comparisonSource(viewer, raw.projectId, raw.other);
  return { baseLabel: base.label, otherLabel: other.label, comparison: comparePlans(base.data, other.data) };
}

/**
 * Promote a scenario: the working plan takes the scenario's schedule,
 * staffing, and calendars as a new revision. The prior working state is kept
 * as a revision-backup snapshot; baselines, submissions, and actual progress
 * are untouched. The scenario becomes read-only (promoted).
 */
export async function promoteScenario(viewer: Viewer, raw: { scenarioId: string; expectedScenarioRevision: number; expectedWorkingRevision: number }) {
  const input = z.object({ scenarioId: z.string(), expectedScenarioRevision: z.number().int(), expectedWorkingRevision: z.number().int() }).parse(raw);
  const { plan: scenario } = await assertPlanAccess(viewer, input.scenarioId, "edit");
  if (scenario.kind !== "SCENARIO" || scenario.status !== "ACTIVE") throw badRequest("Only an active scenario can be promoted.");
  const working = await prisma.plan.findFirst({ where: { projectId: scenario.projectId, kind: "WORKING" } });
  if (!working) throw notFound("Working plan");
  const source = await loadPlanData(prisma, scenario.id);
  if (source.plan.revision !== input.expectedScenarioRevision) throw conflict("The scenario changed since you previewed the promotion. Review the comparison again.");
  return mutatePlan(viewer, working.id, input.expectedWorkingRevision, (before) => withContent(before, source), {
    kind: "PROMOTE",
    summary: `Promoted scenario “${scenario.name}” revision ${scenario.revision}`,
    alsoWrite: async (tx, _after, before) => {
      const n = await tx.plan.updateMany({ where: { id: scenario.id, revision: input.expectedScenarioRevision, status: "ACTIVE" }, data: { status: "PROMOTED" } });
      if (n.count === 0) throw conflict("The scenario changed since you previewed the promotion. Review the comparison again.");
      await createSnapshot(tx, { planId: working.id, kind: "REVISION_BACKUP", name: `Before promoting “${scenario.name}”`, description: `Working plan revision ${before.plan.revision} before promotion`, createdById: viewer.userId, plan: before });
      await audit(tx, viewer, { projectId: scenario.projectId, planId: scenario.id, action: "scenario.promote", entityType: "Plan", entityId: scenario.id, summary: `Scenario “${scenario.name}” promoted to working revision ${input.expectedWorkingRevision + 1}` });
    },
  });
}

/** Restore a snapshot into the working plan as a new revision (actual progress is retained). */
export async function restoreSnapshot(viewer: Viewer, raw: { snapshotId: string; expectedWorkingRevision: number }) {
  const input = z.object({ snapshotId: z.string(), expectedWorkingRevision: z.number().int() }).parse(raw);
  const snap = await prisma.planSnapshot.findUnique({ where: { id: input.snapshotId } });
  if (!snap) throw notFound("Snapshot");
  await assertProjectAccess(viewer, snap.projectId, "edit");
  const working = await prisma.plan.findFirst({ where: { projectId: snap.projectId, kind: "WORKING" } });
  if (!working) throw notFound("Working plan");
  const source = snapshotFromRow(snap).plan;
  return mutatePlan(viewer, working.id, input.expectedWorkingRevision, (before) => withContent(before, source), {
    kind: "RESTORE",
    summary: `Restored “${snap.name}” (${snap.planName} revision ${snap.planRevision})`,
    alsoWrite: async (tx, _after, before) => {
      await createSnapshot(tx, { planId: working.id, kind: "REVISION_BACKUP", name: `Before restoring “${snap.name}”`, description: `Working plan revision ${before.plan.revision} before restore`, createdById: viewer.userId, plan: before });
    },
  });
}

export async function archiveScenario(viewer: Viewer, raw: { planId: string }) {
  const { plan } = await assertPlanAccess(viewer, raw.planId, "edit");
  if (plan.kind !== "SCENARIO") throw badRequest("Only scenarios can be archived.");
  await prisma.$transaction(async (tx) => {
    await tx.plan.update({ where: { id: plan.id }, data: { status: "ARCHIVED" } });
    await audit(tx, viewer, { projectId: plan.projectId, planId: plan.id, action: "scenario.archive", entityType: "Plan", entityId: plan.id, summary: `Archived scenario “${plan.name}”` });
  });
  return { ok: true };
}
