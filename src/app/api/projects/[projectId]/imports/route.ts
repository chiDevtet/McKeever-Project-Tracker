import { viewerFromHeaders } from "@/server/authz";
import { env } from "@/server/env";
import { badRequest } from "@/server/errors";
import { errorResponse, isSameOrigin } from "@/server/rpc/http";
import { createImport } from "@/server/services/imports";

export const dynamic = "force-dynamic";

/** Upload a schedule (text PDF, CSV, or XLSX) to start a reviewed import. */
export async function POST(req: Request, ctx: { params: Promise<{ projectId: string }> }) {
  try {
    if (!isSameOrigin(req, env().APP_URL)) throw badRequest("Cross-site request rejected");
    const viewer = await viewerFromHeaders(req.headers);
    if (!viewer) return Response.json({ ok: false, error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
    const { projectId } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw badRequest("Choose a schedule file to upload");
    const result = await createImport(viewer, {
      projectId,
      lineageId: String(form.get("lineageId") || "") || null,
      newLineageName: String(form.get("newLineageName") || "") || null,
      label: String(form.get("label") || file.name).slice(0, 200),
      sourceDate: String(form.get("sourceDate") || "") || null,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ ok: true, result });
  } catch (err) {
    return errorResponse(err);
  }
}
