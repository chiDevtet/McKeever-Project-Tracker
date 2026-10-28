import { computePlanningIssues } from "@/domain/issues";
import { computeMeasures, planDateRange } from "@/domain/metrics";
import type { PlanData } from "@/domain/plan";

export interface PlanSummary {
  range: { start: string; end: string } | null;
  peakTotal: number;
  peakInstallers: number;
  peakLeadership: number;
  installerHours: number;
  leadershipHours: number;
  totalHours: number;
  onHold: number;
  issues: { error: number; warning: number; info: number };
  dateConflicts: number;
  nextMilestones: { code: string; name: string; phase: string | null; date: string; confirmed: boolean }[];
}

/** Headline numbers for a plan, computed by the shared engine. */
export function summarizePlan(data: PlanData, today: string): PlanSummary {
  const range = planDateRange(data);
  const m = range ? computeMeasures(data, range.start, range.end) : null;
  const issues = computePlanningIssues(data);
  const phases = new Map(data.phases.map((p) => [p.id, p.name]));
  const nextMilestones = data.milestones
    .map((ms) => ({ ms, date: ms.date ?? ms.candidates.find((c) => c.date)?.date ?? null }))
    .filter((x): x is { ms: (typeof data.milestones)[number]; date: string } => Boolean(x.date && x.date >= today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)
    .map(({ ms, date }) => ({ code: ms.code, name: ms.name, phase: ms.phaseId ? (phases.get(ms.phaseId) ?? null) : null, date, confirmed: ms.reviewStatus === "CONFIRMED" }));
  return {
    range,
    peakTotal: m?.totals.peakTotal ?? 0,
    peakInstallers: m?.totals.peakInstallers ?? 0,
    peakLeadership: m?.totals.peakLeadership ?? 0,
    installerHours: m?.totals.installerHours ?? 0,
    leadershipHours: m?.totals.leadershipHours ?? 0,
    totalHours: m?.totals.totalHours ?? 0,
    onHold: data.progress.filter((p) => p.status === "ON_HOLD").length,
    issues: {
      error: issues.filter((i) => i.severity === "error").length,
      warning: issues.filter((i) => i.severity === "warning").length,
      info: issues.filter((i) => i.severity === "info").length,
    },
    dateConflicts: issues.filter((i) => ["source-window", "milestone-missed", "link-violation", "closed-day"].includes(i.category)).length,
    nextMilestones,
  };
}
