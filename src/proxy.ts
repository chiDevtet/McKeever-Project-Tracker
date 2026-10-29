import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for signed-out visitors. This only checks for a session
 * cookie; every page, route handler, and file download still validates the
 * session and permissions on the server.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|forgot-password|reset-password|accept-invite|dev/outbox|_next|favicon.ico|robots.txt).*)"],
};
