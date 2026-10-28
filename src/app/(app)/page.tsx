import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { DivisionFilters } from "@/components/dashboard/division-filters";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/domain/dates";
import { formatHours, formatRange, STATUS_LABELS } from "@/lib/format";
import { ManpowerChart } from "@/reporting/manpower-chart";
import { requirePageViewer } from "@/server/next-session";
import { divisionForecast } from "@/server/services/division";

export const metadata = { title: "Division dashboard" };

export default async function DivisionDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requirePageViewer();
  const sp = await searchParams;
  const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const result = await divisionForecast(viewer, { from: one(sp.from), to: one(sp.to), projectIds: list(sp.project), role: one(sp.role) });
  const { forecast } = result;
  const peakWeek = forecast.weeks.reduce((best, w) => (w.totalPeak > (best?.totalPeak ?? -1) ? w : best), forecast.weeks[0]);
  const shortages = forecast.weeks.filter((w) => (w.shortage ?? 0) > 0);

  return (
    <div>
      <PageHeader title="Division dashboard" description="Live working plans only. Scenarios enter the forecast only after promotion." />
      <div className="space-y-4 p-4 sm:p-6">
        {result.projects.length === 0 ? (
          <EmptyState title="No accessible projects" action={viewer.isAdmin ? <Link className="underline" href="/projects">Create a project</Link> : undefined}>
            The division view contains only projects you can access.
          </EmptyState>
        ) : (
          <>
            <DivisionFilters projects={result.projects} roles={result.roles} from={result.from} to={result.to} />
            <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
              <section className="rounded-lg border bg-background p-3">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">Combined peak concurrent onsite headcount</h2>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(result.from)} – {formatDate(result.to)} · weeks start Monday
                  </span>
                </div>
                <ManpowerChart
                  weeks={forecast.weeks.map((w) => ({ week: w.week, installerPeak: w.installerPeak, installersAtPeak: w.installersAtPeak, leadershipAtPeak: w.leadershipAtPeak, totalPeak: w.totalPeak, installerHours: w.installerHours, leadershipHours: w.leadershipHours, calendarHours: 0, averageEquivalent: null, limit: w.limit }))}
                  measure="peak"
                />
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Aligned division peak <strong className="text-foreground">{forecast.totals.peakTotal}</strong>
                    {peakWeek ? ` (week of ${formatDate(peakWeek.week)})` : ""}
                  </span>
                  {peakWeek ? <span>Sum of separate project peaks that week: {peakWeek.sumOfProjectPeaks} (not used)</span> : null}
                  <span>Installer hours {formatHours(forecast.totals.installerHours)}</span>
                  <span>Leadership hours {formatHours(forecast.totals.leadershipHours)}</span>
                </div>
              </section>
              <section className="space-y-3">
                <div className="rounded-lg border bg-background p-3 text-sm">
                  <h2 className="mb-1 font-semibold">Workforce availability</h2>
                  {!forecast.availabilitySet ? (
                    <p className="text-muted-foreground">
                      Availability not set. Demand is shown without claiming staffing is sufficient. {viewer.isAdmin ? <Link className="underline" href="/settings#availability">Enter limits</Link> : null}
                    </p>
                  ) : shortages.length ? (
                    <ul className="space-y-1">
                      {shortages.slice(0, 8).map((w) => (
                        <li key={w.week} className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="size-3.5" aria-hidden /> Short {w.shortage} installer{w.shortage === 1 ? "" : "s"} week of {formatDate(w.week)} (limit {w.limit})
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-success">No projected shortage against entered limits.</p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">Anonymous installer pools express project demand; they do not prove that specific employees are available.</p>
                </div>
                <div className="rounded-lg border bg-background p-3 text-sm">
                  <h2 className="mb-1 font-semibold">Named-person conflicts</h2>
                  {forecast.conflicts.length === 0 ? (
                    <p className="text-muted-foreground">No named leader is booked on two projects at the same time.</p>
                  ) : (
                    <ul className="space-y-1">
                      {forecast.conflicts.map((c) => (
                        <li key={c.personKey + c.projects.map((p) => p.projectId).join()} className="flex gap-1 text-warning">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>
                            {c.personName}: {c.projects.map((p) => `${p.code} (${p.role})`).join(" and ")} on {c.days} day(s), {formatDate(c.firstDate)} – {formatDate(c.lastDate)}. Counted once in totals.
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>

            <section className="overflow-x-auto rounded-lg border bg-background">
              <table className="w-full min-w-[60rem] text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Schedule range</th>
                    <th className="px-3 py-2 font-medium">Next milestones</th>
                    <th className="px-3 py-2 text-right font-medium">Peak onsite</th>
                    <th className="px-3 py-2 text-right font-medium">Planned hours</th>
                    <th className="px-3 py-2 text-right font-medium">On hold</th>
                    <th className="px-3 py-2 text-right font-medium">Date conflicts</th>
                  </tr>
                </thead>
                <tbody>
                  {result.summaries.map(({ projectId, code, name, status, revision, summary }) => (
                    <tr key={projectId} className="border-b align-top last:border-0">
                      <td className="px-3 py-2">
                        <Link href={`/projects/${projectId}/manpower`} className="font-medium hover:underline">
                          {code}
                        </Link>{" "}
                        <Badge variant="outline" className="ml-1">
                          {STATUS_LABELS[status]}
                        </Badge>
                        <div className="text-xs text-muted-foreground">
                          {name} · working rev {revision}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular">{formatRange(summary.range?.start, summary.range?.end)}</td>
                      <td className="px-3 py-2 text-xs">
                        {summary.nextMilestones.length === 0 ? <span className="text-muted-foreground">None upcoming</span> : null}
                        {summary.nextMilestones.slice(0, 3).map((m) => (
                          <div key={m.code + m.date + m.phase}>
                            {m.phase ? `${m.phase} ` : ""}
                            {m.code} {formatDate(m.date)}
                            {m.confirmed ? "" : <span className="text-muted-foreground"> (candidate)</span>}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right tabular">{summary.peakTotal}</td>
                      <td className="px-3 py-2 text-right tabular">{formatHours(summary.totalHours)}</td>
                      <td className="px-3 py-2 text-right tabular">{summary.onHold}</td>
                      <td className="px-3 py-2 text-right tabular">{summary.dateConflicts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
