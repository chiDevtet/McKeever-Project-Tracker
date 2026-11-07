/**
 * Seed-owned project staffing: phase windows from the schedule and monthly
 * workforce forecasts applied as weekly / daily headcount on workforce pools.
 *
 * Headcount is planned capacity, not a roster of named people.
 */

import { addDays, eachDay, startOfWeek, type ISODate } from "./dates";
import type { CalendarResolver } from "./calendar";
import type { EntryInput, NodeInput, PlanData } from "./plan";
import { entryId } from "./plan";
import { projectResolver } from "./staffing";

const entry = (nodeKey: string, kind: "WEEK" | "DAY", date: ISODate, headcount: number): EntryInput => ({ nodeKey, kind, date, headcount, hours: null, startTime: null, endTime: null, label: null });

/**
 * Entries giving `valueOn(day)` people on every working day of [from, to]
 * and nothing outside it. A week wholly inside the range whose working days
 * share one value uses a WEEK entry; any other week uses DAY entries for its
 * in-range working days, so no one is scheduled outside the range even if the
 * calendar later opens a weekend day.
 */
export function dailyEntries(nodeKey: string, valueOn: (d: ISODate) => number, from: ISODate, to: ISODate, cal: CalendarResolver): EntryInput[] {
  if (to < from) return [];
  const out: EntryInput[] = [];
  for (let week = startOfWeek(from); week <= to; week = addDays(week, 7)) {
    const sunday = addDays(week, 6);
    const days = eachDay(week > from ? week : from, sunday < to ? sunday : to).filter((d) => cal.isWorkingDay(d));
    const values = new Set(days.map(valueOn));
    if (week >= from && sunday <= to && values.size === 1) {
      const v = [...values][0];
      if (v > 0) out.push(entry(nodeKey, "WEEK", week, v));
      continue;
    }
    for (const d of days) if (valueOn(d) > 0) out.push(entry(nodeKey, "DAY", d, valueOn(d)));
  }
  return out;
}

/** The same headcount on every working day of [start, finish]. */
export function windowEntries(nodeKey: string, start: ISODate, finish: ISODate, headcount: number, cal: CalendarResolver): EntryInput[] {
  return dailyEntries(nodeKey, () => headcount, start, finish, cal);
}

export interface MonthlyHeadcount {
  /** YYYY-MM */
  month: string;
  headcount: number;
}

/** Headcount of the day's month within [start, finish], else 0. */
export function monthlyValue(months: MonthlyHeadcount[], start: ISODate, finish: ISODate): (d: ISODate) => number {
  const byMonth = new Map(months.map((m) => [m.month, m.headcount]));
  return (d) => (d < start || d > finish ? 0 : (byMonth.get(d.slice(0, 7)) ?? 0));
}

export interface PhaseWindowSpec {
  phaseId: string;
  name: string;
  start: ISODate;
  finish: ISODate;
  note: string;
}

export interface RetiredReservation {
  nodeKey: string;
  name: string;
  /** The entries the earlier seed wrote; a node whose entries still equal these was not edited. */
  expected: EntryInput[];
}

export interface PoolForecast {
  /** An existing root pool with this role is reused; otherwise one is created with `key`. */
  role: string;
  key: string;
  name: string;
  notes: string;
  sortOrder: number;
  /** Seed-owned date range: entries in it are replaced by the forecast. */
  ownedFrom: ISODate;
  ownedTo: ISODate;
  valueOn: (d: ISODate) => number;
}

export interface SeedStaffingResult {
  data: PlanData;
  notes: string[];
  changed: boolean;
}

const sameEntries = (a: EntryInput[], b: EntryInput[]) => {
  const key = (e: EntryInput) => `${entryId(e)}=${e.headcount}/${e.hours ?? ""}/${e.endTime ?? ""}`;
  return JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());
};

/**
 * Apply seed-owned staffing to a plan:
 * - phase windows are set where missing (an operator-set window is kept);
 * - reservations from an earlier seed are removed when still unedited, and
 *   kept (with a note) when an operator changed them;
 * - each forecast pool's entries inside its owned range are replaced by the
 *   forecast; entries outside the range and other pools are untouched.
 * The caller validates the result (capacity) through the normal plan mutation.
 */
export function applySeedStaffing(input: PlanData, spec: { windows: PhaseWindowSpec[]; retire: RetiredReservation[]; pools: PoolForecast[] }): SeedStaffingResult {
  const data = structuredClone(input);
  const notes: string[] = [];
  const cal = projectResolver(data);

  for (const w of spec.windows) {
    const win = data.phaseWindows.find((x) => x.phaseId === w.phaseId);
    if (!win) data.phaseWindows.push({ phaseId: w.phaseId, start: w.start, finish: w.finish, note: w.note });
    else if (win.start === null && win.finish === null) Object.assign(win, { start: w.start, finish: w.finish });
    else if (win.start !== w.start || win.finish !== w.finish) notes.push(`${w.name}: existing phase window ${win.start ?? "?"}–${win.finish ?? "?"} differs from the schedule (${w.start}–${w.finish}); kept the existing window`);
  }

  for (const r of spec.retire) {
    const node = data.nodes.find((n) => n.key === r.nodeKey);
    if (!node) continue;
    const entries = data.entries.filter((e) => e.nodeKey === r.nodeKey);
    const hasChildren = data.nodes.some((n) => n.parentKey === r.nodeKey);
    if (!hasChildren && (entries.length === 0 || sameEntries(entries, r.expected))) {
      data.nodes = data.nodes.filter((n) => n.key !== r.nodeKey);
      data.entries = data.entries.filter((e) => e.nodeKey !== r.nodeKey);
      notes.push(`${r.name}: removed (superseded by the manpower forecast)`);
    } else {
      notes.push(`${r.name}: edited after seeding; kept as edited (it must fit within the forecast capacity)`);
    }
  }

  for (const p of spec.pools) {
    let pool: NodeInput | undefined = data.nodes.filter((n) => n.kind === "POOL" && n.parentKey === null && n.role === p.role).sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (!pool) {
      pool = { key: p.key, parentKey: null, kind: "POOL", name: p.name, role: p.role, phaseId: null, areaId: null, systemId: null, activityKey: null, calendarKey: null, notes: p.notes, sortOrder: p.sortOrder };
      data.nodes.push(pool);
      notes.push(`${p.name}: workforce pool created`);
    } else if (pool.notes !== p.notes && (pool.notes === null || pool.notes.startsWith("Planned capacity from") || pool.notes.trim() === "")) {
      pool.notes = p.notes;
    }
    const key = pool.key;
    const owned = (e: EntryInput) => e.nodeKey === key && e.kind !== "BLOCK" && e.date >= p.ownedFrom && e.date <= p.ownedTo;
    const desired = dailyEntries(key, p.valueOn, p.ownedFrom, p.ownedTo, cal);
    if (!sameEntries(data.entries.filter(owned), desired)) {
      data.entries = [...data.entries.filter((e) => !owned(e)), ...desired];
      notes.push(`${p.name}: forecast applied ${p.ownedFrom} to ${p.ownedTo}`);
    } else notes.push(`${p.name}: forecast unchanged`);
  }

  return { data, notes, changed: JSON.stringify([input.phaseWindows, input.nodes, input.entries]) !== JSON.stringify([data.phaseWindows, data.nodes, data.entries]) };
}
