import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ProjectRole, WorkspaceRole } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { auth } from "@/server/auth";
import { assertProjectAccess, requireAdmin, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { badRequest, notFound } from "@/server/errors";
import { sendMail } from "@/server/mail/mailer";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const projectGrant = z.object({ projectId: z.string().min(1), role: z.enum(["PROJECT_MANAGER", "INTERNAL_VIEWER", "FOREMAN_VIEWER"]) });

export const inviteInput = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  workspaceRole: z.enum(["ADMINISTRATOR", "MEMBER"]).default("MEMBER"),
  projectGrants: z.array(projectGrant).max(200).default([]),
});

function inviteLink(token: string) {
  return `${env().APP_URL.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(token)}`;
}

async function issueInvitation(workspaceId: string, invitedById: string | null, input: z.output<typeof inviteInput>) {
  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.updateMany({ where: { workspaceId, email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const invitation = await prisma.invitation.create({
    data: {
      workspaceId,
      email: input.email,
      name: input.name,
      workspaceRole: input.workspaceRole,
      projectGrants: input.projectGrants,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedById,
    },
  });
  return { invitation, token, link: inviteLink(token) };
}

/** Administrator invites a user; the one-time link goes only to the mail transport. */
export async function inviteUser(viewer: Viewer, raw: z.input<typeof inviteInput>) {
  requireAdmin(viewer);
  const input = inviteInput.parse(raw);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw badRequest("A user with this email already exists. Grant project access instead.");
  for (const g of input.projectGrants) await assertProjectAccess(viewer, g.projectId, "edit");
  const { invitation, link } = await issueInvitation(viewer.workspaceId, viewer.userId, input);
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: viewer.workspaceId } });
  await sendMail({
    kind: "invitation",
    to: input.email,
    subject: `You are invited to ${ws.appDisplayName}`,
    text: `${viewer.name} invited you to ${ws.appDisplayName} for ${ws.name}.\n\nSet your password and sign in within seven days:\n${link}\n`,
  });
  await prisma.$transaction((tx) => audit(tx, viewer, { action: "user.invite", entityType: "Invitation", entityId: invitation.id, summary: `Invited ${input.email} (${input.workspaceRole})`, after: { email: input.email, workspaceRole: input.workspaceRole, projectGrants: input.projectGrants } }));
  return { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt.toISOString() };
}

export async function revokeInvitation(viewer: Viewer, raw: { invitationId: string }) {
  requireAdmin(viewer);
  const inv = await prisma.invitation.findFirst({ where: { id: raw.invitationId, workspaceId: viewer.workspaceId } });
  if (!inv) throw notFound("Invitation");
  await prisma.$transaction(async (tx) => {
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await audit(tx, viewer, { action: "user.invite.revoke", entityType: "Invitation", entityId: inv.id, summary: `Revoked invitation for ${inv.email}` });
  });
  return { ok: true };
}

async function findUsableInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

export async function describeInvitation(token: string) {
  const inv = await findUsableInvitation(token);
  if (!inv) return null;
  return { email: inv.email, name: inv.name, workspaceRole: inv.workspaceRole };
}

export const acceptInput = z.object({ token: z.string().min(20).max(200), name: z.string().trim().min(1).max(120), password: z.string().min(12, "Use at least 12 characters").max(128) });

/** Accept an invitation: create the login account with the chosen password and apply grants. */
export async function acceptInvitation(raw: z.input<typeof acceptInput>) {
  const input = acceptInput.parse(raw);
  const inv = await findUsableInvitation(input.token);
  if (!inv) throw badRequest("This invitation link is invalid, expired, or already used. Ask an administrator for a new one.");
  if (await prisma.user.findUnique({ where: { email: inv.email } })) throw badRequest("An account already exists for this email. Sign in or reset your password.");
  // Better Auth's own hasher; the user/account rows are written in the same
  // transaction as the workspace grants so a failure leaves no orphan login.
  const passwordHash = await (await auth.$context).password.hash(input.password);
  const grants = z.array(projectGrant).parse(inv.projectGrants);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { id: randomUUID(), email: inv.email, name: input.name, emailVerified: true } });
    await tx.account.create({ data: { id: randomUUID(), userId: user.id, providerId: "credential", accountId: user.id, password: passwordHash } });
    await tx.workspaceMember.create({ data: { workspaceId: inv.workspaceId, userId: user.id, role: inv.workspaceRole } });
    for (const g of grants) {
      const exists = await tx.project.findFirst({ where: { id: g.projectId, workspaceId: inv.workspaceId } });
      if (exists) await tx.projectMembership.create({ data: { projectId: g.projectId, userId: user.id, role: g.role, grantedById: inv.invitedById } });
    }
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await audit(tx, null, { workspaceId: inv.workspaceId, action: "user.invite.accept", entityType: "User", entityId: user.id, summary: `${inv.email} accepted an invitation (${inv.workspaceRole})` });
  });
  return { email: inv.email };
}

export async function listUsers(viewer: Viewer) {
  requireAdmin(viewer);
  const [members, invitations, projects] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { workspaceId: viewer.workspaceId }, include: { user: { include: { memberships: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.invitation.findMany({ where: { workspaceId: viewer.workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    prisma.project.findMany({ where: { workspaceId: viewer.workspaceId }, select: { id: true, code: true, name: true } }),
  ]);
  return {
    users: members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, disabled: m.disabledAt !== null, memberships: m.user.memberships.map((x) => ({ projectId: x.projectId, role: x.role })) })),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, name: i.name, workspaceRole: i.workspaceRole, expiresAt: i.expiresAt.toISOString(), projectGrants: i.projectGrants })),
    projects,
  };
}

export async function grantProjectAccess(viewer: Viewer, raw: { projectId: string; userId: string; role: ProjectRole }) {
  requireAdmin(viewer);
  const input = z.object({ projectId: z.string(), userId: z.string(), role: projectGrant.shape.role }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  const member = await prisma.workspaceMember.findFirst({ where: { userId: input.userId, workspaceId: viewer.workspaceId } });
  if (!member) throw notFound("User");
  await prisma.$transaction(async (tx) => {
    const before = await tx.projectMembership.findUnique({ where: { projectId_userId: { projectId: input.projectId, userId: input.userId } } });
    await tx.projectMembership.upsert({
      where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
      update: { role: input.role, grantedById: viewer.userId },
      create: { projectId: input.projectId, userId: input.userId, role: input.role, grantedById: viewer.userId },
    });
    await audit(tx, viewer, { projectId: input.projectId, action: "access.grant", entityType: "ProjectMembership", entityId: input.userId, summary: `Granted ${input.role} on project`, before: before ? { role: before.role } : null, after: { role: input.role } });
  });
  return { ok: true };
}

export async function revokeProjectAccess(viewer: Viewer, raw: { projectId: string; userId: string }) {
  requireAdmin(viewer);
  const input = z.object({ projectId: z.string(), userId: z.string() }).parse(raw);
  await assertProjectAccess(viewer, input.projectId, "edit");
  await prisma.$transaction(async (tx) => {
    const before = await tx.projectMembership.findUnique({ where: { projectId_userId: input } });
    if (!before) return;
    await tx.projectMembership.delete({ where: { projectId_userId: input } });
    await audit(tx, viewer, { projectId: input.projectId, action: "access.revoke", entityType: "ProjectMembership", entityId: input.userId, summary: `Revoked ${before.role} on project`, before: { role: before.role } });
  });
  return { ok: true };
}

export async function setUserStatus(viewer: Viewer, raw: { userId: string; disabled?: boolean; role?: WorkspaceRole }) {
  requireAdmin(viewer);
  const input = z.object({ userId: z.string(), disabled: z.boolean().optional(), role: z.enum(["ADMINISTRATOR", "MEMBER"]).optional() }).parse(raw);
  if (input.userId === viewer.userId && (input.disabled || input.role === "MEMBER")) throw badRequest("You cannot disable or demote your own account.");
  const member = await prisma.workspaceMember.findFirst({ where: { userId: input.userId, workspaceId: viewer.workspaceId } });
  if (!member) throw notFound("User");
  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.update({ where: { id: member.id }, data: { disabledAt: input.disabled === undefined ? undefined : input.disabled ? new Date() : null, role: input.role } });
    if (input.disabled) await tx.session.deleteMany({ where: { userId: input.userId } });
    await audit(tx, viewer, { action: "user.update", entityType: "User", entityId: input.userId, summary: `${input.disabled === undefined ? "" : input.disabled ? "Disabled user. " : "Enabled user. "}${input.role ? `Role ${input.role}.` : ""}`.trim(), before: { role: member.role, disabled: member.disabledAt !== null }, after: input });
  });
  return { ok: true };
}

/**
 * First administrator (CLI only). Creates the workspace if needed and returns
 * a one-time invitation link for the operator running the command. There is
 * no default password.
 */
export async function bootstrapAdministrator(input: { email: string; name: string; workspaceName?: string; force?: boolean }) {
  const parsed = inviteInput.parse({ email: input.email, name: input.name, workspaceRole: "ADMINISTRATOR" });
  let ws = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (!ws) ws = await prisma.workspace.create({ data: { name: input.workspaceName ?? "McKeever & Niekamp Electric" } });
  const admins = await prisma.workspaceMember.count({ where: { workspaceId: ws.id, role: "ADMINISTRATOR", disabledAt: null } });
  if (admins > 0 && !input.force) throw new Error("An administrator already exists. Use the Settings > People page to invite users, or pass --force for recovery.");
  if (await prisma.user.findUnique({ where: { email: parsed.email } })) throw new Error(`A user with email ${parsed.email} already exists. Use password reset instead.`);
  const { invitation, link } = await issueInvitation(ws.id, null, parsed);
  await prisma.$transaction((tx) => audit(tx, null, { workspaceId: ws.id, action: "user.bootstrap", entityType: "Invitation", entityId: invitation.id, summary: `Administrator bootstrap invitation issued for ${parsed.email}` }));
  return { link, expiresAt: invitation.expiresAt, workspaceId: ws.id };
}
