import type { Viewer } from "@/server/authz";
import * as division from "@/server/services/division";
import * as history from "@/server/services/history";
import * as imports from "@/server/services/imports";
import * as people from "@/server/services/people";
import * as plans from "@/server/services/plans";
import * as progress from "@/server/services/progress";
import * as projects from "@/server/services/projects";
import * as reports from "@/server/services/reports";
import * as structure from "@/server/services/structure";
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
  "progress.update": (v: Viewer, input: Parameters<typeof progress.updateProgress>[1]) => progress.updateProgress(v, input),
  "history.get": (v: Viewer, input: { projectId: string }) => history.getHistory(v, input.projectId),
  "history.createBaseline": (v: Viewer, input: Parameters<typeof history.createBaseline>[1]) => history.createBaseline(v, input),
  "history.createScenario": (v: Viewer, input: Parameters<typeof history.createScenario>[1]) => history.createScenario(v, input),
  "history.compare": (v: Viewer, input: Parameters<typeof history.comparePlan>[1]) => history.comparePlan(v, input),
  "history.promote": (v: Viewer, input: Parameters<typeof history.promoteScenario>[1]) => history.promoteScenario(v, input).then((r) => ({ revision: r.revision })),
  "history.restore": (v: Viewer, input: Parameters<typeof history.restoreSnapshot>[1]) => history.restoreSnapshot(v, input).then((r) => ({ revision: r.revision })),
  "history.archiveScenario": (v: Viewer, input: { planId: string }) => history.archiveScenario(v, input),
  "division.addLimit": (v: Viewer, input: Parameters<typeof division.addAvailabilityLimit>[1]) => division.addAvailabilityLimit(v, input),
  "division.removeLimit": (v: Viewer, input: { id: string }) => division.removeAvailabilityLimit(v, input),
  "imports.list": (v: Viewer, input: { projectId: string }) => imports.listImports(v, input),
  "imports.get": (v: Viewer, input: { sessionId: string }) => imports.getImport(v, input),
  "imports.sheetPreview": (v: Viewer, input: Parameters<typeof imports.sheetPreview>[1]) => imports.sheetPreview(v, input),
  "imports.setMapping": (v: Viewer, input: Parameters<typeof imports.setMappingAndExtract>[1]) => imports.setMappingAndExtract(v, input),
  "imports.retry": (v: Viewer, input: { sessionId: string }) => imports.retryExtraction(v, input),
  "imports.updateRows": (v: Viewer, input: Parameters<typeof imports.updateRows>[1]) => imports.updateRows(v, input),
  "imports.resolveUncertain": (v: Viewer, input: Parameters<typeof imports.resolveUncertain>[1]) => imports.resolveUncertain(v, input),
  "imports.validate": (v: Viewer, input: Parameters<typeof imports.validateImport>[1]) => imports.validateImport(v, input),
  "imports.commit": (v: Viewer, input: Parameters<typeof imports.commitImport>[1]) => imports.commitImport(v, input),
  "imports.cancel": (v: Viewer, input: { sessionId: string }) => imports.cancelImport(v, input),
  "imports.versionRecords": (v: Viewer, input: Parameters<typeof imports.versionRecords>[1]) => imports.versionRecords(v, input),
  "imports.linkSource": (v: Viewer, input: Parameters<typeof imports.linkSource>[1]) => imports.linkSource(v, input),
  "imports.applySourceChanges": (v: Viewer, input: Parameters<typeof imports.applySourceChanges>[1]) => imports.applySourceChanges(v, input),
  "imports.createActivities": (v: Viewer, input: Parameters<typeof imports.createActivitiesFromSource>[1]) => imports.createActivitiesFromSource(v, input),
  "people.list": (v: Viewer) => people.listPeople(v),
  "people.create": (v: Viewer, input: Parameters<typeof people.createPerson>[1]) => people.createPerson(v, input),
  "people.update": (v: Viewer, input: Parameters<typeof people.updatePerson>[1]) => people.updatePerson(v, input),
  "reports.presets": (v: Viewer, input: { projectId: string }) => reports.listPresets(v, input.projectId),
  "reports.savePreset": (v: Viewer, input: Parameters<typeof reports.savePreset>[1]) => reports.savePreset(v, input),
  "reports.deletePreset": (v: Viewer, input: Parameters<typeof reports.deletePreset>[1]) => reports.deletePreset(v, input),
  "reports.sources": (v: Viewer, input: { projectId: string }) => reports.listReportSources(v, input.projectId),
  "reports.snapshotData": (v: Viewer, input: { snapshotId: string }) => reports.getSnapshotData(v, input),
  "reports.generate": (v: Viewer, input: Parameters<typeof reports.generateReport>[1]) => reports.generateReport(v, input),
  "reports.list": (v: Viewer, input: { projectId: string }) => reports.listReports(v, input.projectId),
  "reports.submissionChecks": (v: Viewer, input: Parameters<typeof reports.submissionChecks>[1]) => reports.submissionChecks(v, input),
  "reports.recordSubmission": (v: Viewer, input: Parameters<typeof reports.recordSubmission>[1]) => reports.recordSubmission(v, input),
  "setup.get": (v: Viewer, input: { projectId: string }) => structure.getSetup(v, input.projectId),
  "setup.saveSystem": (v: Viewer, input: Parameters<typeof structure.saveSystem>[1]) => structure.saveSystem(v, input),
  "setup.savePhase": (v: Viewer, input: Parameters<typeof structure.savePhase>[1]) => structure.savePhase(v, input),
  "setup.deletePhase": (v: Viewer, input: Parameters<typeof structure.deletePhase>[1]) => structure.deletePhase(v, input),
  "setup.saveArea": (v: Viewer, input: Parameters<typeof structure.saveArea>[1]) => structure.saveArea(v, input),
  "setup.deleteArea": (v: Viewer, input: Parameters<typeof structure.deleteArea>[1]) => structure.deleteArea(v, input),
  "setup.saveMilestone": (v: Viewer, input: Parameters<typeof structure.saveMilestone>[1]) => structure.saveMilestone(v, input),
  "setup.adoptMilestoneValue": (v: Viewer, input: Parameters<typeof structure.adoptMilestoneValue>[1]) => structure.adoptMilestoneValue(v, input),
  "setup.adoptSourceVersion": (v: Viewer, input: Parameters<typeof structure.adoptSourceVersion>[1]) => structure.adoptSourceVersion(v, input),
  "setup.setMilestoneDate": (v: Viewer, input: Parameters<typeof structure.setMilestoneDate>[1]) => structure.setMilestoneDate(v, input),
  "setup.addMilestoneValue": (v: Viewer, input: Parameters<typeof structure.addMilestoneValue>[1]) => structure.addMilestoneValue(v, input),
  "setup.saveContact": (v: Viewer, input: Parameters<typeof structure.saveContact>[1]) => structure.saveContact(v, input),
  "setup.deleteContact": (v: Viewer, input: Parameters<typeof structure.deleteContact>[1]) => structure.deleteContact(v, input),
  "users.invite": (v: Viewer, input: Parameters<typeof users.inviteUser>[1]) => users.inviteUser(v, input),
  "users.revokeInvitation": (v: Viewer, input: { invitationId: string }) => users.revokeInvitation(v, input),
  "users.list": (v: Viewer) => users.listUsers(v),
  "users.grant": (v: Viewer, input: Parameters<typeof users.grantProjectAccess>[1]) => users.grantProjectAccess(v, input),
  "users.revoke": (v: Viewer, input: Parameters<typeof users.revokeProjectAccess>[1]) => users.revokeProjectAccess(v, input),
  "users.setStatus": (v: Viewer, input: Parameters<typeof users.setUserStatus>[1]) => users.setUserStatus(v, input),
} satisfies Record<string, (viewer: Viewer, input: never) => Promise<unknown>>;

export type Procedures = typeof procedures;
