import { ScheduleWorkspace } from "@/components/schedule/schedule-workspace";
import { requirePageViewer } from "@/server/next-session";
import { getPlanView } from "@/server/services/plans";

export const metadata = { title: "Schedule" };

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ plan?: string }> }) {
  const [{ projectId }, { plan }] = await Promise.all([params, searchParams]);
  const viewer = await requirePageViewer();
  const view = await getPlanView(viewer, projectId, plan);
  return <ScheduleWorkspace key={view.data.plan.id} view={view} />;
}
