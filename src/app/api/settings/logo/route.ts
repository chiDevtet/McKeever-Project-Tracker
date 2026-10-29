import { viewerFromHeaders } from "@/server/authz";
import { env } from "@/server/env";
import { badRequest } from "@/server/errors";
import { errorResponse, isSameOrigin } from "@/server/rpc/http";
import { setLogo } from "@/server/services/workspace";

export const dynamic = "force-dynamic";

/** Upload (or, with an empty form, remove) the workspace logo. */
export async function POST(req: Request) {
  try {
    if (!isSameOrigin(req, env().APP_URL)) throw badRequest("Cross-site request rejected");
    const viewer = await viewerFromHeaders(req.headers);
    if (!viewer) return Response.json({ ok: false, error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
    const form = await req.formData();
    const file = form.get("file");
    const result = await setLogo(viewer, file instanceof File && file.size > 0 ? { filename: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
    return Response.json({ ok: true, result });
  } catch (err) {
    return errorResponse(err);
  }
}
