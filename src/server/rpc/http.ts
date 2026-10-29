import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/server/errors";

/** Map an error to a JSON response without leaking internals. */
export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ ok: false, error: { code: err.code, message: err.message, details: err.details ?? null } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return Response.json({ ok: false, error: { code: "invalid_input", message: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; "), details: { issues } } }, { status: 400 });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return Response.json({ ok: false, error: { code: "conflict", message: "A record with the same identifying values already exists.", details: null } }, { status: 409 });
  }
  console.error("[rpc] unexpected error", err);
  return Response.json({ ok: false, error: { code: "internal", message: "Something went wrong on the server. Your input was not saved; try again.", details: null } }, { status: 500 });
}

/** Reject cross-site state-changing requests (defense in depth beyond SameSite cookies). */
export function isSameOrigin(req: Request, appUrl: string): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const o = new URL(origin);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return o.host === new URL(appUrl).host || (host !== null && o.host === host);
  } catch {
    return false;
  }
}
