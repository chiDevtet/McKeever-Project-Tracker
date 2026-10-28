import type { ProjectRole } from "@/generated/prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { forbidden, notFound, unauthenticated } from "@/server/errors";

/**
 * Authenticated caller with workspace and project grants. Every service
 * operation receives a Viewer and checks access itself, so route handlers,
 * server components, and background jobs share the same rules.
 *
 * Administrator: everything in the workspace.
 * Project manager: read and edit assigned projects.
 * Internal viewer / foreman viewer: read assigned projects and download
 * their reports; no modifications.
 */
export interface Viewer {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  isAdmin: boolean;
  projectRoles: Map<string, ProjectRole>;
}

export type Access = "read" | "edit";

export async function viewerForUser(userId: string): Promise<Viewer | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { workspaceMember: true, memberships: true },
  });
  if (!user?.workspaceMember || user.workspaceMember.disabledAt) return null;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    workspaceId: user.workspaceMember.workspaceId,
    isAdmin: user.workspaceMember.role === "ADMINISTRATOR",
    projectRoles: new Map(user.memberships.map((m) => [m.projectId, m.role])),
  };
}

export async function viewerFromHeaders(headers: Headers): Promise<Viewer | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return viewerForUser(session.user.id);
}

export function requireSignedIn(viewer: Viewer | null): Viewer {
  if (!viewer) throw unauthenticated();
  return viewer;
}

export function requireAdmin(viewer: Viewer): void {
  if (!viewer.isAdmin) throw forbidden("Only an administrator can do this.");
}

export function canRead(viewer: Viewer, projectId: string): boolean {
  return viewer.isAdmin || viewer.projectRoles.has(projectId);
}

export function canEdit(viewer: Viewer, projectId: string): boolean {
  return viewer.isAdmin || viewer.projectRoles.get(projectId) === "PROJECT_MANAGER";
}

/** Load a project in the viewer's workspace and check access. Unknown and inaccessible projects look the same. */
export async function assertProjectAccess(viewer: Viewer, projectId: string, access: Access) {
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId: viewer.workspaceId } });
  if (!project || !canRead(viewer, projectId)) throw notFound("Project");
  if (access === "edit" && !canEdit(viewer, projectId)) throw forbidden("Your role on this project is read-only.");
  return project;
}

/** Resolve a plan, its project, and check access. */
export async function assertPlanAccess(viewer: Viewer, planId: string, access: Access) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound("Plan");
  const project = await assertProjectAccess(viewer, plan.projectId, access);
  return { plan, project };
}

export function accessibleProjectFilter(viewer: Viewer) {
  return viewer.isAdmin ? { workspaceId: viewer.workspaceId } : { workspaceId: viewer.workspaceId, id: { in: [...viewer.projectRoles.keys()] } };
}
