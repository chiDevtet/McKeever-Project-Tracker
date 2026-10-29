import { parseCalendarDefinition } from "@/domain/calendar";
import { dateFromDb, dateToDb, type ISODate } from "@/domain/dates";
import { applyOps, PlanOpError, validatePlan, type PlanOp } from "@/domain/ops";
import { entryId, entrySlot, PLAN_DATA_SCHEMA_VERSION, type ActivityInput, type DayOverride, type EntryInput, type LeadershipInput, type NodeInput, type PlanData, type SourceWindow } from "@/domain/plan";
import { Prisma } from "@/generated/prisma/client";
import type { Viewer } from "@/server/authz";
import { audit } from "@/server/audit";
import { prisma, type Tx } from "@/server/db";
import { AppError, badRequest, notFound, StaleRevisionError, ValidationFailed } from "@/server/errors";

const num = (d: Prisma.Decimal | null | undefined): number | null => (d === null || d === undefined ? null : Number(d));
const iso = (d: Date | null | undefined): ISODate | null => dateFromDb(d);
const isoReq = (d: Date): ISODate => dateFromDb(d)!;

/** Build the engine's PlanData for a plan from the database. */
export async function loadPlanData(db: Tx, planId: string): Promise<PlanData> {
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound("Plan");
  const project = await db.project.findUniqueOrThrow({
    where: { id: plan.projectId },
    include: { workspace: true, parties: { include: { organization: true } } },
  });
  const [calendars, phases, windows, areas, systems, milestones, activities, links, nodes, entries, leadership, progress] = await Promise.all([
    db.calendar.findMany({ where: { planId }, orderBy: { key: "asc" } }),
    db.phase.findMany({ where: { projectId: project.id }, include: { areas: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.phaseWindow.findMany({ where: { planId } }),
    db.area.findMany({ where: { projectId: project.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.system.findMany({ where: { projectId: project.id, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.milestone.findMany({ where: { projectId: project.id }, include: { values: { orderBy: [{ sourceDate: "desc" }, { createdAt: "desc" }] } }, orderBy: [{ sortOrder: "asc" }] }),
    db.activity.findMany({ where: { planId }, include: { milestones: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    db.activityLink.findMany({ where: { planId } }),
    db.allocationNode.findMany({ where: { planId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.staffingEntry.findMany({ where: { planId }, orderBy: [{ date: "asc" }, { slot: "asc" }] }),
    db.leadershipAssignment.findMany({ where: { planId }, include: { person: true }, orderBy: [{ sortOrder: "asc" }] }),
    db.activityProgress.findMany({ where: { projectId: project.id } }),
  ]);

  const activityKeyById = new Map(activities.map((a) => [a.id, a.key]));
  const nodeKeyById = new Map(nodes.map((n) => [n.id, n.key]));
  const party = (role: string) => project.parties.find((p) => p.role === role)?.organization.name ?? null;
  const activityKeys = new Set(activities.map((a) => a.key));

  return {
    schemaVersion: PLAN_DATA_SCHEMA_VERSION,
    project: {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      timezone: project.timezone,
      workspaceName: project.workspace.name,
      customer: party("CUSTOMER"),
      generalContractor: party("GENERAL_CONTRACTOR"),
      owner: party("OWNER"),
    },
    plan: { id: plan.id, kind: plan.kind, name: plan.name, revision: plan.revision, basedOnRevision: plan.basedOnRevision },
    calendars: calendars.map((c) => ({ key: c.key, name: c.name, timezone: c.timezone, isDefault: c.isDefault, definition: parseCalendarDefinition(c.definition) })),
    phases: phases.map((p) => ({ id: p.id, key: p.key, name: p.name, sortOrder: p.sortOrder, areaIds: p.areas.map((a) => a.areaId) })),
    phaseWindows: windows.map((w) => ({ phaseId: w.phaseId, start: iso(w.start), finish: iso(w.finish), note: w.note })),
    areas: areas.map((a) => ({ id: a.id, parentId: a.parentId, kind: a.kind, name: a.name, code: a.code, sortOrder: a.sortOrder })),
    systems: systems.map((s) => ({ id: s.id, key: s.key, name: s.name, sortOrder: s.sortOrder, sourceAliases: s.sourceAliases })),
    milestones: milestones.map((m) => ({
      id: m.id,
      phaseId: m.phaseId,
      code: m.code,
      name: m.name,
      date: iso(m.date),
      reviewStatus: m.reviewStatus,
      candidates: m.values.map((v) => ({ id: v.id, label: v.sourceLabel, date: iso(v.date), sourceDate: iso(v.sourceDate) })),
    })),
    activities: activities.map(
      (a): ActivityInput => ({
        key: a.key,
        code: a.code,
        name: a.name,
        phaseId: a.phaseId,
        areaId: a.areaId,
        systemId: a.systemId,
        calendarKey: a.calendarKey,
        plannedStart: isoReq(a.plannedStart),
        plannedFinish: isoReq(a.plannedFinish),
        costCode: a.costCode,
        notes: a.notes,
        sortOrder: a.sortOrder,
        archived: a.archivedAt !== null,
      }),
    ),
    links: links.map((l) => ({ predecessorKey: activityKeyById.get(l.predecessorId)!, successorKey: activityKeyById.get(l.successorId)!, lagDays: l.lagDays })),
    activityMilestones: activities.flatMap((a) => a.milestones.map((m) => ({ activityKey: a.key, milestoneId: m.milestoneId }))),
    nodes: nodes.map(
      (n): NodeInput => ({
        key: n.key,
        parentKey: n.parentId ? (nodeKeyById.get(n.parentId) ?? null) : null,
        kind: n.kind,
        name: n.name,
        role: n.role,
        phaseId: n.phaseId,
        areaId: n.areaId,
        systemId: n.systemId,
        activityKey: n.activityKey,
        calendarKey: n.calendarKey,
        notes: n.notes,
        sortOrder: n.sortOrder,
      }),
    ),
    entries: entries.map(
      (e): EntryInput => ({
        nodeKey: nodeKeyById.get(e.nodeId)!,
        kind: e.kind,
        date: isoReq(e.date),
        headcount: e.headcount,
        hours: num(e.hours),
        startTime: e.startTime,
        endTime: e.endTime,
        label: e.label,
      }),
    ),
    leadership: leadership.map(
      (l): LeadershipInput => ({
        key: l.key,
        personId: l.personId,
        personName: l.person?.displayName ?? l.placeholderName,
        role: l.role,
        responsibilitySystemIds: l.responsibilitySystemIds,
        responsibilityPhaseIds: l.responsibilityPhaseIds,
        responsibilityNote: l.responsibilityNote,
        startDate: iso(l.startDate),
        endDate: iso(l.endDate),
        onsiteMode: l.onsiteMode,
        onsiteWeekdays: l.onsiteWeekdays,
        onsiteHours: num(l.onsiteHours),
        onsiteStart: l.onsiteStart,
        offsiteHoursPerWeek: num(l.offsiteHoursPerWeek),
        dayOverrides: (l.dayOverrides as unknown as DayOverride[]) ?? [],
        notes: l.notes,
        sortOrder: l.sortOrder,
      }),
    ),
    progress: progress
      .filter((p) => activityKeys.has(p.activityKey))
      .map((p) => ({
        activityKey: p.activityKey,
        status: p.status,
        actualStart: iso(p.actualStart),
        actualFinish: iso(p.actualFinish),
        percentComplete: num(p.percentComplete),
        holdReason: p.holdReason,
        holdReviewDate: iso(p.holdReviewDate),
      })),
    sourceWindows: await loadSourceWindows(db, project.id, activityKeys),
  };
}

/** Current source windows for linked activities: the record in each lineage's latest committed version. */
async function loadSourceWindows(db: Tx, projectId: string, activityKeys: Set<string>): Promise<SourceWindow[]> {
  if (!activityKeys.size) return [];
  const links = await db.activitySourceLink.findMany({ where: { projectId, activityKey: { in: [...activityKeys] } } });
  if (!links.length) return [];
  const lineageIds = [...new Set(links.map((l) => l.lineageId))];
  const lineages = await db.sourceLineage.findMany({
    where: { id: { in: lineageIds } },
    include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
  });
  const out: SourceWindow[] = [];
  for (const lineage of lineages) {
    const latest = lineage.versions[0];
    if (!latest) continue;
    const mine = links.filter((l) => l.lineageId === lineage.id);
    const records = await db.sourceRecord.findMany({ where: { versionId: latest.id, externalId: { in: mine.map((l) => l.externalId) } } });
    const byExt = new Map(records.map((r) => [r.externalId, r]));
    for (const l of mine) {
      const r = byExt.get(l.externalId);
      out.push({
        activityKey: l.activityKey,
        lineageId: lineage.id,
        lineageName: lineage.name,
        externalId: l.externalId,
        versionLabel: latest.label,
        name: r?.name ?? "(not in latest version)",
        start: iso(r?.start),
        finish: iso(r?.finish),
        removed: !r || r.changeKind === "REMOVED",
      });
    }
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Persist the difference between two PlanData values for one plan. Runs
 * inside the caller's transaction; nothing is written if any step fails.
 */
export async function persistPlanDiff(tx: Tx, planId: string, projectId: string, before: PlanData, after: PlanData): Promise<void> {
  // Calendars
  const calBefore = new Map(before.calendars.map((c) => [c.key, c]));
  const calAfter = new Map(after.calendars.map((c) => [c.key, c]));
  for (const [k, c] of calAfter) {
    const prev = calBefore.get(k);
    const data = { name: c.name, timezone: c.timezone, isDefault: c.isDefault, definition: c.definition as unknown as Prisma.InputJsonValue };
    if (!prev) await tx.calendar.create({ data: { planId, key: k, ...data } });
    else if (!same(prev, c)) await tx.calendar.update({ where: { planId_key: { planId, key: k } }, data });
  }
  for (const k of calBefore.keys()) if (!calAfter.has(k)) await tx.calendar.delete({ where: { planId_key: { planId, key: k } } });

  // Phase windows
  const winBefore = new Map(before.phaseWindows.map((w) => [w.phaseId, w]));
  const winAfter = new Map(after.phaseWindows.map((w) => [w.phaseId, w]));
  for (const [phaseId, w] of winAfter) {
    const data = { start: dateToDb(w.start), finish: dateToDb(w.finish), note: w.note };
    if (!winBefore.has(phaseId)) await tx.phaseWindow.create({ data: { planId, phaseId, ...data } });
    else if (!same(winBefore.get(phaseId), w)) await tx.phaseWindow.update({ where: { planId_phaseId: { planId, phaseId } }, data });
  }
  for (const phaseId of winBefore.keys()) if (!winAfter.has(phaseId)) await tx.phaseWindow.delete({ where: { planId_phaseId: { planId, phaseId } } });

  // Activities
  const actBefore = new Map(before.activities.map((a) => [a.key, a]));
  const actAfter = new Map(after.activities.map((a) => [a.key, a]));
  const actRow = (a: ActivityInput) => ({
    code: a.code,
    name: a.name,
    phaseId: a.phaseId,
    areaId: a.areaId,
    systemId: a.systemId,
    calendarKey: a.calendarKey,
    plannedStart: dateToDb(a.plannedStart),
    plannedFinish: dateToDb(a.plannedFinish),
    costCode: a.costCode ?? null,
    notes: a.notes,
    sortOrder: a.sortOrder,
  });
  const removedActs = [...actBefore.keys()].filter((k) => !actAfter.has(k));
  if (removedActs.length) await tx.activity.deleteMany({ where: { planId, key: { in: removedActs } } });
  const existingActs = await tx.activity.findMany({ where: { planId }, select: { id: true, key: true, archivedAt: true } });
  const actIdByKey = new Map(existingActs.map((a) => [a.key, a.id]));
  const archivedAt = new Map(existingActs.map((a) => [a.key, a.archivedAt]));
  for (const [k, a] of actAfter) {
    const prev = actBefore.get(k);
    const archived = a.archived ? (archivedAt.get(k) ?? new Date()) : null;
    if (!prev) {
      const row = await tx.activity.create({ data: { planId, projectId, key: k, ...actRow(a), archivedAt: archived } });
      actIdByKey.set(k, row.id);
    } else if (!same(prev, a)) {
      await tx.activity.update({ where: { planId_key: { planId, key: k } }, data: { ...actRow(a), archivedAt: archived } });
    }
  }

  // Links
  const linkKey = (l: { predecessorKey: string; successorKey: string }) => `${l.predecessorKey}>${l.successorKey}`;
  const linkBefore = new Map(before.links.map((l) => [linkKey(l), l]));
  const linkAfter = new Map(after.links.map((l) => [linkKey(l), l]));
  for (const [k, l] of linkBefore) {
    if (linkAfter.has(k) || removedActs.includes(l.predecessorKey) || removedActs.includes(l.successorKey)) continue;
    await tx.activityLink.deleteMany({ where: { planId, predecessorId: actIdByKey.get(l.predecessorKey), successorId: actIdByKey.get(l.successorKey) } });
  }
  for (const [k, l] of linkAfter) {
    const prev = linkBefore.get(k);
    const predecessorId = actIdByKey.get(l.predecessorKey)!;
    const successorId = actIdByKey.get(l.successorKey)!;
    if (!prev) await tx.activityLink.create({ data: { planId, predecessorId, successorId, lagDays: l.lagDays } });
    else if (prev.lagDays !== l.lagDays) await tx.activityLink.update({ where: { predecessorId_successorId: { predecessorId, successorId } }, data: { lagDays: l.lagDays } });
  }

  // Activity-milestone links
  const amKey = (x: { activityKey: string; milestoneId: string }) => `${x.activityKey}|${x.milestoneId}`;
  const amBefore = new Set(before.activityMilestones.map(amKey));
  const amAfter = new Set(after.activityMilestones.map(amKey));
  for (const x of before.activityMilestones) {
    if (!amAfter.has(amKey(x)) && actIdByKey.has(x.activityKey)) await tx.activityMilestone.deleteMany({ where: { activityId: actIdByKey.get(x.activityKey), milestoneId: x.milestoneId } });
  }
  for (const x of after.activityMilestones) {
    if (!amBefore.has(amKey(x))) await tx.activityMilestone.create({ data: { activityId: actIdByKey.get(x.activityKey)!, milestoneId: x.milestoneId } });
  }

  // Allocation nodes: delete removed (deepest first), then create/update parents first.
  const nodeBefore = new Map(before.nodes.map((n) => [n.key, n]));
  const nodeAfter = new Map(after.nodes.map((n) => [n.key, n]));
  const depth = (m: Map<string, NodeInput>, k: string) => {
    let d = 0;
    let cur = m.get(k);
    while (cur?.parentKey && d < 256) {
      d++;
      cur = m.get(cur.parentKey);
    }
    return d;
  };
  const existingNodes = await tx.allocationNode.findMany({ where: { planId }, select: { id: true, key: true } });
  const nodeIdByKey = new Map(existingNodes.map((n) => [n.key, n.id]));
  const removedNodes = [...nodeBefore.keys()].filter((k) => !nodeAfter.has(k)).sort((a, b) => depth(nodeBefore, b) - depth(nodeBefore, a));
  for (const k of removedNodes) {
    // Detach any surviving children first (they are re-parented below).
    await tx.allocationNode.updateMany({ where: { planId, parentId: nodeIdByKey.get(k) }, data: { parentId: null } });
    await tx.allocationNode.delete({ where: { planId_key: { planId, key: k } } });
    nodeIdByKey.delete(k);
  }
  const nodeRow = (n: NodeInput) => ({
    kind: n.kind,
    name: n.name,
    role: n.role,
    phaseId: n.phaseId,
    areaId: n.areaId,
    systemId: n.systemId,
    activityKey: n.activityKey,
    calendarKey: n.calendarKey,
    notes: n.notes,
    sortOrder: n.sortOrder,
  });
  const orderedAfter = [...nodeAfter.values()].sort((a, b) => depth(nodeAfter, a.key) - depth(nodeAfter, b.key));
  for (const n of orderedAfter) {
    const prev = nodeBefore.get(n.key);
    const parentId = n.parentKey ? (nodeIdByKey.get(n.parentKey) ?? null) : null;
    if (!prev || !nodeIdByKey.has(n.key)) {
      const row = await tx.allocationNode.create({ data: { planId, projectId, key: n.key, parentId, ...nodeRow(n) } });
      nodeIdByKey.set(n.key, row.id);
    } else if (!same(prev, n)) {
      await tx.allocationNode.update({ where: { planId_key: { planId, key: n.key } }, data: { parentId, ...nodeRow(n) } });
    }
  }

  // Staffing entries (cascade-deleted with removed nodes).
  const entBefore = new Map(before.entries.filter((e) => nodeAfter.has(e.nodeKey)).map((e) => [entryId(e), e]));
  const entAfter = new Map(after.entries.map((e) => [entryId(e), e]));
  const existingEntries = await tx.staffingEntry.findMany({ where: { planId }, select: { id: true, nodeId: true, kind: true, date: true, slot: true } });
  const nodeKeyById = new Map([...nodeIdByKey].map(([k, v]) => [v, k]));
  const entryRowId = new Map(existingEntries.map((e) => [entryId({ nodeKey: nodeKeyById.get(e.nodeId) ?? "", kind: e.kind, date: isoReq(e.date), startTime: e.slot || null }), e.id]));
  const toDelete: string[] = [];
  for (const k of entBefore.keys()) if (!entAfter.has(k) && entryRowId.has(k)) toDelete.push(entryRowId.get(k)!);
  if (toDelete.length) await tx.staffingEntry.deleteMany({ where: { id: { in: toDelete } } });
  const toCreate: Prisma.StaffingEntryCreateManyInput[] = [];
  const entryRow = (e: EntryInput) => ({
    headcount: e.headcount,
    hours: e.hours === null ? null : new Prisma.Decimal(e.hours),
    startTime: e.startTime,
    endTime: e.endTime,
    label: e.label,
  });
  for (const [k, e] of entAfter) {
    const prev = entBefore.get(k);
    if (!prev || !entryRowId.has(k)) {
      toCreate.push({ planId, nodeId: nodeIdByKey.get(e.nodeKey)!, kind: e.kind, date: dateToDb(e.date), slot: entrySlot(e), ...entryRow(e) });
    } else if (!same(prev, e)) {
      await tx.staffingEntry.update({ where: { id: entryRowId.get(k)! }, data: entryRow(e) });
    }
  }
  if (toCreate.length) await tx.staffingEntry.createMany({ data: toCreate });

  // Leadership
  const ldBefore = new Map(before.leadership.map((l) => [l.key, l]));
  const ldAfter = new Map(after.leadership.map((l) => [l.key, l]));
  const ldRow = (l: LeadershipInput) => ({
    personId: l.personId,
    placeholderName: l.personId ? "TBD" : l.personName,
    role: l.role,
    responsibilitySystemIds: l.responsibilitySystemIds,
    responsibilityPhaseIds: l.responsibilityPhaseIds,
    responsibilityNote: l.responsibilityNote,
    startDate: dateToDb(l.startDate),
    endDate: dateToDb(l.endDate),
    onsiteMode: l.onsiteMode,
    onsiteWeekdays: l.onsiteWeekdays,
    onsiteHours: l.onsiteHours === null ? null : new Prisma.Decimal(l.onsiteHours),
    onsiteStart: l.onsiteStart,
    offsiteHoursPerWeek: l.offsiteHoursPerWeek === null ? null : new Prisma.Decimal(l.offsiteHoursPerWeek),
    dayOverrides: l.dayOverrides as unknown as Prisma.InputJsonValue,
    notes: l.notes,
    sortOrder: l.sortOrder,
  });
  for (const k of ldBefore.keys()) if (!ldAfter.has(k)) await tx.leadershipAssignment.delete({ where: { planId_key: { planId, key: k } } });
  for (const [k, l] of ldAfter) {
    const prev = ldBefore.get(k);
    if (!prev) await tx.leadershipAssignment.create({ data: { planId, projectId, key: k, ...ldRow(l) } });
    else if (!same(prev, l)) await tx.leadershipAssignment.update({ where: { planId_key: { planId, key: k } }, data: ldRow(l) });
  }
}

export interface MutationResult {
  revision: number;
  data: PlanData;
}

export interface MutationOptions {
  kind?: string;
  summary: string;
  /** Extra checks on the resulting plan, inside the transaction. */
  check?: (after: PlanData, before: PlanData) => void;
  /** Additional writes in the same transaction. */
  alsoWrite?: (tx: Tx, after: PlanData, before: PlanData) => Promise<void>;
}

/**
 * Apply plan ops atomically with an optimistic revision check:
 * the conditional revision increment both detects stale edits and locks the
 * plan row, so concurrent writers serialize and a failure leaves nothing
 * half-applied.
 */
export async function mutatePlan(viewer: Viewer, planId: string, expectedRevision: number, ops: PlanOp[] | ((data: PlanData) => PlanData), opts: MutationOptions): Promise<MutationResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const updated = await tx.$executeRaw`UPDATE "Plan" SET "revision" = "revision" + 1, "updatedAt" = now() WHERE "id" = ${planId} AND "revision" = ${expectedRevision}`;
        if (updated === 0) {
          const current = await tx.plan.findUnique({ where: { id: planId }, select: { revision: true } });
          if (!current) throw notFound("Plan");
          throw new StaleRevisionError(current.revision, expectedRevision);
        }
        const loaded = await loadPlanData(tx, planId);
        // The row's revision was already incremented above; `before` describes the prior revision.
        const before = { ...loaded, plan: { ...loaded.plan, revision: expectedRevision } };
        const after = typeof ops === "function" ? ops(structuredClone(before)) : applyOps(before, ops);
        after.plan = { ...before.plan };
        const issues = validatePlan(after, before);
        if (issues.length) throw new ValidationFailed(issues);
        opts.check?.(after, before);
        await persistPlanDiff(tx, planId, before.project.id, before, after);
        await opts.alsoWrite?.(tx, after, before);
        const revision = expectedRevision + 1;
        await tx.planRevision.create({ data: { planId, revision, kind: opts.kind ?? "EDIT", summary: opts.summary.slice(0, 2000), actorId: viewer.userId } });
        await audit(tx, viewer, {
          projectId: before.project.id,
          planId,
          action: `plan.${(opts.kind ?? "EDIT").toLowerCase()}`,
          entityType: "Plan",
          entityId: planId,
          summary: opts.summary,
          before: typeof ops === "function" ? null : { revision: expectedRevision },
          after: typeof ops === "function" ? { revision } : { revision, ops },
        });
        return { revision, data: { ...after, plan: { ...after.plan, revision } } };
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  } catch (err) {
    if (err instanceof PlanOpError) throw badRequest(err.message);
    if (err instanceof AppError) throw err;
    throw err;
  }
}
