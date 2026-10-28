import { acceptInvitation } from "@/server/services/users";
import { env } from "@/server/env";
import { errorResponse, isSameOrigin } from "@/server/rpc/http";

export const dynamic = "force-dynamic";

/** Accept an invitation (unauthenticated: the one-time token is the credential). */
export async function POST(req: Request) {
  if (!isSameOrigin(req, env().APP_URL)) return Response.json({ ok: false, error: { code: "forbidden", message: "Cross-site request rejected" } }, { status: 403 });
  try {
    const result = await acceptInvitation(await req.json());
    return Response.json({ ok: true, result });
  } catch (err) {
    return errorResponse(err);
  }
}
