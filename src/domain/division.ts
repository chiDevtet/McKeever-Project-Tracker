/**
 * Division demand across working plans. Peaks use aligned time blocks across
 * projects (the most people onsite at the same instant anywhere in the
 * division), never the sum of independent weekly project peaks. Named people
 * booked on several projects at once are counted once and flagged as
 * conflicts; TBD placeholders are always distinct. Anonymous pools express
 * demand, not proof that employees are available.
 */

import { buildTree } from "./capacity";
import { addDays, eachWeek, type ISODate } from "./dates";
import { installerIntervals, measureWindow, type Interval } from "./metrics";
import type { PlanData } from "./plan";
import { personKey } from "./plan";
import { expandAllNodes, expandLeadership } from "./staffing";
import { epochMsToZonedDate, epochMsToZonedTime, localMidnightMs } from "./tz";

export interface AvailabilityLimitInput {
  role: string;
  startDate: ISODate;
  endDate: ISODate;
  maxHeadcount: number;
}

export interface DivisionWeek {
  week: ISODate;
  installerPeak: number;
  leadershipPeak: number;
  totalPeak: number;
  installersAtPeak: number;
  leadershipAtPeak: number;
  installerHours: number;
  leadershipHours: number;
  /** Sum of each project's own weekly total peak, shown only for comparison. */
  sumOfProjectPeaks: number;
  limit: number | null;
  /** Peak installers above the entered limit; null when availability is not set. */
  shortage: number | null;
  byProject: { projectId: string; totalPeak: number; installerHours: number; leadershipHours: number }[];
}

export interface PersonConflict {
  personName: string;
  personKey: string;
  projects: { projectId: string; code: string; role: string }[];
  firstDate: ISODate;
  lastDate: ISODate;
  days: number;
  /** Example overlapping time on the first date. */
  timeRange: string;
}

export interface DivisionForecast {
  weeks: DivisionWeek[];
  conflicts: PersonConflict[];
  availabilitySet: boolean;
  totals: { installerHours: number; leadershipHours: number; peakTotal: number; peakInstallers: number };
}

export interface DivisionOptions {
  timezone: string;
  roles?: string[];
  includeLeadership?: boolean;
  availability?: AvailabilityLimitInput[];
}

export function computeDivision(plans: PlanData[], from: ISODate, to: ISODate, opts: DivisionOptions): DivisionForecast {
  const tz = opts.timezone;
  const installersByProject = new Map<string, Interval[]>();
  const allInstallers: Interval[] = [];
  // Person -> intervals tagged by project, for dedup and conflict detection.
  const personIntervals = new Map<string, { name: string; items: { startMs: number; endMs: number; projectId: string; code: string; role: string }[] }>();

  for (const data of plans) {
    const tree = buildTree(data.nodes);
    const blocks = expandAllNodes(data);
    const { intervals } = installerIntervals(data, blocks, tree, { roles: opts.roles });
    installersByProject.set(data.project.id, intervals);
    allInstallers.push(...intervals);
    if (opts.includeLeadership === false) continue;
    for (const l of data.leadership) {
      const pk = personKey(l);
      const entry = personIntervals.get(pk) ?? { name: l.personName, items: [] };
      for (const b of expandLeadership(data, l)) entry.items.push({ startMs: b.startMs, endMs: b.endMs, projectId: data.project.id, code: data.project.code, role: l.role });
      personIntervals.set(pk, entry);
    }
  }

  // Deduplicate each person across projects; record simultaneous incompatible commitments.
  const leaderIntervals: Interval[] = [];
  const leaderByProject = new Map<string, Interval[]>();
  const conflictMap = new Map<string, PersonConflict & { dates: Set<ISODate> }>();
  for (const [pk, p] of personIntervals) {
    const items = [...p.items].sort((a, b) => a.startMs - b.startMs);
    const merged: { startMs: number; endMs: number }[] = [];
    for (const it of items) {
      const last = merged[merged.length - 1];
      if (last && it.startMs <= last.endMs) last.endMs = Math.max(last.endMs, it.endMs);
      else merged.push({ startMs: it.startMs, endMs: it.endMs });
      const list = leaderByProject.get(it.projectId) ?? [];
      list.push({ startMs: it.startMs, endMs: it.endMs, count: 1 });
      leaderByProject.set(it.projectId, list);
    }
    for (const m of merged) leaderIntervals.push({ ...m, count: 1 });
    if (pk.startsWith("tbd:")) continue;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length && items[j].startMs < items[i].endMs; j++) {
        if (items[j].projectId === items[i].projectId) continue;
        const s = Math.max(items[i].startMs, items[j].startMs);
        const e = Math.min(items[i].endMs, items[j].endMs);
        const pair = [items[i], items[j]].sort((a, b) => a.code.localeCompare(b.code));
        const k = `${pk}|${pair.map((x) => x.projectId).join("|")}`;
        const date = epochMsToZonedDate(s, tz);
        const c = conflictMap.get(k) ?? {
          personName: p.name,
          personKey: pk,
          projects: pair.map((x) => ({ projectId: x.projectId, code: x.code, role: x.role })),
          firstDate: date,
          lastDate: date,
          days: 0,
          timeRange: `${epochMsToZonedTime(s, tz)}–${epochMsToZonedTime(e, tz)}`,
          dates: new Set<ISODate>(),
        };
        c.dates.add(date);
        if (date < c.firstDate) c.firstDate = date;
        if (date > c.lastDate) c.lastDate = date;
        c.days = c.dates.size;
        conflictMap.set(k, c);
      }
    }
  }

  const availability = (opts.availability ?? []).filter((a) => !opts.roles || opts.roles.includes(a.role));
  const weeks: DivisionWeek[] = eachWeek(from, to).map((w) => {
    const ws = localMidnightMs(w, tz);
    const we = localMidnightMs(addDays(w, 7), tz);
    const m = measureWindow(allInstallers, leaderIntervals, ws, we);
    const byProject = plans.map((d) => {
      const pm = measureWindow(installersByProject.get(d.project.id) ?? [], leaderByProject.get(d.project.id) ?? [], ws, we);
      return { projectId: d.project.id, totalPeak: pm.totalPeak, installerHours: round(pm.installerHours), leadershipHours: round(pm.leadershipHours) };
    });
    const limits = availability.filter((a) => a.startDate <= addDays(w, 6) && a.endDate >= w);
    const limit = limits.length ? Math.min(...limits.map((a) => a.maxHeadcount)) : null;
    return {
      week: w,
      installerPeak: m.installerPeak,
      leadershipPeak: m.leadershipPeak,
      totalPeak: m.totalPeak,
      installersAtPeak: m.installersAtPeak,
      leadershipAtPeak: m.leadershipAtPeak,
      installerHours: round(m.installerHours),
      leadershipHours: round(m.leadershipHours),
      sumOfProjectPeaks: byProject.reduce((s, p) => s + p.totalPeak, 0),
      limit,
      shortage: limit === null ? null : Math.max(0, m.installerPeak - limit),
      byProject,
    };
  });

  const conflicts: PersonConflict[] = [...conflictMap.values()].map(({ dates: _dates, ...c }) => c);
  return {
    weeks,
    conflicts,
    availabilitySet: availability.length > 0,
    totals: {
      installerHours: round(weeks.reduce((s, w) => s + w.installerHours, 0)),
      leadershipHours: round(weeks.reduce((s, w) => s + w.leadershipHours, 0)),
      peakTotal: Math.max(0, ...weeks.map((w) => w.totalPeak)),
      peakInstallers: Math.max(0, ...weeks.map((w) => w.installerPeak)),
    },
  };
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
