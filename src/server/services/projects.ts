import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defaultCalendarDefinition, defaultWeekPattern } from "@/domain/calendar";
import { isValidTimeZone } from "@/domain/tz";
import type { PartyRole, Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { accessibleProjectFilter, assertProjectAccess, requireAdmin, type Viewer } from "@/server/authz";
import { prisma, type Tx } from "@/server/db";
import { badRequest } from "@/server/errors";

const systemInput = z.object({ key: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes"), name: z.string().min(1).max(120), sourceAliases: z.array(z.string().max(40)).default([]) });

export const createProjectInput = z.object({
  code: z.string().trim().min(1, "Project code is required").max(40),
  name: z.string().trim().min(1, "Project name is required").max(200),
  status: z.enum(["PRELIMINARY", "ACTIVE", "ON_HOLD", "COMPLETE", "ARCHIVED"]).default("PRELIMINARY"),
  description: z.string().max(4000).nullable().default(null),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone").default("America/New_York"),
  customer: z.string().trim().max(200).nullable().default(null),
  generalContractor: z.string().trim().max(200).nullable().default(null),
  owner: z.string().trim().max(200).nullable().default(null),
  systems: z.array(systemInput).max(50).default([]),
  workdays: z.array(z.number().int().min(1).max(7)).min(1).default([1, 2, 3, 4, 5]),
  hoursPerDay: z.number().gt(0).max(24).default(8),
  dayStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("07:00"),
});
export type CreateProjectInput = z.input<typeof createProjectInput>;

async function upsertOrganization(tx: Tx, workspaceId: string, name: string) {
  return tx.organization.upsert({ where: { workspaceId_name: { workspaceId, name } }, update: {}, create: { workspaceId, name } });
}

export async function setParty(tx: Tx, workspaceId: string, projectId: string, role: PartyRole, name: string | null) {
  await tx.projectParty.deleteMany({ where: { projectId, role } });
  if (!name) return;
  const org = await upsertOrganization(tx, workspaceId, name);
  await tx.projectParty.create({ data: { projectId, organizationId: org.id, role } });
}

/** Create a project with a working plan, project calendar, and shared installer pool. */
export async function createProject(viewer: Viewer, raw: CreateProjectInput) {
  requireAdmin(viewer);
  const input = createProjectInput.parse(raw);
  const exists = await prisma.project.findUnique({ where: { workspaceId_code: { workspaceId: viewer.workspaceId, code: input.code } } });
  if (exists) throw badRequest(`Project code ${input.code} is already used`);
  const pattern = defaultWeekPattern(input.hoursPerDay, input.dayStart).map((d, i) => (input.workdays.includes(i + 1) ? { open: true, hours: input.hoursPerDay, start: input.dayStart } : { ...d, open: false, hours: 0 }));
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: { workspaceId: viewer.workspaceId, code: input.code, name: input.name, status: input.status, description: input.description, timezone: input.timezone, createdById: viewer.userId },
    });
    await setParty(tx, viewer.workspaceId, project.id, "CUSTOMER", input.customer);
    await setParty(tx, viewer.workspaceId, project.id, "GENERAL_CONTRACTOR", input.generalContractor);
    await setParty(tx, viewer.workspaceId, project.id, "OWNER", input.owner);
    for (const [i, s] of input.systems.entries()) {
      await tx.system.create({ data: { projectId: project.id, key: s.key, name: s.name, sourceAliases: s.sourceAliases, sortOrder: i } });
    }
    const plan = await tx.plan.create({ data: { projectId: project.id, kind: "WORKING", name: "Working plan", revision: 1, createdById: viewer.userId } });
    await tx.calendar.create({
      data: { planId: plan.id, key: "project", name: "Project calendar", timezone: input.timezone, isDefault: true, definition: { ...defaultCalendarDefinition(), weekPattern: pattern } as unknown as Prisma.InputJsonValue },
    });
    await tx.allocationNode.create({ data: { planId: plan.id, projectId: project.id, key: randomUUID(), kind: "POOL", name: "Installers — shared workforce", role: "Installer" } });
    await tx.planRevision.create({ data: { planId: plan.id, revision: 1, kind: "CREATE", summary: "Project created", actorId: viewer.userId } });
    await audit(tx, viewer, { projectId: project.id, planId: plan.id, action: "project.create", entityType: "Project", entityId: project.id, summary: `Created project ${input.code} ${input.name}`, after: input });
    return project;
  });
}

export const updateProjectInput = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["PRELIMINARY", "ACTIVE", "ON_HOLD", "COMPLETE", "ARCHIVED"]).optional(),
  description: z.string().max(4000).nullable().optional(),
  customer: z.string().trim().max(200).nullable().optional(),
  generalContractor: z.string().trim().max(200).nullable().optional(),
  owner: z.string().trim().max(200).nullable().optional(),
});

export async function updateProject(viewer: Viewer, raw: z.input<typeof updateProjectInput>) {
  const input = updateProjectInput.parse(raw);
  const before = await assertProjectAccess(viewer, input.projectId, "edit");
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.update({ where: { id: input.projectId }, data: { name: input.name, status: input.status, description: input.description } });
    if (input.customer !== undefined) await setParty(tx, viewer.workspaceId, project.id, "CUSTOMER", input.customer);
    if (input.generalContractor !== undefined) await setParty(tx, viewer.workspaceId, project.id, "GENERAL_CONTRACTOR", input.generalContractor);
    if (input.owner !== undefined) await setParty(tx, viewer.workspaceId, project.id, "OWNER", input.owner);
    await audit(tx, viewer, { projectId: project.id, action: "project.update", entityType: "Project", entityId: project.id, summary: `Updated project ${project.code}`, before: { name: before.name, status: before.status, description: before.description }, after: input });
    return project;
  });
}

export async function workingPlanId(projectId: string): Promise<string> {
  const plan = await prisma.plan.findFirst({ where: { projectId, kind: "WORKING" }, select: { id: true } });
  if (!plan) throw new Error(`Project ${projectId} has no working plan`);
  return plan.id;
}

export async function listAccessibleProjects(viewer: Viewer) {
  return prisma.project.findMany({
    where: accessibleProjectFilter(viewer),
    include: { parties: { include: { organization: true } }, plans: { where: { kind: "WORKING" }, select: { id: true, revision: true, updatedAt: true } } },
    orderBy: [{ status: "asc" }, { code: "asc" }],
  });
}
