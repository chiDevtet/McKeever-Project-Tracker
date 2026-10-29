/**
 * Compare two plans of one project (a scenario or snapshot against the
 * working plan): activity dates, peak headcount, labor hours, and planning
 * issues, over a shared reporting range so weekly values line up.
 */

import type { ISODate } from "./dates";
import { computePlanningIssues, type PlanningIssue } from "./issues";
import { computeMeasures, planDateRange, type PlanMeasures } from "./metrics";
import type { PlanData } from "./plan";
import { workingDayDelta } from "./calendar";
import { projectResolver } from "./staffing";

export type ActivityChange = "added" | "removed" | "moved" | "renamed" | "unchanged";

export interface ActivityComparison {
  key: string;
  code: string;
  name: string;
  base: { start: ISODate; finish: ISODate } | null;
  other: { start: ISODate; finish: ISODate } | null;
  /** Working days the start / finish moved (other - base); null when added or removed. */
  startDelta: number | null;
  finishDelta: number | null;
  change: ActivityChange;
}

export interface PlanComparison {
  range: { start: ISODate; end: ISODate } | null;
  totals: { base: PlanMeasures["totals"]; other: PlanMeasures["totals"] };
  weeks: { week: ISODate; basePeak: number; otherPeak: number; baseHours: number; otherHours: number }[];
  activities: ActivityComparison[];
  issues: { base: Record<string, number>; other: Record<string, number>; added: PlanningIssue[] };
  staffingRowsChanged: number;
  leadershipChanged: number;
}

function countBy(issues: PlanningIssue[]) {
  const out: Record<string, number> = {};
  for (const i of issues) out[i.category] = (out[i.category] ?? 0) + 1;
  return out;
}

const json = (v: unknown) => JSON.stringify(v);

export function comparePlans(base: PlanData, other: PlanData): PlanComparison {
  const rb = planDateRange(base);
  const ro = planDateRange(other);
  const range = rb && ro ? { start: rb.start < ro.start ? rb.start : ro.start, end: rb.end > ro.end ? rb.end : ro.end } : (rb ?? ro);
  const empty = { installerHours: 0, leadershipHours: 0, totalHours: 0, peakTotal: 0, peakInstallers: 0, peakLeadership: 0 };
  const mb = range ? computeMeasures(base, range.start, range.end) : null;
  const mo = range ? computeMeasures(other, range.start, range.end) : null;
  const weeks = (mb?.weeks ?? []).map((w, i) => ({ week: w.start, basePeak: w.totalPeak, otherPeak: mo!.weeks[i].totalPeak, baseHours: w.totalHours, otherHours: mo!.weeks[i].totalHours }));

  const cal = projectResolver(other);
  const baseActs = new Map(base.activities.filter((a) => !a.archived).map((a) => [a.key, a]));
  const otherActs = new Map(other.activities.filter((a) => !a.archived).map((a) => [a.key, a]));
  const activities: ActivityComparison[] = [];
  for (const [key, o] of otherActs) {
    const b = baseActs.get(key);
    if (!b) {
      activities.push({ key, code: o.code, name: o.name, base: null, other: { start: o.plannedStart, finish: o.plannedFinish }, startDelta: null, finishDelta: null, change: "added" });
      continue;
    }
    const startDelta = workingDayDelta(cal, b.plannedStart, o.plannedStart);
    const finishDelta = workingDayDelta(cal, b.plannedFinish, o.plannedFinish);
    const moved = b.plannedStart !== o.plannedStart || b.plannedFinish !== o.plannedFinish;
    activities.push({ key, code: o.code, name: o.name, base: { start: b.plannedStart, finish: b.plannedFinish }, other: { start: o.plannedStart, finish: o.plannedFinish }, startDelta, finishDelta, change: moved ? "moved" : b.name !== o.name ? "renamed" : "unchanged" });
  }
  for (const [key, b] of baseActs) if (!otherActs.has(key)) activities.push({ key, code: b.code, name: b.name, base: { start: b.plannedStart, finish: b.plannedFinish }, other: null, startDelta: null, finishDelta: null, change: "removed" });
  activities.sort((x, y) => x.code.localeCompare(y.code));

  const ib = computePlanningIssues(base);
  const io = computePlanningIssues(other);
  const baseIds = new Set(ib.map((i) => i.id));

  const entryKey = (e: PlanData["entries"][number]) => `${e.nodeKey}|${e.kind}|${e.date}|${e.startTime ?? ""}`;
  const be = new Map(base.entries.map((e) => [entryKey(e), json(e)]));
  const oe = new Map(other.entries.map((e) => [entryKey(e), json(e)]));
  const changedNodes = new Set<string>();
  for (const [k, v] of oe) if (be.get(k) !== v) changedNodes.add(k.split("|")[0]);
  for (const k of be.keys()) if (!oe.has(k)) changedNodes.add(k.split("|")[0]);
  const bl = new Map(base.leadership.map((l) => [l.key, json(l)]));
  const ol = new Map(other.leadership.map((l) => [l.key, json(l)]));
  let leadershipChanged = 0;
  for (const [k, v] of ol) if (bl.get(k) !== v) leadershipChanged++;
  for (const k of bl.keys()) if (!ol.has(k)) leadershipChanged++;

  return {
    range,
    totals: { base: mb?.totals ?? empty, other: mo?.totals ?? empty },
    weeks,
    activities,
    issues: { base: countBy(ib), other: countBy(io), added: io.filter((i) => !baseIds.has(i.id)) },
    staffingRowsChanged: changedNodes.size,
    leadershipChanged,
  };
}
