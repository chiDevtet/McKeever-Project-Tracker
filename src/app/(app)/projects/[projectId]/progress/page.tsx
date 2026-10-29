import { ProgressWorkspace } from "@/components/progress/progress-workspace";
import { canEdit } from "@/server/authz";
import { requirePageViewer } from "@/server/next-session";
import { getProgressView } from "@/server/services/progress";

export const metadata = { title: "Progress" };

export default async function ProgressPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const viewer = await requirePageViewer();
  const view = await getProgressView(viewer, projectId);
  return <ProgressWorkspace view={view} projectId={projectId} canEdit={canEdit(viewer, projectId)} />;
}
