import { ImportsHome } from "@/components/imports/imports-home";
import { canEdit } from "@/server/authz";
import { requirePageViewer } from "@/server/next-session";
import { listImports } from "@/server/services/imports";
import { getPlanView } from "@/server/services/plans";

export const metadata = { title: "Imports" };

export default async function ImportsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ lineage?: string }> }) {
  const [{ projectId }, { lineage }] = await Promise.all([params, searchParams]);
  const viewer = await requirePageViewer();
  const [lists, view] = await Promise.all([listImports(viewer, { projectId }), getPlanView(viewer, projectId)]);
  return <ImportsHome projectId={projectId} lists={lists} plan={view.data} canEdit={canEdit(viewer, projectId)} initialLineage={lineage ?? null} />;
}
