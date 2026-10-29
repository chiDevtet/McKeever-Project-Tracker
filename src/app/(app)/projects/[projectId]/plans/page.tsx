import { PlansWorkspace } from "@/components/history/plans-workspace";
import { canEdit } from "@/server/authz";
import { requirePageViewer } from "@/server/next-session";
import { getHistory } from "@/server/services/history";

export const metadata = { title: "Plans & history" };

export default async function PlansPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const viewer = await requirePageViewer();
  const history = await getHistory(viewer, projectId);
  return <PlansWorkspace projectId={projectId} history={history} canEdit={canEdit(viewer, projectId)} />;
}
