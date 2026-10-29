import { viewerFromHeaders } from "@/server/authz";
import { env } from "@/server/env";
import { procedures } from "@/server/rpc/procedures";
import { errorResponse, isSameOrigin } from "@/server/rpc/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ procedure: string }> }) {
  const { procedure } = await ctx.params;
  if (!Object.hasOwn(procedures, procedure)) {
    return Response.json({ ok: false, error: { code: "not_found", message: `Unknown operation ${procedure}`, details: null } }, { status: 404 });
  }
  if (!isSameOrigin(req, env().APP_URL)) {
    return Response.json({ ok: false, error: { code: "forbidden", message: "Cross-site request rejected", details: null } }, { status: 403 });
  }
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ ok: false, error: { code: "bad_request", message: "Expected application/json", details: null } }, { status: 415 });
  }
  try {
    const viewer = await viewerFromHeaders(req.headers);
    if (!viewer) return Response.json({ ok: false, error: { code: "unauthenticated", message: "Sign in to continue.", details: null } }, { status: 401 });
    const input: unknown = await req.json().catch(() => ({}));
    const result = await procedures[procedure as keyof typeof procedures](viewer, input as never);
    return Response.json({ ok: true, result: result ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
