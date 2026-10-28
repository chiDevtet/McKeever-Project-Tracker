import Link from "next/link";
import { todayInTimeZone } from "@/domain/tz";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { formatHours, formatRange, STATUS_LABELS } from "@/lib/format";
import { prisma } from "@/server/db";
import { requirePageViewer } from "@/server/next-session";
import { loadPlanData } from "@/server/plan-store";
import { listAccessibleProjects } from "@/server/services/projects";
import { summarizePlan } from "@/server/services/summaries";
import { CreateProjectButton } from "./create-project";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const viewer = await requirePageViewer();
  const { need } = await searchParams;
  const projects = await listAccessibleProjects(viewer);
  const rows = await Promise.all(
    projects.map(async (p) => {
      const planId = p.plans[0]?.id;
      const data = planId ? await loadPlanData(prisma, planId) : null;
      return { p, summary: data ? summarizePlan(data, todayInTimeZone(p.timezone)) : null, revision: p.plans[0]?.revision ?? null };
    }),
  );
  const party = (p: (typeof projects)[number], role: string) => p.parties.find((x) => x.role === role)?.organization.name ?? "—";

  return (
    <div>
      <PageHeader title="Projects" description={`${projects.length} project${projects.length === 1 ? "" : "s"} you can access`} actions={viewer.isAdmin ? <CreateProjectButton /> : null} />
      <div className="space-y-4 p-4 sm:p-6">
        {need ? <div className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">Choose a project to open its {need} view.</div> : null}
        {rows.length === 0 ? (
          <EmptyState title="No projects yet">{viewer.isAdmin ? "Create the first project to start planning manpower." : "An administrator has not given you access to a project yet."}</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-background">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">General contractor</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Planned range</th>
                  <th className="px-3 py-2 text-right font-medium">Peak onsite</th>
                  <th className="px-3 py-2 text-right font-medium">Planned hours</th>
                  <th className="px-3 py-2 text-right font-medium">Revision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, summary, revision }) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link href={`/projects/${p.id}/manpower`} className="font-medium text-foreground hover:underline">
                        {p.code}
                      </Link>
                      <div className="text-xs text-muted-foreground">{p.name}</div>
                    </td>
                    <td className="px-3 py-2">{party(p, "CUSTOMER")}</td>
                    <td className="px-3 py-2">{party(p, "GENERAL_CONTRACTOR")}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{STATUS_LABELS[p.status]}</Badge>
                    </td>
                    <td className="px-3 py-2 tabular">{formatRange(summary?.range?.start, summary?.range?.end)}</td>
                    <td className="px-3 py-2 text-right tabular">{summary?.peakTotal ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular">{formatHours(summary?.totalHours ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular">Rev {revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
