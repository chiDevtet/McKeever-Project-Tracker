import { randomUUID } from "node:crypto";
import type { ProjectRole } from "@/generated/prisma/client";
import { viewerForUser, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { createProject, type CreateProjectInput } from "@/server/services/projects";

export async function workspaceId() {
  return (await prisma.workspace.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
}

/** Create a user with a workspace membership and optional project grants. */
export async function makeUser(opts: { admin?: boolean; grants?: [string, ProjectRole][]; name?: string } = {}): Promise<Viewer> {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: opts.name ?? `Test user ${id.slice(0, 6)}`, email: `${id}@test.invalid`, emailVerified: true } });
  await prisma.workspaceMember.create({ data: { workspaceId: await workspaceId(), userId: id, role: opts.admin ? "ADMINISTRATOR" : "MEMBER" } });
  for (const [projectId, role] of opts.grants ?? []) await prisma.projectMembership.create({ data: { projectId, userId: id, role } });
  return (await viewerForUser(id))!;
}

export async function refreshViewer(v: Viewer) {
  return (await viewerForUser(v.userId))!;
}

let seq = 0;
export async function makeProject(admin: Viewer, input: Partial<CreateProjectInput> = {}) {
  seq += 1;
  return createProject(admin, { code: `T${Date.now().toString(36)}${seq}`, name: "Integration test project", systems: [{ key: "fire-alarm", name: "Fire alarm", sourceAliases: ["Fire Alarm"] }, { key: "vesda", name: "VESDA smoke detection", sourceAliases: ["VESDA"] }], ...input });
}

export const noProgress = async () => {};
