import { viewerFromHeaders } from "@/server/authz";
import { errorResponse } from "@/server/rpc/http";
import { readPreviewPage } from "@/server/services/imports";

export const dynamic = "force-dynamic";

/** Access-checked rendered page preview for import review. */
export async function GET(req: Request, ctx: { params: Promise<{ sessionId: string; page: string }> }) {
  try {
    const viewer = await viewerFromHeaders(req.headers);
    if (!viewer) return Response.json({ ok: false, error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
    const { sessionId, page } = await ctx.params;
    const bytes = await readPreviewPage(viewer, { sessionId, page: Number(page) });
    return new Response(Buffer.from(bytes), {
      headers: { "content-type": "image/png", "content-length": String(bytes.byteLength), "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
