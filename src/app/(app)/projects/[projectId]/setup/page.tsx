import { SetupWorkspace } from "@/components/setup/setup-workspace";
import { canEdit } from "@/server/authz";
import { requirePageViewer } from "@/server/next-session";
import { getPlanView } from "@/server/services/plans";
import { getSetup } from "@/server/services/structure";

export const metadata = { title: "Project setup" };

export default async function SetupPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ plan?: string }> }) {
  const [{ projectId }, { plan }] = await Promise.all([params, searchParams]);
  const viewer = await requirePageViewer();
  const [setup, view] = await Promise.all([getSetup(viewer, projectId), getPlanView(viewer, projectId, plan)]);
  return <SetupWorkspace key={`${view.data.plan.id}:${view.data.plan.revision}`} setup={setup} view={view} canEdit={canEdit(viewer, projectId)} />;
}
