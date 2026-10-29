import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { viewerFromHeaders, type Viewer } from "@/server/authz";

/** Viewer for the current request (memoized per render). */
export const currentViewer = cache(async (): Promise<Viewer | null> => viewerFromHeaders(await headers()));

/** For pages: redirect to sign-in when there is no valid session. */
export async function requirePageViewer(): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  return viewer;
}
