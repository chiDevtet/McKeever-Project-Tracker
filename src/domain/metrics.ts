/**
 * Labor measures. Definitions (also printed on every report basis):
 *
 * - Peak concurrent onsite headcount: the maximum number of people onsite at
 *   the same instant within the period. Installers come from workforce pool
 *   capacity; leadership counts each person once at any instant regardless of
 *   how many responsibilities they hold. Not a sum of daily headcounts, not
 *   unique visitors across the week, not FTE.
 * - Planned labor hours: sum of headcount x scheduled block hours, attributed
 *   to the reporting period in which the hours occur (an overnight shift keeps
 *   its shift-start date but its hours split at local midnight).
 * - Average equivalent onsite staffing (optional): onsite person-hours divided
 *   by the project calendar's open hours in the period. Not applicable (null)
 *   when the calendar has zero open hours.
 */

import { buildTree, effectiveTargets, topmostMatching, type EffectiveTargets, type NodeTree } from "./capacity";
import { addDays, eachDay, eachWeek, startOfWeek, type ISODate } from "./dates";
import type { LeadershipInput, NodeInput, PlanData } from "./plan";
import { expandAllNodes, leadershipByPerson, projectResolver, type Block } from "./staffing";
import { HOUR_MS, localMidnightMs, overlapMs } from "./tz";

export interface Interval {
  startMs: number;
  endMs: number;
  count: number;
}

export interface PeriodMeasure {
  start: ISODate;
  end: ISODate;
  openDays: number;
  calendarHours: number;
  installerPeak: number;
  leadershipPeak: number;
  totalPeak: number;
  /** Composition at the first instant the total peak occurs. */
  installersAtPeak: number;
  leadershipAtPeak: number;
  installerHours: number;
  leadershipHours: number;
  totalHours: number;
  /** Onsite person-hours / calendar hours; null when calendar hours are zero. */
  averageEquivalent: number | null;
}

export interface MeasureFilter {
  /** Restrict installer labor to an allocation view (topmost matching nodes). */
  allocation?: (targets: EffectiveTargets, node: NodeInput) => boolean;
  /** Installer roles to include (pool role); undefined = all. */
  roles?: string[];
  /** Include leadership series. */
  includeLeadership?: boolean;
  /** Restrict leadership assignments. */
  leadership?: (l: LeadershipInput) => boolean;
}

export interface PlanMeasures {
  weeks: PeriodMeasure[];
  days: PeriodMeasure[];
  totals: { installerHours: number; leadershipHours: number; totalHours: number; peakTotal: number; peakInstallers: number; peakLeadership: number };
  installerIntervals: Interval[];
  leadershipIntervals: Interval[];
  /** True when installer labor is an allocation view rather than total project staffing. */
  isAllocationView: boolean;
}

/** Peak concurrency and hours of two series within [ws, we). */
export function measureWindow(installers: Interval[], leaders: Interval[], ws: number, we: number) {
  const events: { t: number; di: number; dl: number }[] = [];
  let installerHours = 0;
  let leadershipHours = 0;
  for (const iv of installers) {
    const o = overlapMs(iv.startMs, iv.endMs, ws, we);
    if (o <= 0) continue;
    installerHours += (o / HOUR_MS) * iv.count;
    events.push({ t: Math.max(iv.startMs, ws), di: iv.count, dl: 0 }, { t: Math.min(iv.endMs, we), di: -iv.count, dl: 0 });
  }
  for (const iv of leaders) {
    const o = overlapMs(iv.startMs, iv.endMs, ws, we);
    if (o <= 0) continue;
    leadershipHours += (o / HOUR_MS) * iv.count;
    events.push({ t: Math.max(iv.startMs, ws), di: 0, dl: iv.count }, { t: Math.min(iv.endMs, we), di: 0, dl: -iv.count });
  }
  events.sort((a, b) => a.t - b.t);
  let inst = 0;
  let lead = 0;
  let installerPeak = 0;
  let leadershipPeak = 0;
  let totalPeak = 0;
  let installersAtPeak = 0;
  let leadershipAtPeak = 0;
  let i = 0;
  while (i < events.length) {
    const t = events[i].t;
    while (i < events.length && events[i].t === t) {
      inst += events[i].di;
      lead += events[i].dl;
      i++;
    }
    const next = i < events.length ? events[i].t : t;
    if (next <= t) continue;
    installerPeak = Math.max(installerPeak, inst);
    leadershipPeak = Math.max(leadershipPeak, lead);
    if (inst + lead > totalPeak) {
      totalPeak = inst + lead;
      installersAtPeak = inst;
      leadershipAtPeak = lead;
    }
  }
  return { installerPeak, leadershipPeak, totalPeak, installersAtPeak, leadershipAtPeak, installerHours, leadershipHours };
}

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Installer intervals for an unfiltered or allocation view. */
export function installerIntervals(data: PlanData, blocks: Map<string, Block[]>, tree: NodeTree, filter: MeasureFilter = {}): { intervals: Interval[]; isAllocationView: boolean } {
  const roleOk = (n: NodeInput, eff: EffectiveTargets) => !filter.roles || filter.roles.includes(eff.role ?? n.role);
  const eff = effectiveTargets(data, tree);
  let keys: string[];
  if (filter.allocation) {
    const pred = filter.allocation;
    keys = topmostMatching(tree, (k) => {
      const n = tree.byKey.get(k)!;
      const e = eff.get(k)!;
      return n.kind !== "POOL" && roleOk(n, e) && pred(e, n);
    });
  } else {
    keys = tree.roots.filter((k) => {
      const n = tree.byKey.get(k)!;
      return n.kind === "POOL" && roleOk(n, eff.get(k)!);
    });
  }
  const intervals: Interval[] = [];
  for (const k of keys) for (const b of blocks.get(k) ?? []) intervals.push({ startMs: b.startMs, endMs: b.endMs, count: b.headcount });
  return { intervals, isAllocationView: Boolean(filter.allocation) };
}

export function leadershipIntervals(data: PlanData, filter: MeasureFilter = {}): Interval[] {
  if (filter.includeLeadership === false) return [];
  return leadershipByPerson(data, undefined, undefined, filter.leadership).flatMap((p) => p.intervals.map((iv) => ({ ...iv, count: 1 })));
}

/** Date range covered by any staffing, leadership, activity, or phase window. */
export function planDateRange(data: PlanData): { start: ISODate; end: ISODate } | null {
  let start: ISODate | null = null;
  let end: ISODate | null = null;
  const take = (d: ISODate | null | undefined) => {
    if (!d) return;
    if (!start || d < start) start = d;
    if (!end || d > end) end = d;
  };
  for (const e of data.entries) {
    take(e.date);
    if (e.kind === "WEEK") take(addDays(e.date, 6));
    if (e.kind === "BLOCK") take(addDays(e.date, 1));
  }
  for (const l of data.leadership) {
    take(l.startDate);
    take(l.endDate);
  }
  for (const a of data.activities) {
    if (a.archived) continue;
    take(a.plannedStart);
    take(a.plannedFinish);
  }
  for (const w of data.phaseWindows) {
    take(w.start);
    take(w.finish);
  }
  if (!start || !end) return null;
  return { start, end };
}

/** Weekly and daily measures over [from, to] (whole reporting weeks). */
export function computeMeasures(data: PlanData, from: ISODate, to: ISODate, filter: MeasureFilter = {}, opts: { days?: boolean } = {}): PlanMeasures {
  const tree = buildTree(data.nodes);
  const blocks = expandAllNodes(data);
  const { intervals: inst, isAllocationView } = installerIntervals(data, blocks, tree, filter);
  const lead = leadershipIntervals(data, filter);
  const cal = projectResolver(data);
  const tz = cal.timezone;

  const measure = (start: ISODate, end: ISODate): PeriodMeasure => {
    const ws = localMidnightMs(start, tz);
    const we = localMidnightMs(addDays(end, 1), tz);
    const m = measureWindow(inst, lead, ws, we);
    const calendarHours = cal.hoursBetween(start, end);
    const totalHours = m.installerHours + m.leadershipHours;
    return {
      start,
      end,
      openDays: cal.openDaysBetween(start, end),
      calendarHours,
      installerPeak: m.installerPeak,
      leadershipPeak: m.leadershipPeak,
      totalPeak: m.totalPeak,
      installersAtPeak: m.installersAtPeak,
      leadershipAtPeak: m.leadershipAtPeak,
      installerHours: round(m.installerHours),
      leadershipHours: round(m.leadershipHours),
      totalHours: round(totalHours),
      averageEquivalent: calendarHours > 0 ? round(totalHours / calendarHours) : null,
    };
  };

  const weeks = eachWeek(from, to).map((w) => measure(w, addDays(w, 6)));
  const days = opts.days ? eachDay(startOfWeek(from), addDays(startOfWeek(to), 6)).map((d) => measure(d, d)) : [];
  const totals = weeks.reduce(
    (acc, w) => ({
      installerHours: acc.installerHours + w.installerHours,
      leadershipHours: acc.leadershipHours + w.leadershipHours,
      totalHours: acc.totalHours + w.totalHours,
      peakTotal: Math.max(acc.peakTotal, w.totalPeak),
      peakInstallers: Math.max(acc.peakInstallers, w.installerPeak),
      peakLeadership: Math.max(acc.peakLeadership, w.leadershipPeak),
    }),
    { installerHours: 0, leadershipHours: 0, totalHours: 0, peakTotal: 0, peakInstallers: 0, peakLeadership: 0 },
  );
  totals.installerHours = round(totals.installerHours);
  totals.leadershipHours = round(totals.leadershipHours);
  totals.totalHours = round(totals.totalHours);
  return { weeks, days, totals, installerIntervals: inst, leadershipIntervals: lead, isAllocationView };
}

export interface NodePeriodStat {
  peak: number;
  hours: number;
  /** WEEK entry value when the week has no day or block overrides. */
  weeklyValue: number | null;
  hasOverrides: boolean;
}

/** Per-node weekly stats for the planning grid. */
export function nodeWeekStats(data: PlanData, blocks: Map<string, Block[]>, weeks: ISODate[]): Map<string, Map<ISODate, NodePeriodStat>> {
  const tz = data.project.timezone;
  const out = new Map<string, Map<ISODate, NodePeriodStat>>();
  const weekEntries = new Map<string, number>();
  const overrideWeeks = new Set<string>();
  for (const e of data.entries) {
    if (e.kind === "WEEK") weekEntries.set(`${e.nodeKey}|${e.date}`, e.headcount);
    else overrideWeeks.add(`${e.nodeKey}|${startOfWeek(e.date)}`);
  }
  for (const node of data.nodes) {
    const nb = blocks.get(node.key) ?? [];
    const perWeek = new Map<ISODate, NodePeriodStat>();
    for (const w of weeks) {
      const ws = localMidnightMs(w, tz);
      const we = localMidnightMs(addDays(w, 7), tz);
      const m = measureWindow(nb.map((b) => ({ startMs: b.startMs, endMs: b.endMs, count: b.headcount })), [], ws, we);
      const k = `${node.key}|${w}`;
      perWeek.set(w, {
        peak: m.installerPeak,
        hours: round(m.installerHours),
        weeklyValue: weekEntries.get(k) ?? null,
        hasOverrides: overrideWeeks.has(k),
      });
    }
    out.set(node.key, perWeek);
  }
  return out;
}
