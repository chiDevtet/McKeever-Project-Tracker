import { audit } from "@/server/audit";
import { assertProjectAccess, viewerFromHeaders } from "@/server/authz";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { badRequest } from "@/server/errors";
import { errorResponse, isSameOrigin } from "@/server/rpc/http";
import { storeFile } from "@/server/services/files";

export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Map([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["text/csv", "csv"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["message/rfc822", "eml"],
  ["text/plain", "txt"],
]);

/** Upload a project attachment (schedules, email screenshots, correspondence). */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  try {
    if (!isSameOrigin(req, env().APP_URL)) throw badRequest("Cross-site request rejected");
    const viewer = await viewerFromHeaders(req.headers);
    if (!viewer) return Response.json({ ok: false, error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
    const { projectId } = await ctx.params;
    await assertProjectAccess(viewer, projectId, "edit");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Choose a file to upload");
    if (file.size === 0) throw badRequest("The file is empty");
    if (file.size > MAX_BYTES) throw badRequest("Files are limited to 50 MB");
    const type = file.type || "application/octet-stream";
    if (!ALLOWED.has(type)) throw badRequest(`Unsupported file type ${type}. Allowed: PDF, PNG, JPEG, CSV, XLSX, DOCX, EML, TXT.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (type === "application/pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw badRequest("The file is not a valid PDF");
    const title = String(form.get("title") || file.name).slice(0, 200);
    const category = String(form.get("category") || "OTHER").slice(0, 40);
    const doc = await prisma.$transaction(async (tx) => {
      const stored = await storeFile(tx, { workspaceId: viewer.workspaceId, projectId, kind: "ATTACHMENT", filename: file.name, contentType: type, bytes, immutable: true, createdById: viewer.userId });
      const d = await tx.projectDocument.create({ data: { projectId, fileId: stored.id, title, category, notes: String(form.get("notes") || "") || null, createdById: viewer.userId } });
      await audit(tx, viewer, { projectId, action: "document.upload", entityType: "ProjectDocument", entityId: d.id, summary: `Uploaded ${file.name} (${category})` });
      return d;
    });
    return Response.json({ ok: true, result: { id: doc.id } });
  } catch (err) {
    return errorResponse(err);
  }
}
