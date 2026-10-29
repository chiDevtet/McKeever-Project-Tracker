import { ReportsWorkspace } from "@/components/reports/reports-workspace";
import { canEdit } from "@/server/authz";
import { prisma } from "@/server/db";
import { requirePageViewer } from "@/server/next-session";
import { getPlanView } from "@/server/services/plans";
import { listPresets, listReports, listReportSources } from "@/server/services/reports";
import { sourceSummary } from "@/server/snapshots";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ plan?: string }> }) {
  const [{ projectId }, { plan }] = await Promise.all([params, searchParams]);
  const viewer = await requirePageViewer();
  const [view, presets, sources, reports, ws, summary] = await Promise.all([
    getPlanView(viewer, projectId, plan),
    listPresets(viewer, projectId),
    listReportSources(viewer, projectId),
    listReports(viewer, projectId),
    prisma.workspace.findUniqueOrThrow({ where: { id: viewer.workspaceId } }),
    sourceSummary(prisma, projectId),
  ]);
  return <ReportsWorkspace projectId={projectId} canEdit={canEdit(viewer, projectId)} companyName={ws.name} viewerName={viewer.name} initialPlan={view.data} sourceSummary={summary} presets={presets} sources={sources} reports={reports} installerRoles={ws.installerRoles} />;
}
