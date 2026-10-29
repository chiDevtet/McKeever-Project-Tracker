import { z } from "zod";
import { dateFromDb, dateToDb, isISODate } from "@/domain/dates";
import { audit } from "@/server/audit";
import { assertProjectAccess, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { badRequest, notFound } from "@/server/errors";

/**
 * Project structure: systems, phases, the optional area hierarchy, phase
 * membership, milestones and their source candidates, contacts, documents.
 * These are project-level records shared by every plan of the project.
 */

const key = z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes");
const optDate = z.string().refine(isISODate, "Expected a date").nullable();

export async function getSetup(viewer: Viewer, projectId: string) {
  const project = await assertProjectAccess(viewer, projectId, "read");
  const [full, systems, phases, areas, milestones, contacts, documents, lineages, ws] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { parties: { include: { organization: true } } } }),
    prisma.system.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.phase.findMany({ where: { projectId }, include: { areas: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.area.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.milestone.findMany({ where: { projectId }, include: { values: { orderBy: [{ sourceDate: "desc" }, { createdAt: "desc" }] } }, orderBy: [{ sortOrder: "asc" }] }),
    prisma.contact.findMany({ where: { projectId }, include: { organization: true }, orderBy: { name: "asc" } }),
    prisma.projectDocument.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } }),
    prisma.sourceLineage.findMany({ where: { projectId }, include: { versions: { orderBy: { versionNumber: "desc" } } }, orderBy: { name: "asc" } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: viewer.workspaceId } }),
  ]);
  const files = await prisma.storedFile.findMany({ where: { id: { in: documents.map((d) => d.fileId) } } });
  return {
    project: { id: project.id, code: project.code, name: full.name, status: full.status, description: full.description, timezone: full.timezone, parties: Object.fromEntries(full.parties.map((p) => [p.role, p.organization.name])) },
    systems: systems.map((s) => ({ id: s.id, key: s.key, name: s.name, sourceAliases: s.sourceAliases, sortOrder: s.sortOrder, archived: s.archivedAt !== null })),
    phases: phases.map((p) => ({ id: p.id, key: p.key, name: p.name, description: p.description, sortOrder: p.sortOrder, areaIds: p.areas.map((a) => a.areaId) })),
    areas: areas.map((a) => ({ id: a.id, parentId: a.parentId, kind: a.kind, name: a.name, code: a.code, sortOrder: a.sortOrder })),
    milestones: milestones.map((m) => ({
      id: m.id,
      phaseId: m.phaseId,
      code: m.code,
      name: m.name,
      date: dateFromDb(m.date),
      reviewStatus: m.reviewStatus,
      adoptedValueId: m.adoptedValueId,
      notes: m.notes,
      values: m.values.map((v) => ({ id: v.id, label: v.sourceLabel, sourceDate: dateFromDb(v.sourceDate), date: dateFromDb(v.date), note: v.note, sourceVersionId: v.sourceVersionId })),
    })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, title: c.title, email: c.email, phone: c.phone, organization: c.organization?.name ?? null, notes: c.notes })),
    documents: documents.map((d) => ({ id: d.id, title: d.title, category: d.category, notes: d.notes, fileId: d.fileId, filename: files.find((f) => f.id === d.fileId)?.filename ?? "", sizeBytes: files.find((f) => f.id === d.fileId)?.sizeBytes ?? 0, createdAt: d.createdAt.toISOString() })),
    lineages: lineages.map((l) => ({ id: l.id, name: l.name, kind: l.kind, versions: l.versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, label: v.label, sourceDate: dateFromDb(v.sourceDate) })) })),
    milestoneCodes: ws.milestoneCodes,
  };
}

async function inUse(projectId: string, field: "phaseId" | "areaId" | "systemId", id: string) {
  const [acts, nodes, lead] = await Promise.all([
    prisma.activity.count({ where: { projectId, [field]: id } }),
    prisma.allocationNode.count({ where: { projectId, [field]: id } }),
    field === "phaseId" ? prisma.leadershipAssignment.count({ where: { projectId, responsibilityPhaseIds: { has: id } } }) : field === "systemId" ? prisma.leadershipAssignment.count({ where: { projectId, responsibilitySystemIds: { has: id } } }) : Promise.resolve(0),
  ]);
  return acts + nodes + lead;
}

// Systems ------------------------------------------------------------------

export async function saveSystem(viewer: Viewer, raw: { projectId: string; id?: string; key?: string; name: string; sourceAliases?: string[]; sortOrder?: number; archived?: boolean }) {
  const input = z.object({ projectId: z.string(), id: z.string().optional(), key: key.optional(), name: z.string().trim().min(1).max(120), sourceAliases: z.array(z.string().trim().min(1).max(40)).max(20).default([]), sortOrder: z.number().int().optional(), archived: z.boolean().optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  return prisma.$transaction(async (tx) => {
    if (input.id) {
      const before = await tx.system.findFirst({ where: { id: input.id, projectId: input.projectId } });
      if (!before) throw notFound("System");
      const s = await tx.system.update({ where: { id: input.id }, data: { name: input.name, sourceAliases: input.sourceAliases, sortOrder: input.sortOrder, archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null } });
      await audit(tx, viewer, { projectId: input.projectId, action: "system.update", entityType: "System", entityId: s.id, summary: `Updated system ${s.name}`, before: { name: before.name, aliases: before.sourceAliases, archived: before.archivedAt !== null }, after: input });
      return { id: s.id };
    }
    if (!input.key) throw badRequest("A system key is required");
    const count = await tx.system.count({ where: { projectId: input.projectId } });
    const s = await tx.system.create({ data: { projectId: input.projectId, key: input.key, name: input.name, sourceAliases: input.sourceAliases, sortOrder: input.sortOrder ?? count } });
    await audit(tx, viewer, { projectId: input.projectId, action: "system.create", entityType: "System", entityId: s.id, summary: `Added system ${s.name}`, after: input });
    return { id: s.id };
  });
}

// Phases ---------------------------------------------------------------------

export async function savePhase(viewer: Viewer, raw: { projectId: string; id?: string; key?: string; name: string; description?: string | null; sortOrder?: number; areaIds?: string[] }) {
  const input = z.object({ projectId: z.string(), id: z.string().optional(), key: key.optional(), name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullable().optional(), sortOrder: z.number().int().optional(), areaIds: z.array(z.string()).max(500).optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  if (input.areaIds?.length) {
    const n = await prisma.area.count({ where: { projectId: input.projectId, id: { in: input.areaIds } } });
    if (n !== input.areaIds.length) throw badRequest("An area does not belong to this project");
  }
  return prisma.$transaction(async (tx) => {
    let id = input.id;
    if (id) {
      const before = await tx.phase.findFirst({ where: { id, projectId: input.projectId }, include: { areas: true } });
      if (!before) throw notFound("Phase");
      await tx.phase.update({ where: { id }, data: { name: input.name, description: input.description, sortOrder: input.sortOrder } });
      await audit(tx, viewer, { projectId: input.projectId, action: "phase.update", entityType: "Phase", entityId: id, summary: `Updated phase ${input.name}`, before: { name: before.name, areaIds: before.areas.map((a) => a.areaId) }, after: input });
    } else {
      const k = input.key ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const count = await tx.phase.count({ where: { projectId: input.projectId } });
      id = (await tx.phase.create({ data: { projectId: input.projectId, key: k || `phase-${count + 1}`, name: input.name, description: input.description ?? null, sortOrder: input.sortOrder ?? count } })).id;
      await audit(tx, viewer, { projectId: input.projectId, action: "phase.create", entityType: "Phase", entityId: id, summary: `Added phase ${input.name}`, after: input });
    }
    if (input.areaIds) {
      await tx.phaseArea.deleteMany({ where: { phaseId: id } });
      if (input.areaIds.length) await tx.phaseArea.createMany({ data: input.areaIds.map((areaId) => ({ phaseId: id!, areaId })) });
    }
    return { id };
  });
}

export async function deletePhase(viewer: Viewer, raw: { projectId: string; id: string }) {
  await assertProjectAccess(viewer, raw.projectId, "edit");
  const phase = await prisma.phase.findFirst({ where: { id: raw.id, projectId: raw.projectId } });
  if (!phase) throw notFound("Phase");
  const uses = (await inUse(raw.projectId, "phaseId", raw.id)) + (await prisma.milestone.count({ where: { phaseId: raw.id } }));
  if (uses) throw badRequest(`Phase "${phase.name}" is used by ${uses} activities, reservations, leadership scopes, or milestones in some plan. Reassign them first.`);
  await prisma.$transaction(async (tx) => {
    await tx.phaseWindow.deleteMany({ where: { phaseId: raw.id } });
    await tx.phase.delete({ where: { id: raw.id } });
    await audit(tx, viewer, { projectId: raw.projectId, action: "phase.delete", entityType: "Phase", entityId: raw.id, summary: `Deleted phase ${phase.name}` });
  });
  return { ok: true };
}

// Areas ----------------------------------------------------------------------

export async function saveArea(viewer: Viewer, raw: { projectId: string; id?: string; parentId?: string | null; kind: string; name: string; code?: string | null; sortOrder?: number }) {
  const input = z.object({ projectId: z.string(), id: z.string().optional(), parentId: z.string().nullable().default(null), kind: z.enum(["BUILDING", "ROMP", "DATA_HALL", "ROOM", "ZONE", "OTHER"]), name: z.string().trim().min(1).max(120), code: z.string().trim().max(40).nullable().default(null), sortOrder: z.number().int().optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const areas = await prisma.area.findMany({ where: { projectId: input.projectId }, select: { id: true, parentId: true } });
  if (input.parentId && !areas.some((a) => a.id === input.parentId)) throw badRequest("Parent area not found in this project");
  if (input.id && input.parentId) {
    // Reject moving an area beneath itself or one of its descendants.
    let cur: string | null = input.parentId;
    while (cur) {
      if (cur === input.id) throw badRequest("An area cannot be nested inside itself");
      cur = areas.find((a) => a.id === cur)?.parentId ?? null;
    }
  }
  return prisma.$transaction(async (tx) => {
    if (input.id) {
      const before = await tx.area.findFirst({ where: { id: input.id, projectId: input.projectId } });
      if (!before) throw notFound("Area");
      await tx.area.update({ where: { id: input.id }, data: { parentId: input.parentId, kind: input.kind, name: input.name, code: input.code, sortOrder: input.sortOrder } });
      await audit(tx, viewer, { projectId: input.projectId, action: "area.update", entityType: "Area", entityId: input.id, summary: `Updated area ${input.name}`, before, after: input });
      return { id: input.id };
    }
    const a = await tx.area.create({ data: { projectId: input.projectId, parentId: input.parentId, kind: input.kind, name: input.name, code: input.code, sortOrder: input.sortOrder ?? areas.length } });
    await audit(tx, viewer, { projectId: input.projectId, action: "area.create", entityType: "Area", entityId: a.id, summary: `Added area ${a.name}`, after: input });
    return { id: a.id };
  });
}

export async function deleteArea(viewer: Viewer, raw: { projectId: string; id: string }) {
  await assertProjectAccess(viewer, raw.projectId, "edit");
  const area = await prisma.area.findFirst({ where: { id: raw.id, projectId: raw.projectId } });
  if (!area) throw notFound("Area");
  const children = await prisma.area.count({ where: { parentId: raw.id } });
  if (children) throw badRequest(`"${area.name}" has ${children} nested area(s). Move or delete them first.`);
  const uses = await inUse(raw.projectId, "areaId", raw.id);
  if (uses) throw badRequest(`"${area.name}" is used by ${uses} activities or reservations. Reassign them first.`);
  await prisma.$transaction(async (tx) => {
    await tx.area.delete({ where: { id: raw.id } });
    await audit(tx, viewer, { projectId: raw.projectId, action: "area.delete", entityType: "Area", entityId: raw.id, summary: `Deleted area ${area.name}` });
  });
  return { ok: true };
}

// Milestones -----------------------------------------------------------------

export async function saveMilestone(viewer: Viewer, raw: { projectId: string; id?: string; phaseId: string | null; code: string; name: string; notes?: string | null }) {
  const input = z.object({ projectId: z.string(), id: z.string().optional(), phaseId: z.string().nullable(), code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(200), notes: z.string().max(2000).nullable().optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  if (input.phaseId && !(await prisma.phase.findFirst({ where: { id: input.phaseId, projectId: input.projectId } }))) throw badRequest("Phase not found");
  return prisma.$transaction(async (tx) => {
    if (input.id) {
      const before = await tx.milestone.findFirst({ where: { id: input.id, projectId: input.projectId } });
      if (!before) throw notFound("Milestone");
      await tx.milestone.update({ where: { id: input.id }, data: { phaseId: input.phaseId, code: input.code, name: input.name, notes: input.notes } });
      await audit(tx, viewer, { projectId: input.projectId, action: "milestone.update", entityType: "Milestone", entityId: input.id, summary: `Updated milestone ${input.code}`, before: { code: before.code, name: before.name, phaseId: before.phaseId }, after: input });
      return { id: input.id };
    }
    const count = await tx.milestone.count({ where: { projectId: input.projectId } });
    const m = await tx.milestone.create({ data: { projectId: input.projectId, phaseId: input.phaseId, code: input.code, name: input.name, notes: input.notes ?? null, sortOrder: count, reviewStatus: "NEEDS_REVIEW" } });
    await audit(tx, viewer, { projectId: input.projectId, action: "milestone.create", entityType: "Milestone", entityId: m.id, summary: `Added milestone ${input.code}`, after: input });
    return { id: m.id };
  });
}

/** Adopt a source candidate as the working milestone date (an explicit, audited review action). */
export async function adoptMilestoneValue(viewer: Viewer, raw: { projectId: string; milestoneId: string; valueId: string }) {
  await assertProjectAccess(viewer, raw.projectId, "edit");
  const m = await prisma.milestone.findFirst({ where: { id: raw.milestoneId, projectId: raw.projectId }, include: { values: true } });
  if (!m) throw notFound("Milestone");
  const v = m.values.find((x) => x.id === raw.valueId);
  if (!v) throw notFound("Candidate value");
  if (!v.date) throw badRequest("That source does not specify a date; enter one manually instead.");
  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({ where: { id: m.id }, data: { date: v.date, reviewStatus: "CONFIRMED", adoptedValueId: v.id } });
    await audit(tx, viewer, { projectId: raw.projectId, action: "milestone.adopt", entityType: "Milestone", entityId: m.id, summary: `Adopted ${m.code} ${dateFromDb(v.date)} from ${v.sourceLabel}`, before: { date: dateFromDb(m.date), reviewStatus: m.reviewStatus }, after: { date: dateFromDb(v.date), source: v.sourceLabel } });
  });
  return { ok: true };
}

/** Adopt every dated candidate from one source version (for example the 23 October table). */
export async function adoptSourceVersion(viewer: Viewer, raw: { projectId: string; sourceVersionId: string; milestoneIds?: string[] }) {
  await assertProjectAccess(viewer, raw.projectId, "edit");
  const values = await prisma.milestoneSourceValue.findMany({ where: { sourceVersionId: raw.sourceVersionId, milestone: { projectId: raw.projectId }, date: { not: null }, ...(raw.milestoneIds ? { milestoneId: { in: raw.milestoneIds } } : {}) }, include: { milestone: true } });
  if (!values.length) throw badRequest("No dated candidates from that source version.");
  await prisma.$transaction(async (tx) => {
    for (const v of values) await tx.milestone.update({ where: { id: v.milestoneId }, data: { date: v.date, reviewStatus: "CONFIRMED", adoptedValueId: v.id } });
    await audit(tx, viewer, { projectId: raw.projectId, action: "milestone.adoptVersion", entityType: "SourceVersion", entityId: raw.sourceVersionId, summary: `Adopted ${values.length} milestone dates from ${values[0].sourceLabel}`, before: values.map((v) => ({ id: v.milestoneId, code: v.milestone.code, date: dateFromDb(v.milestone.date), status: v.milestone.reviewStatus })), after: values.map((v) => ({ id: v.milestoneId, date: dateFromDb(v.date) })) });
  });
  return { adopted: values.length };
}

export async function setMilestoneDate(viewer: Viewer, raw: { projectId: string; milestoneId: string; date: string | null; confirm: boolean; note?: string | null }) {
  const input = z.object({ projectId: z.string(), milestoneId: z.string(), date: optDate, confirm: z.boolean(), note: z.string().max(1000).nullable().optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const m = await prisma.milestone.findFirst({ where: { id: input.milestoneId, projectId: input.projectId } });
  if (!m) throw notFound("Milestone");
  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({ where: { id: m.id }, data: { date: dateToDb(input.date), reviewStatus: input.confirm && input.date ? "CONFIRMED" : "NEEDS_REVIEW", adoptedValueId: null, notes: input.note ?? m.notes } });
    await audit(tx, viewer, { projectId: input.projectId, action: "milestone.setDate", entityType: "Milestone", entityId: m.id, summary: `Set ${m.code} to ${input.date ?? "no date"} (${input.confirm ? "confirmed" : "needs review"})`, before: { date: dateFromDb(m.date), reviewStatus: m.reviewStatus }, after: input });
  });
  return { ok: true };
}

/** Record a candidate from a reviewed manual source (for example an emailed milestone table). */
export async function addMilestoneValue(viewer: Viewer, raw: { projectId: string; milestoneId: string; sourceLabel: string; sourceDate: string | null; date: string | null; note?: string | null }) {
  const input = z.object({ projectId: z.string(), milestoneId: z.string(), sourceLabel: z.string().trim().min(1).max(200), sourceDate: optDate, date: optDate, note: z.string().max(1000).nullable().optional() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const m = await prisma.milestone.findFirst({ where: { id: input.milestoneId, projectId: input.projectId } });
  if (!m) throw notFound("Milestone");
  await prisma.$transaction(async (tx) => {
    const v = await tx.milestoneSourceValue.create({ data: { milestoneId: m.id, sourceLabel: input.sourceLabel, sourceDate: dateToDb(input.sourceDate), date: dateToDb(input.date), note: input.note ?? null } });
    if (m.reviewStatus === "CONFIRMED" && dateFromDb(m.date) !== input.date) await tx.milestone.update({ where: { id: m.id }, data: { reviewStatus: "NEEDS_REVIEW" } });
    await audit(tx, viewer, { projectId: input.projectId, action: "milestone.addCandidate", entityType: "MilestoneSourceValue", entityId: v.id, summary: `${m.code}: candidate ${input.date ?? "unspecified"} from ${input.sourceLabel}`, after: input });
  });
  return { ok: true };
}

// Contacts -------------------------------------------------------------------

export async function saveContact(viewer: Viewer, raw: { projectId: string; id?: string; name: string; title?: string | null; email?: string | null; phone?: string | null; organization?: string | null; notes?: string | null }) {
  const input = z.object({ projectId: z.string(), id: z.string().optional(), name: z.string().trim().min(1).max(120), title: z.string().max(120).nullable().default(null), email: z.email().nullable().or(z.literal("").transform(() => null)).default(null), phone: z.string().max(40).nullable().default(null), organization: z.string().trim().max(200).nullable().default(null), notes: z.string().max(2000).nullable().default(null) }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  return prisma.$transaction(async (tx) => {
    const org = input.organization ? await tx.organization.upsert({ where: { workspaceId_name: { workspaceId: viewer.workspaceId, name: input.organization } }, update: {}, create: { workspaceId: viewer.workspaceId, name: input.organization } }) : null;
    const data = { name: input.name, title: input.title, email: input.email, phone: input.phone, notes: input.notes, organizationId: org?.id ?? null };
    const c = input.id ? await tx.contact.update({ where: { id: input.id, projectId: input.projectId }, data }) : await tx.contact.create({ data: { projectId: input.projectId, ...data } });
    await audit(tx, viewer, { projectId: input.projectId, action: input.id ? "contact.update" : "contact.create", entityType: "Contact", entityId: c.id, summary: `${input.id ? "Updated" : "Added"} contact ${c.name} (no app account created)` });
    return { id: c.id };
  });
}

export async function deleteContact(viewer: Viewer, raw: { projectId: string; id: string }) {
  await assertProjectAccess(viewer, raw.projectId, "edit");
  await prisma.$transaction(async (tx) => {
    const c = await tx.contact.delete({ where: { id: raw.id, projectId: raw.projectId } });
    await audit(tx, viewer, { projectId: raw.projectId, action: "contact.delete", entityType: "Contact", entityId: c.id, summary: `Removed contact ${c.name}` });
  });
  return { ok: true };
}
