import { cookies } from "next/headers";
import { AppSidebar, MobileTopBar, type Branding } from "@/components/shell/app-nav";
import { prisma } from "@/server/db";
import { requirePageViewer } from "@/server/next-session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePageViewer();
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: viewer.workspaceId } });
  const lastProjectId = (await cookies()).get("fieldops_project")?.value ?? null;
  const branding: Branding = { appName: ws.appDisplayName, companyName: ws.name, logoUrl: ws.logoFileId ? `/api/files/${ws.logoFileId}` : null };
  const navProps = { branding, userName: viewer.name, lastProjectId };
  // Brand on :root so derived tokens (primary, focus ring, brand lines) and portaled dialogs use it.
  const brand = /^#[0-9a-fA-F]{6}$/.test(ws.brandColor) ? ws.brandColor : null;
  return (
    <div className="flex min-h-dvh">
      {brand ? <style>{`:root{--brand:${brand}}`}</style> : null}
      <AppSidebar {...navProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar {...navProps} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
