import { ManpowerWorkspace } from "@/components/manpower/manpower-workspace";
import { prisma } from "@/server/db";
import { requirePageViewer } from "@/server/next-session";
import { getPlanView } from "@/server/services/plans";

export const metadata = { title: "Manpower" };

export default async function ManpowerPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ plan?: string }> }) {
  const [{ projectId }, { plan }] = await Promise.all([params, searchParams]);
  const viewer = await requirePageViewer();
  const [view, ws] = await Promise.all([getPlanView(viewer, projectId, plan), prisma.workspace.findUniqueOrThrow({ where: { id: viewer.workspaceId } })]);
  return <ManpowerWorkspace key={view.data.plan.id} view={view} workspaceRoles={ws.leadershipRoles} />;
}
