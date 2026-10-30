/**
 * Phase staffing plans: planned installer headcount reserved for a phase
 * over its exact window, nested under the shared installer pool, with the
 * pool's capacity derived from the reservations it supplies.
 *
 * Headcount is planned capacity, not a roster of named people.
 */

import { addDays, eachDay, startOfWeek, type ISODate } from "./dates";
import type { CalendarResolver } from "./calendar";
import type { EntryInput, NodeInput, PlanData } from "./plan";
import { entryId } from "./plan";
import { expandAllNodes, projectResolver } from "./staffing";

export interface PhaseStaffing {
  phaseId: string;
  nodeKey: string;
  name: string;
  notes: string | null;
  role: string;
  headcount: number;
  start: ISODate;
  finish: ISODate;
  sortOrder: number;
}

const entry = (nodeKey: string, kind: "WEEK" | "DAY", date: ISODate, headcount: number): EntryInput => ({ nodeKey, kind, date, headcount, hours: null, startTime: null, endTime: null, label: null });

/**
 * Entries that staff `headcount` on every working day of [start, finish] and
 * on no day outside it. Weeks wholly inside the window use one WEEK entry;
 * boundary weeks use DAY entries for their in-window working days only, so a
 * later calendar change cannot schedule anyone outside the window.
 */
export function windowEntries(nodeKey: string, start: ISODate, finish: ISODate, headcount: number, cal: CalendarResolver): EntryInput[] {
  if (finish < start) return [];
  const out: EntryInput[] = [];
  for (let week = startOfWeek(start); week <= finish; week = addDays(week, 7)) {
    const sunday = addDays(week, 6);
    if (week >= start && sunday <= finish) {
      out.push(entry(nodeKey, "WEEK", week, headcount));
      continue;
    }
    for (const d of eachDay(week > start ? week : start, sunday < finish ? sunday : finish)) {
      if (cal.isWorkingDay(d)) out.push(entry(nodeKey, "DAY", d, headcount));
    }
  }
  return out;
}

/** Peak concurrent headcount of each node per shift date. */
function dailyPeaks(blocks: { shiftDate: ISODate; startMs: number; endMs: number; headcount: number }[]): Map<ISODate, number> {
  const byDate = new Map<ISODate, typeof blocks>();
  for (const b of blocks) byDate.set(b.shiftDate, [...(byDate.get(b.shiftDate) ?? []), b]);
  const out = new Map<ISODate, number>();
  for (const [d, list] of byDate) {
    const events = list.flatMap((b) => [
      { t: b.startMs, dh: b.headcount },
      { t: b.endMs, dh: -b.headcount },
    ]);
    events.sort((a, b) => a.t - b.t || a.dh - b.dh);
    let cur = 0;
    let peak = 0;
    for (const e of events) {
      cur += e.dh;
      peak = Math.max(peak, cur);
    }
    out.set(d, peak);
  }
  return out;
}

/**
 * Pool entries for [from, to] (whole weeks) equal to the sum of the pool's
 * direct reservations on each day. A week whose open days all need the same
 * total uses one WEEK entry; otherwise each day with demand gets a DAY entry.
 */
export function derivedPoolEntries(data: PlanData, poolKey: string, from: ISODate, to: ISODate): EntryInput[] {
  const children = data.nodes.filter((n) => n.parentKey === poolKey);
  const blocks = expandAllNodes({ ...data, nodes: data.nodes.filter((n) => n.key === poolKey || n.parentKey === poolKey) }, from, to);
  const demand = new Map<ISODate, number>();
  for (const c of children) {
    for (const [d, peak] of dailyPeaks(blocks.get(c.key) ?? [])) demand.set(d, (demand.get(d) ?? 0) + peak);
  }
  const cal = projectResolver(data);
  const out: EntryInput[] = [];
  for (let week = startOfWeek(from); week <= to; week = addDays(week, 7)) {
    const days = eachDay(week, addDays(week, 6));
    const open = days.filter((d) => cal.isWorkingDay(d));
    const values = new Set(open.map((d) => demand.get(d) ?? 0));
    const closedDemand = days.some((d) => !cal.isWorkingDay(d) && (demand.get(d) ?? 0) > 0);
    if (open.length && values.size === 1 && !closedDemand) {
      const v = [...values][0];
      if (v > 0) out.push(entry(poolKey, "WEEK", week, v));
      continue;
    }
    for (const d of days) {
      const v = demand.get(d) ?? 0;
      if (v > 0) out.push(entry(poolKey, "DAY", d, v));
    }
  }
  return out;
}

const sameEntries = (a: EntryInput[], b: EntryInput[]) => {
  const key = (e: EntryInput) => `${entryId(e)}=${e.headcount}/${e.hours ?? ""}/${e.endTime ?? ""}`;
  return JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());
};

export interface PhasePlanResult {
  data: PlanData;
  /** One line per phase and for the pool, for logs. */
  notes: string[];
  changed: boolean;
}

/**
 * Apply phase staffing plans to a plan. Seed-owned reservation nodes are
 * identified by their stable keys. A reservation whose entries were changed
 * after seeding is preserved as edited; the pool is always re-derived from
 * the reservations actually present, within the plans' overall date range.
 * Existing phase windows that differ from the plan are preserved and the
 * reservation follows the stored window.
 */
export function applyPhaseStaffing(input: PlanData, pool: NodeInput, plans: PhaseStaffing[]): PhasePlanResult {
  const data = structuredClone(input);
  const notes: string[] = [];
  const cal = projectResolver(data);
  let from: ISODate | null = null;
  let to: ISODate | null = null;

  for (const p of plans) {
    let start = p.start;
    let finish = p.finish;
    const win = data.phaseWindows.find((w) => w.phaseId === p.phaseId);
    if (!win) {
      data.phaseWindows.push({ phaseId: p.phaseId, start: p.start, finish: p.finish, note: "Start Work Date through PCO, per the Gray preliminary schedule 2026-10-15 (Contract Milestones)." });
    } else if (win.start === null && win.finish === null) {
      win.start = p.start;
      win.finish = p.finish;
    } else if (win.start !== p.start || win.finish !== p.finish) {
      if (win.start && win.finish) {
        start = win.start;
        finish = win.finish;
      }
      notes.push(`${p.name}: existing phase window ${win.start ?? "?"}–${win.finish ?? "?"} differs from the schedule (${p.start}–${p.finish}); kept the existing window`);
    }

    const expected = windowEntries(p.nodeKey, start, finish, p.headcount, cal);
    const node = data.nodes.find((n) => n.key === p.nodeKey);
    const current = data.entries.filter((e) => e.nodeKey === p.nodeKey);
    if (!node) {
      data.nodes.push({ key: p.nodeKey, parentKey: pool.key, kind: "RESERVATION", name: p.name, role: p.role, phaseId: p.phaseId, areaId: null, systemId: null, activityKey: null, calendarKey: null, notes: p.notes, sortOrder: p.sortOrder });
      data.entries.push(...expected);
      notes.push(`${p.name}: ${p.headcount} planned installers, ${start} to ${finish} (created)`);
    } else if (current.length === 0) {
      data.entries.push(...expected);
      notes.push(`${p.name}: ${p.headcount} planned installers, ${start} to ${finish} (staffing added)`);
    } else if (sameEntries(current, expected)) {
      notes.push(`${p.name}: ${p.headcount} planned installers, ${start} to ${finish} (unchanged)`);
    } else {
      notes.push(`${p.name}: reservation staffing was edited after seeding; left as edited`);
    }
    if (!from || start < from) from = start;
    if (!to || finish > to) to = finish;
  }

  if (from && to) {
    const rangeFrom = startOfWeek(from);
    const rangeTo = addDays(startOfWeek(to), 6);
    const inRange = (e: EntryInput) => e.nodeKey === pool.key && e.kind !== "BLOCK" && e.date >= rangeFrom && e.date <= rangeTo;
    const derived = derivedPoolEntries(data, pool.key, rangeFrom, rangeTo);
    const currentPool = data.entries.filter(inRange);
    if (!sameEntries(currentPool, derived)) {
      data.entries = [...data.entries.filter((e) => !inRange(e)), ...derived];
      notes.push(`${pool.name}: capacity ${rangeFrom} to ${rangeTo} set to the sum of active reservations`);
    }
  }
  return { data, notes, changed: JSON.stringify([input.phaseWindows, input.nodes, input.entries]) !== JSON.stringify([data.phaseWindows, data.nodes, data.entries]) };
}
