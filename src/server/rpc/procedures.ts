import type { Viewer } from "@/server/authz";
import * as division from "@/server/services/division";
import * as people from "@/server/services/people";
import * as plans from "@/server/services/plans";
import * as projects from "@/server/services/projects";
import * as users from "@/server/services/users";

/**
 * Authenticated operations reachable at POST /api/rpc/<name>. Each function
 * validates its own input and enforces access for the viewer; this table only
 * names them.
 */
export const procedures = {
  "projects.create": (v: Viewer, input: projects.CreateProjectInput) => projects.createProject(v, input),
  "projects.update": (v: Viewer, input: Parameters<typeof projects.updateProject>[1]) => projects.updateProject(v, input),
  "plans.applyOps": (v: Viewer, input: Parameters<typeof plans.applyPlanOps>[1]) => plans.applyPlanOps(v, input),
  "plans.view": (v: Viewer, input: { projectId: string; planId?: string | null }) => plans.getPlanView(v, input.projectId, input.planId),
  "plans.revisions": (v: Viewer, input: { planId: string }) => plans.listRevisions(v, input.planId),
  "division.addLimit": (v: Viewer, input: Parameters<typeof division.addAvailabilityLimit>[1]) => division.addAvailabilityLimit(v, input),
  "division.removeLimit": (v: Viewer, input: { id: string }) => division.removeAvailabilityLimit(v, input),
  "people.list": (v: Viewer) => people.listPeople(v),
  "people.create": (v: Viewer, input: Parameters<typeof people.createPerson>[1]) => people.createPerson(v, input),
  "people.update": (v: Viewer, input: Parameters<typeof people.updatePerson>[1]) => people.updatePerson(v, input),
  "users.invite": (v: Viewer, input: Parameters<typeof users.inviteUser>[1]) => users.inviteUser(v, input),
  "users.revokeInvitation": (v: Viewer, input: { invitationId: string }) => users.revokeInvitation(v, input),
  "users.list": (v: Viewer) => users.listUsers(v),
  "users.grant": (v: Viewer, input: Parameters<typeof users.grantProjectAccess>[1]) => users.grantProjectAccess(v, input),
  "users.revoke": (v: Viewer, input: Parameters<typeof users.revokeProjectAccess>[1]) => users.revokeProjectAccess(v, input),
  "users.setStatus": (v: Viewer, input: Parameters<typeof users.setUserStatus>[1]) => users.setUserStatus(v, input),
} satisfies Record<string, (viewer: Viewer, input: never) => Promise<unknown>>;

export type Procedures = typeof procedures;
