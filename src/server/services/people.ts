import { z } from "zod";
import { audit } from "@/server/audit";
import { canEdit, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

const personInput = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(120),
  title: z.string().trim().max(120).nullable().default(null),
  email: z.email().nullable().or(z.literal("").transform(() => null)).default(null),
  phone: z.string().trim().max(40).nullable().default(null),
  notes: z.string().max(2000).nullable().default(null),
});

/** Personnel records are independent of login accounts. Admins and project managers maintain them. */
function assertCanManagePeople(viewer: Viewer) {
  if (!viewer.isAdmin && ![...viewer.projectRoles.keys()].some((p) => canEdit(viewer, p))) throw forbidden("Only administrators and project managers can edit personnel.");
}

export async function listPeople(viewer: Viewer) {
  const people = await prisma.person.findMany({ where: { workspaceId: viewer.workspaceId }, orderBy: [{ archivedAt: "asc" }, { displayName: "asc" }], include: { user: { select: { email: true } } } });
  return people.map((p) => ({ id: p.id, displayName: p.displayName, title: p.title, email: p.email, phone: p.phone, notes: p.notes, archived: p.archivedAt !== null, loginEmail: p.user?.email ?? null }));
}

export async function createPerson(viewer: Viewer, raw: z.input<typeof personInput>) {
  assertCanManagePeople(viewer);
  const input = personInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    const p = await tx.person.create({ data: { workspaceId: viewer.workspaceId, ...input } });
    await audit(tx, viewer, { action: "person.create", entityType: "Person", entityId: p.id, summary: `Added personnel record ${p.displayName}`, after: input });
    return { id: p.id, displayName: p.displayName, title: p.title };
  });
}

const personUpdate = z.object({
  id: z.string().min(1),
  archived: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(120).nullable().optional(),
  email: z.email().nullable().or(z.literal("").transform(() => null)).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function updatePerson(viewer: Viewer, raw: z.input<typeof personUpdate>) {
  assertCanManagePeople(viewer);
  const { id, archived, ...patch } = personUpdate.parse(raw);
  const before = await prisma.person.findFirst({ where: { id, workspaceId: viewer.workspaceId } });
  if (!before) throw notFound("Person");
  return prisma.$transaction(async (tx) => {
    const p = await tx.person.update({ where: { id }, data: { ...patch, archivedAt: archived === undefined ? undefined : archived ? new Date() : null } });
    await audit(tx, viewer, { action: "person.update", entityType: "Person", entityId: id, summary: `Updated personnel record ${p.displayName}`, before: { displayName: before.displayName, title: before.title, archived: before.archivedAt !== null }, after: { ...patch, archived } });
    return { id: p.id };
  });
}
