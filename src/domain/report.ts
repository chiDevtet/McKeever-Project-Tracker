/**
 * Report settings and the report dataset. Every export (screen preview, PDF,
 * Excel) is rendered from one dataset built here from a frozen PlanData
 * snapshot, so totals, dates, chart series, and leadership agree everywhere.
 * Labor that is not allocated is reported as "not allocated" (null), never as
 * zero, and never spread across phases or systems.
 */

import { z } from "zod";
import { buildTree, effectiveTargets, isAreaWithin, topmostMatching, type EffectiveTargets } from "./capacity";
import { addDays, formatDate, isISODate, maxDate, minDate, startOfWeek, WEEKDAY_SHORT, type ISODate } from "./dates";
import { computePlanningIssues, type PlanningIssue } from "./issues";
import { computeMeasures, measureWindow, planDateRange, type Interval, type MeasureFilter, type PeriodMeasure } from "./metrics";
import type { LeadershipInput, NodeInput, PlanData } from "./plan";
import { defaultCalendar } from "./plan";
import { workingDuration } from "./schedule";
import { expandAllNodes, expandLeadership } from "./staffing";
import { localMidnightMs } from "./tz";

const isoDate = z.string().refine(isISODate, "Expected a date");

export const DETAIL_LEVELS = { PROJECT_SUMMARY: "Project summary", PHASE_OVERVIEW: "Phase overview", AREA_BREAKDOWN: "ROMP / area breakdown", ACTIVITY_DETAIL: "Detailed activities" } as const;
export const PRESENTATIONS = { CHART: "Manpower chart", TABLE: "Staffing table", TIMELINE: "Schedule timeline", COMBINED: "Combined report" } as const;

export const reportSettingsSchema = z.object({
  title: z.string().trim().min(1).max(200).default("Preliminary manpower plan"),
  detail: z.enum(["PROJECT_SUMMARY", "PHASE_OVERVIEW", "AREA_BREAKDOWN", "ACTIVITY_DETAIL"]).default("PHASE_OVERVIEW"),
  presentation: z.enum(["CHART", "TABLE", "TIMELINE", "COMBINED"]).default("COMBINED"),
  formats: z.array(z.enum(["PDF", "XLSX"])).min(1).default(["PDF", "XLSX"]),
  orientation: z.enum(["AUTO", "PORTRAIT", "LANDSCAPE"]).default("AUTO"),
  period: z.object({ from: isoDate.nullable().default(null), to: isoDate.nullable().default(null) }).default({ from: null, to: null }),
  filters: z
    .object({
      phaseIds: z.array(z.string()).default([]),
      areaIds: z.array(z.string()).default([]),
      systemIds: z.array(z.string()).default([]),
      /** Installer roles and/or "leadership"; empty = all. */
      roles: z.array(z.string()).default([]),
    })
    .default({ phaseIds: [], areaIds: [], systemIds: [], roles: [] }),
  contents: z
    .object({
      leadershipNames: z.boolean().default(true),
      milestones: z.boolean().default(true),
      unconfirmedMilestones: z.boolean().default(true),
      assumptions: z.boolean().default(true),
      notes: z.boolean().default(false),
      allocationDetail: z.boolean().default(true),
      averageEquivalent: z.boolean().default(false),
      hours: z.boolean().default(true),
    })
    .default({ leadershipNames: true, milestones: true, unconfirmedMilestones: true, assumptions: true, notes: false, allocationDetail: true, averageEquivalent: false, hours: true }),
  measure: z.enum(["peak", "hours", "average"]).default("peak"),
  assumptions: z.string().max(4000).default(""),
  exclusions: z.string().max(4000).default(""),
  datesToConfirm: z.string().max(4000).default(""),
  preparedBy: z.string().max(120).nullable().default(null),
});
export type ReportSettings = z.infer<typeof reportSettingsSchema>;
export type ReportSettingsInput = z.input<typeof reportSettingsSchema>;

export function defaultReportSettings(): ReportSettings {
  return reportSettingsSchema.parse({});
}

export interface LaborSummary {
  peak: number;
  hours: number;
}

export interface ReportIdentity {
  company: string;
  projectCode: string;
  projectName: string;
  customer: string | null;
  generalContractor: string | null;
  owner: string | null;
  title: string;
  preparedBy: string;
  generatedAt: string;
  period: { from: ISODate; to: ISODate };
  planLabel: string;
  planKind: "WORKING" | "SCENARIO";
  planRevision: number;
  snapshotId: string | null;
  snapshotName: string | null;
  sources: { label: string; detail: string }[];
  calendarBasis: string;
  timezone: string;
  exploratory: boolean;
}

export interface ReportDataset {
  version: 1;
  identity: ReportIdentity;
  settings: ReportSettings;
  filterDescription: string;
  isAllocationView: boolean;
  /** Allocation view with no labor allocated at all: report "not allocated", never zero demand. */
  allocationEmpty: boolean;
  allocationNote: string | null;
  weeks: (PeriodMeasure & { week: ISODate })[];
  totals: { peakTotal: number; peakInstallers: number; peakLeadership: number; installerHours: number; leadershipHours: number; totalHours: number };
  phases: {
    id: string;
    name: string;
    areas: string[];
    window: { start: ISODate | null; finish: ISODate | null };
    scheduled: { start: ISODate | null; finish: ISODate | null };
    milestones: { code: string; date: ISODate | null; confirmed: boolean }[];
    labor: LaborSummary | null;
  }[];
  areas: { id: string; name: string; kind: string; depth: number; phases: string[]; labor: LaborSummary | null }[];
  activities: {
    key: string;
    code: string;
    name: string;
    phase: string | null;
    area: string | null;
    system: string;
    start: ISODate;
    finish: ISODate;
    workingDays: number;
    status: string;
    percent: number | null;
    actualStart: ISODate | null;
    actualFinish: ISODate | null;
    labor: LaborSummary | null;
    source: string | null;
    costCode: string | null;
    notes: string | null;
  }[];
  systems: { id: string; name: string; labor: LaborSummary | null }[];
  unallocatedToSystem: LaborSummary | null;
  leadership: { name: string; role: string; responsibility: string; dates: string; onsite: string; offsite: string; isPlaceholder: boolean; onsiteHours: number }[];
  milestones: { phase: string; code: string; name: string; date: ISODate | null; status: string; sources: string }[];
  issues: PlanningIssue[];
  basis: { label: string; value: string }[];
}

export interface DatasetContext {
  companyName: string;
  preparedBy: string;
  generatedAt: string;
  snapshotId: string | null;
  snapshotName: string | null;
  sources: { label: string; detail: string }[];
}

const STATUS_TEXT: Record<string, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETE: "Complete", ON_HOLD: "On hold" };

function laborFor(intervals: Interval[], ws: number, we: number): LaborSummary | null {
  if (!intervals.length) return null;
  const m = measureWindow(intervals, [], ws, we);
  return { peak: m.installerPeak, hours: Math.round(m.installerHours * 100) / 100 };
}

function describeOnsite(l: LeadershipInput): string {
  if (!l.startDate || !l.endDate) return "Onsite dates not selected (not counted)";
  const days = l.onsiteMode === "PROJECT_CALENDAR" ? "every open project day" : l.onsiteWeekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(", ");
  const hours = l.onsiteHours ? `${l.onsiteHours} h/day` : "calendar hours";
  const exc = l.dayOverrides.length ? `; ${l.dayOverrides.length} day exception(s)` : "";
  return `${days}, ${hours}${exc}`;
}

export function buildReportDataset(data: PlanData, settings: ReportSettings, ctx: DatasetContext): ReportDataset {
  const tree = buildTree(data.nodes);
  const eff = effectiveTargets(data, tree);
  const blocks = expandAllNodes(data);
  const areas = new Map(data.areas.map((a) => [a.id, a]));
  const phases = new Map(data.phases.map((p) => [p.id, p]));
  const systems = new Map(data.systems.map((s) => [s.id, s]));
  const cal = defaultCalendar(data);
  const tz = cal.timezone;

  const range = planDateRange(data);
  const fallback = startOfWeek(ctx.generatedAt.slice(0, 10));
  const from = startOfWeek(settings.period.from ?? range?.start ?? fallback);
  let to = startOfWeek(settings.period.to ?? range?.end ?? addDays(fallback, 7 * 12));
  if (to < from) to = from;
  const ws = localMidnightMs(from, tz);
  const we = localMidnightMs(addDays(to, 7), tz);

  const f = settings.filters;
  const installerRoles = f.roles.filter((r) => r !== "leadership");
  const includeLeadership = f.roles.length === 0 || f.roles.includes("leadership");
  const includeInstallers = f.roles.length === 0 || installerRoles.length > 0;
  const targetFilterActive = f.phaseIds.length > 0 || f.areaIds.length > 0 || f.systemIds.length > 0;
  const matchesTargets = (t: EffectiveTargets) =>
    (!f.phaseIds.length || (t.phaseId !== null && f.phaseIds.includes(t.phaseId))) &&
    (!f.systemIds.length || (t.systemId !== null && f.systemIds.includes(t.systemId))) &&
    (!f.areaIds.length || (t.areaId !== null && f.areaIds.some((a) => isAreaWithin(areas, t.areaId!, a))));
  const leaderMatches = (l: LeadershipInput) =>
    (!f.systemIds.length || l.responsibilitySystemIds.length === 0 || l.responsibilitySystemIds.some((s) => f.systemIds.includes(s))) &&
    (!f.phaseIds.length || l.responsibilityPhaseIds.length === 0 || l.responsibilityPhaseIds.some((p) => f.phaseIds.includes(p)));

  const filter: MeasureFilter = {
    roles: includeInstallers ? (installerRoles.length ? installerRoles : undefined) : [],
    includeLeadership,
    leadership: leaderMatches,
    allocation: targetFilterActive ? (t) => matchesTargets(t) : undefined,
  };
  const measures = computeMeasures(data, from, to, filter);

  // Labor of topmost nodes matching a predicate (an allocation view; never additive across groups).
  const roleOk = (n: NodeInput) => !installerRoles.length || installerRoles.includes(eff.get(n.key)!.role);
  const allocated = (pred: (t: EffectiveTargets) => boolean): LaborSummary | null => {
    if (!includeInstallers) return null;
    const keys = topmostMatching(tree, (k) => {
      const n = tree.byKey.get(k)!;
      return n.kind !== "POOL" && roleOk(n) && pred(eff.get(k)!);
    });
    const ivs = keys.flatMap((k) => (blocks.get(k) ?? []).map((b) => ({ startMs: b.startMs, endMs: b.endMs, count: b.headcount })));
    return laborFor(ivs, ws, we);
  };

  const activeActs = data.activities.filter((a) => !a.archived);
  const phaseRows = data.phases
    .filter((p) => !f.phaseIds.length || f.phaseIds.includes(p.id))
    .map((p) => {
      const acts = activeActs.filter((a) => a.phaseId === p.id);
      const w = data.phaseWindows.find((x) => x.phaseId === p.id);
      return {
        id: p.id,
        name: p.name,
        areas: p.areaIds.map((id) => areas.get(id)?.name).filter(Boolean) as string[],
        window: { start: w?.start ?? null, finish: w?.finish ?? null },
        scheduled: { start: minDate(...acts.map((a) => a.plannedStart)), finish: maxDate(...acts.map((a) => a.plannedFinish)) },
        milestones: data.milestones
          .filter((m) => m.phaseId === p.id && (settings.contents.unconfirmedMilestones || m.reviewStatus === "CONFIRMED"))
          .map((m) => ({ code: m.code, date: m.date ?? m.candidates.find((c) => c.date)?.date ?? null, confirmed: m.reviewStatus === "CONFIRMED" })),
        labor: allocated((t) => t.phaseId === p.id && matchesTargets(t)),
      };
    });

  const areaRows: ReportDataset["areas"] = [];
  const visitArea = (parentId: string | null, depth: number) => {
    for (const a of data.areas.filter((x) => x.parentId === parentId).sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name))) {
      if (!f.areaIds.length || f.areaIds.some((id) => isAreaWithin(areas, a.id, id))) {
        areaRows.push({
          id: a.id,
          name: a.name,
          kind: a.kind,
          depth,
          phases: data.phases.filter((p) => p.areaIds.includes(a.id)).map((p) => p.name),
          labor: allocated((t) => t.areaId !== null && isAreaWithin(areas, t.areaId, a.id) && matchesTargets(t)),
        });
      }
      visitArea(a.id, depth + 1);
    }
  };
  visitArea(null, 0);

  const progress = new Map(data.progress.map((p) => [p.activityKey, p]));
  const activityRows = activeActs
    .filter((a) => (!f.phaseIds.length || (a.phaseId && f.phaseIds.includes(a.phaseId))) && (!f.systemIds.length || (a.systemId && f.systemIds.includes(a.systemId))) && (!f.areaIds.length || (a.areaId && f.areaIds.some((id) => isAreaWithin(areas, a.areaId!, id)))))
    .filter((a) => a.plannedFinish >= from && a.plannedStart <= addDays(to, 6))
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart) || a.code.localeCompare(b.code))
    .map((a) => {
      const p = progress.get(a.key);
      const src = data.sourceWindows.filter((s) => s.activityKey === a.key).map((s) => `${s.externalId}${s.removed ? " (removed)" : ""}`);
      return {
        key: a.key,
        code: a.code,
        name: a.name,
        phase: a.phaseId ? (phases.get(a.phaseId)?.name ?? null) : null,
        area: a.areaId ? (areas.get(a.areaId)?.name ?? null) : null,
        system: a.systemId ? (systems.get(a.systemId)?.name ?? "—") : "Shared systems",
        start: a.plannedStart,
        finish: a.plannedFinish,
        workingDays: workingDuration(data, a),
        status: STATUS_TEXT[p?.status ?? "NOT_STARTED"],
        percent: p?.percentComplete ?? null,
        actualStart: p?.actualStart ?? null,
        actualFinish: p?.actualFinish ?? null,
        labor: allocated((t) => t.activityKey === a.key),
        source: src.length ? src.join(", ") : null,
        costCode: a.costCode ?? null,
        notes: settings.contents.notes ? a.notes : null,
      };
    });

  const systemRows = data.systems
    .filter((s) => !f.systemIds.length || f.systemIds.includes(s.id))
    .map((s) => ({ id: s.id, name: s.name, labor: allocated((t) => t.systemId === s.id && matchesTargets(t)) }));
  const unallocatedToSystem = f.systemIds.length ? allocated((t) => t.systemId === null && (!f.phaseIds.length || (t.phaseId !== null && f.phaseIds.includes(t.phaseId)))) : null;

  const leadershipRows = includeLeadership
    ? data.leadership
        .filter(leaderMatches)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l) => {
          const scope = [...l.responsibilitySystemIds.map((id) => systems.get(id)?.name), ...l.responsibilityPhaseIds.map((id) => phases.get(id)?.name)].filter(Boolean).join(", ");
          const hours = expandLeadership(data, l).reduce((s, b) => s + Math.max(0, Math.min(b.endMs, we) - Math.max(b.startMs, ws)) / 3_600_000, 0);
          return {
            name: settings.contents.leadershipNames ? (l.personId ? l.personName : "TBD") : l.role,
            role: l.role,
            responsibility: scope || l.responsibilityNote || "Whole project",
            dates: l.startDate && l.endDate ? `${formatDate(l.startDate)} – ${formatDate(l.endDate)}` : "Not selected",
            onsite: describeOnsite(l),
            offsite: l.offsiteHoursPerWeek ? `${l.offsiteHoursPerWeek} h/week offsite (not in onsite totals)` : "—",
            isPlaceholder: !l.personId,
            onsiteHours: Math.round(hours * 100) / 100,
          };
        })
    : [];

  const milestoneRows = settings.contents.milestones
    ? data.milestones
        .filter((m) => (!f.phaseIds.length || !m.phaseId || f.phaseIds.includes(m.phaseId)) && (settings.contents.unconfirmedMilestones || m.reviewStatus === "CONFIRMED"))
        .map((m) => ({
          phase: m.phaseId ? (phases.get(m.phaseId)?.name ?? "") : "Project",
          code: m.code,
          name: m.name,
          date: m.date ?? m.candidates.find((c) => c.date)?.date ?? null,
          status: m.reviewStatus === "CONFIRMED" ? "Confirmed" : "Candidate — needs review",
          sources: m.candidates.map((c) => `${c.date ? formatDate(c.date) : "unspecified"} (${c.label})`).join("; "),
        }))
    : [];

  const filterParts = [
    f.phaseIds.length ? `Phases: ${f.phaseIds.map((id) => phases.get(id)?.name).join(", ")}` : null,
    f.areaIds.length ? `Areas: ${f.areaIds.map((id) => areas.get(id)?.name).join(", ")}` : null,
    f.systemIds.length ? `Systems: ${f.systemIds.map((id) => systems.get(id)?.name).join(", ")}` : null,
    f.roles.length ? `Roles: ${f.roles.map((r) => (r === "leadership" ? "Leadership" : r)).join(", ")}` : null,
  ].filter(Boolean) as string[];

  const def = cal.definition;
  const openDays = def.weekPattern.map((d, i) => (d.open ? `${WEEKDAY_SHORT[i]} ${d.hours}h` : null)).filter(Boolean).join(", ");
  const calendarBasis = `${cal.name}: ${openDays}; ${def.periods.length} effective-dated period(s), ${def.exceptions.length} dated exception(s); weeks start Monday; ${tz}`;

  return {
    version: 1,
    identity: {
      company: ctx.companyName,
      projectCode: data.project.code,
      projectName: data.project.name,
      customer: data.project.customer,
      generalContractor: data.project.generalContractor,
      owner: data.project.owner,
      title: settings.title,
      preparedBy: settings.preparedBy || ctx.preparedBy,
      generatedAt: ctx.generatedAt,
      period: { from, to: addDays(to, 6) },
      planLabel: data.plan.kind === "WORKING" ? `Working plan revision ${data.plan.revision}` : `Scenario “${data.plan.name}” revision ${data.plan.revision}`,
      planKind: data.plan.kind,
      planRevision: data.plan.revision,
      snapshotId: ctx.snapshotId,
      snapshotName: ctx.snapshotName,
      sources: ctx.sources,
      calendarBasis,
      timezone: tz,
      exploratory: data.plan.kind === "SCENARIO",
    },
    settings,
    filterDescription: filterParts.length ? filterParts.join(" · ") : "All project labor",
    isAllocationView: measures.isAllocationView,
    allocationEmpty: measures.isAllocationView && measures.installerIntervals.length === 0,
    allocationNote: !measures.isAllocationView
      ? null
      : measures.installerIntervals.length === 0
        ? `Installer labor is not allocated to ${filterParts.join(" · ")}. This means no allocation has been entered, not zero demand; project labor is reported without this filter.`
        : `Installer figures are an allocation view (${filterParts.join(" · ")}): labor explicitly allocated to the filter. They do not represent all project labor.`,
    weeks: measures.weeks.map((w) => ({ ...w, week: w.start })),
    totals: {
      peakTotal: measures.totals.peakTotal,
      peakInstallers: measures.totals.peakInstallers,
      peakLeadership: measures.totals.peakLeadership,
      installerHours: measures.totals.installerHours,
      leadershipHours: measures.totals.leadershipHours,
      totalHours: measures.totals.totalHours,
    },
    phases: phaseRows,
    areas: areaRows,
    activities: activityRows,
    systems: systemRows,
    unallocatedToSystem,
    leadership: leadershipRows,
    milestones: milestoneRows,
    issues: computePlanningIssues(data),
    basis: [
      { label: "Peak concurrent onsite headcount", value: "Most people onsite at the same instant in the week. Installers come from workforce pool capacity; each leader counts once at any instant. Not a sum of daily headcounts, not unique visitors, not FTE." },
      { label: "Chart composition", value: "Columns show installers and leadership at the instant of the weekly combined peak, so the column height is the true combined peak." },
      { label: "Planned labor hours", value: "Headcount × scheduled block hours, attributed to the week and date in which the hours occur. Offsite management hours are excluded." },
      { label: "Average equivalent onsite staffing", value: "Onsite person-hours ÷ project calendar open hours in the week; not applicable when the calendar has no open hours." },
      { label: "Allocations", value: "Phase, area, system, and activity figures subdivide project capacity. They are never added to the project total; unallocated labor is shown as not allocated, not as zero." },
      { label: "Calendar basis", value: calendarBasis },
      { label: "Dates", value: "Construction dates are calendar dates (DD Mon YYYY). Staffing times are local to the project timezone." },
    ],
  };
}
