import { z } from "zod";
import { dateFromDb } from "@/domain/dates";
import { isValidTimeZone } from "@/domain/tz";
import { audit } from "@/server/audit";
import { requireAdmin, type Viewer } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { badRequest } from "@/server/errors";
import { storeFile } from "@/server/services/files";

const list = (max: number) => z.array(z.string().trim().min(1).max(80)).min(1).max(max);

export const workspaceInput = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  appDisplayName: z.string().trim().min(1, "Application name is required").max(80),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color such as #1d4f7a"),
  defaultTimezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
  divisionTimezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
  installerRoles: list(30),
  leadershipRoles: list(30),
  milestoneCodes: list(60),
});

/** True when the development mail outbox may be shown (never under a production build). */
export function outboxEnabled() {
  const cfg = env();
  return cfg.MAIL_TRANSPORT === "outbox" && cfg.APP_ENV === "development" && process.env.NODE_ENV !== "production";
}

export async function getSettings(viewer: Viewer) {
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: viewer.workspaceId } });
  const limits = await prisma.availabilityLimit.findMany({ where: { workspaceId: viewer.workspaceId }, orderBy: [{ role: "asc" }, { startDate: "asc" }] });
  const cfg = env();
  return {
    workspace: { name: ws.name, appDisplayName: ws.appDisplayName, brandColor: ws.brandColor, logoFileId: ws.logoFileId, defaultTimezone: ws.defaultTimezone, divisionTimezone: ws.divisionTimezone, installerRoles: ws.installerRoles, leadershipRoles: ws.leadershipRoles, milestoneCodes: ws.milestoneCodes },
    limits: limits.map((l) => ({ id: l.id, role: l.role, startDate: dateFromDb(l.startDate)!, endDate: dateFromDb(l.endDate)!, maxHeadcount: l.maxHeadcount, note: l.note })),
    // Configuration status only; secrets are never returned.
    status: {
      appEnv: cfg.APP_ENV,
      appUrl: cfg.APP_URL,
      mail: cfg.MAIL_TRANSPORT === "smtp" ? `SMTP via ${cfg.SMTP_HOST}:${cfg.SMTP_PORT}${cfg.SMTP_SECURE ? " (TLS)" : ""}, from ${cfg.MAIL_FROM}` : "Development outbox (messages are stored in the database, not delivered)",
      storage: cfg.STORAGE_DRIVER === "r2" ? `Private Cloudflare R2 bucket ${cfg.R2_BUCKET}` : `Local filesystem (${cfg.LOCAL_STORAGE_DIR})`,
      outbox: outboxEnabled(),
    },
  };
}

export async function updateWorkspace(viewer: Viewer, raw: z.input<typeof workspaceInput>) {
  requireAdmin(viewer);
  const input = workspaceInput.parse(raw);
  const dedupe = (xs: string[]) => [...new Set(xs)];
  return prisma.$transaction(async (tx) => {
    const before = await tx.workspace.findUniqueOrThrow({ where: { id: viewer.workspaceId } });
    await tx.workspace.update({ where: { id: viewer.workspaceId }, data: { ...input, installerRoles: dedupe(input.installerRoles), leadershipRoles: dedupe(input.leadershipRoles), milestoneCodes: dedupe(input.milestoneCodes.map((c) => c.toUpperCase())) } });
    await audit(tx, viewer, { action: "workspace.update", entityType: "Workspace", entityId: viewer.workspaceId, summary: "Updated workspace settings", before: { name: before.name, appDisplayName: before.appDisplayName, brandColor: before.brandColor, divisionTimezone: before.divisionTimezone, installerRoles: before.installerRoles, leadershipRoles: before.leadershipRoles, milestoneCodes: before.milestoneCodes }, after: input });
    return { ok: true };
  });
}

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function setLogo(viewer: Viewer, file: { filename: string; contentType: string; bytes: Uint8Array } | null) {
  requireAdmin(viewer);
  if (file) {
    if (!LOGO_TYPES.has(file.contentType)) throw badRequest("Upload the logo as PNG, JPEG, or WebP.");
    if (file.bytes.byteLength > 2 * 1024 * 1024) throw badRequest("Logos are limited to 2 MB.");
  }
  return prisma.$transaction(async (tx) => {
    const stored = file ? await storeFile(tx, { workspaceId: viewer.workspaceId, projectId: null, kind: "LOGO", filename: file.filename, contentType: file.contentType, bytes: file.bytes, immutable: false, createdById: viewer.userId }) : null;
    await tx.workspace.update({ where: { id: viewer.workspaceId }, data: { logoFileId: stored?.id ?? null } });
    await audit(tx, viewer, { action: file ? "workspace.logo" : "workspace.logo.clear", entityType: "Workspace", entityId: viewer.workspaceId, summary: file ? `Uploaded logo ${file.filename}` : "Removed logo" });
    return { logoFileId: stored?.id ?? null };
  });
}

/** Development outbox (invitations, password resets). Unavailable under a production build. */
export async function listOutbox() {
  if (!outboxEnabled()) return null;
  const rows = await prisma.mailOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => ({ id: r.id, to: r.toAddress, subject: r.subject, text: r.text, kind: r.kind, createdAt: r.createdAt.toISOString() }));
}
