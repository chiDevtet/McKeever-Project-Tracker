/**
 * Expansion of staffing inputs into timezone-aware blocks.
 *
 * For one allocation node and one shift-start date the capacity is resolved
 * in this order:
 *   1. explicit timed BLOCK entries on that date (they replace the whole day);
 *   2. a DAY override (headcount, optional hours/start; zero clears the day);
 *   3. the WEEK entry for that week, applied only on open calendar days.
 * Weekly values are therefore always derived from daily records; there is no
 * competing stored weekly total.
 */

import { CalendarResolver, nominalHours } from "./calendar";
import { addDays, isoWeekday, startOfWeek, type ISODate } from "./dates";
import type { DayOverride, EntryInput, LeadershipInput, NodeInput, PlanData } from "./plan";
import { calendarByKey, defaultCalendar, personKey } from "./plan";
import { HOUR_MS, zonedTimeToEpochMs } from "./tz";

export interface Block {
  /** Allocation node key, or leadership assignment key. */
  ownerKey: string;
  shiftDate: ISODate;
  startMs: number;
  endMs: number;
  headcount: number;
  source: "week" | "day" | "block" | "leadership";
  /** True when the block falls on a closed calendar day. */
  closedDay: boolean;
  label: string | null;
}

export function blockHours(b: Pick<Block, "startMs" | "endMs">): number {
  return (b.endMs - b.startMs) / HOUR_MS;
}

const resolverCache = new WeakMap<object, CalendarResolver>();

export function resolverFor(data: PlanData, calendarKey: string | null | undefined): CalendarResolver {
  const cal = calendarByKey(data, calendarKey);
  let r = resolverCache.get(cal.definition);
  if (!r || r.timezone !== cal.timezone) {
    r = new CalendarResolver(cal.definition, cal.timezone);
    resolverCache.set(cal.definition, r);
  }
  return r;
}

export function projectResolver(data: PlanData): CalendarResolver {
  return resolverFor(data, defaultCalendar(data).key);
}

/** Calendar governing a node: its own, else the nearest ancestor's, else the project's. */
export function nodeCalendarKey(data: PlanData, node: NodeInput): string | null {
  const byKey = new Map(data.nodes.map((n) => [n.key, n]));
  let cur: NodeInput | undefined = node;
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur.calendarKey) return cur.calendarKey;
    cur = cur.parentKey ? byKey.get(cur.parentKey) : undefined;
  }
  return null;
}

function timedBlock(ownerKey: string, date: ISODate, start: string, end: string, headcount: number, tz: string, closed: boolean, label: string | null): Block {
  const startMs = zonedTimeToEpochMs(date, start, tz);
  let endMs = zonedTimeToEpochMs(date, end, tz);
  if (endMs <= startMs) endMs = zonedTimeToEpochMs(addDays(date, 1), end, tz);
  return { ownerKey, shiftDate: date, startMs, endMs, headcount, source: "block", closedDay: closed, label };
}

function wholeDayBlock(ownerKey: string, date: ISODate, start: string, hours: number, headcount: number, tz: string, source: Block["source"], closed: boolean, label: string | null): Block {
  const startMs = zonedTimeToEpochMs(date, start, tz);
  return { ownerKey, shiftDate: date, startMs, endMs: startMs + hours * HOUR_MS, headcount, source, closedDay: closed, label };
}

/** Expand one node's entries. Optional [from, to] limits shift-start dates. */
export function expandEntries(nodeKey: string, entries: EntryInput[], cal: CalendarResolver, from?: ISODate, to?: ISODate): Block[] {
  const weeks = new Map<ISODate, EntryInput>();
  const days = new Map<ISODate, EntryInput>();
  const timed = new Map<ISODate, EntryInput[]>();
  const dates = new Set<ISODate>();

  for (const e of entries) {
    if (e.nodeKey !== nodeKey) continue;
    if (e.kind === "WEEK") {
      weeks.set(e.date, e);
      for (let i = 0; i < 7; i++) dates.add(addDays(e.date, i));
    } else if (e.kind === "DAY") {
      days.set(e.date, e);
      dates.add(e.date);
    } else {
      const list = timed.get(e.date) ?? [];
      list.push(e);
      timed.set(e.date, list);
      dates.add(e.date);
    }
  }

  const out: Block[] = [];
  const tz = cal.timezone;
  for (const date of [...dates].sort()) {
    if ((from && date < from) || (to && date > to)) continue;
    const day = cal.day(date);
    const blocks = timed.get(date);
    if (blocks && blocks.length) {
      for (const b of blocks) {
        if (b.headcount <= 0 || !b.startTime || !b.endTime) continue;
        out.push(timedBlock(nodeKey, date, b.startTime, b.endTime, b.headcount, tz, !day.open, b.label));
      }
      continue;
    }
    const override = days.get(date);
    if (override) {
      if (override.headcount <= 0) continue;
      const hours = override.hours ?? (day.open ? day.hours : nominalHours(cal.definition));
      if (hours <= 0) continue;
      out.push(wholeDayBlock(nodeKey, date, override.startTime ?? day.start, hours, override.headcount, tz, "day", !day.open, override.label));
      continue;
    }
    const week = weeks.get(startOfWeek(date));
    if (week && week.headcount > 0 && day.open && day.hours > 0) {
      out.push(wholeDayBlock(nodeKey, date, day.start, day.hours, week.headcount, tz, "week", false, null));
    }
  }
  return out;
}

export function expandNode(data: PlanData, node: NodeInput, from?: ISODate, to?: ISODate): Block[] {
  const cal = resolverFor(data, nodeCalendarKey(data, node));
  return expandEntries(node.key, data.entries, cal, from, to);
}

/** All node blocks keyed by node key. */
export function expandAllNodes(data: PlanData, from?: ISODate, to?: ISODate): Map<string, Block[]> {
  const byNode = new Map<string, EntryInput[]>();
  for (const e of data.entries) {
    const list = byNode.get(e.nodeKey) ?? [];
    list.push(e);
    byNode.set(e.nodeKey, list);
  }
  const out = new Map<string, Block[]>();
  for (const node of data.nodes) {
    const cal = resolverFor(data, nodeCalendarKey(data, node));
    out.set(node.key, expandEntries(node.key, byNode.get(node.key) ?? [], cal, from, to));
  }
  return out;
}

/**
 * Onsite blocks for one leadership assignment. Assignments without selected
 * dates produce no onsite time (and are reported as a planning issue).
 */
export function expandLeadership(data: PlanData, l: LeadershipInput, from?: ISODate, to?: ISODate): Block[] {
  if (!l.startDate || !l.endDate || l.endDate < l.startDate) return [];
  const cal = projectResolver(data);
  const tz = cal.timezone;
  const overrides = new Map<ISODate, DayOverride>(l.dayOverrides.map((o) => [o.date, o]));
  const out: Block[] = [];
  const start = from && from > l.startDate ? from : l.startDate;
  const end = to && to < l.endDate ? to : l.endDate;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const day = cal.day(date);
    const o = overrides.get(date);
    if (o?.kind === "offsite") continue;
    let onsite: boolean;
    if (o) onsite = true;
    else if (l.onsiteMode === "PROJECT_CALENDAR") onsite = day.open;
    else onsite = l.onsiteWeekdays.includes(isoWeekday(date));
    if (!onsite) continue;
    const hours = o?.hours ?? l.onsiteHours ?? (day.open ? day.hours : nominalHours(cal.definition));
    if (!hours || hours <= 0) continue;
    const startTime = o?.start ?? l.onsiteStart ?? day.start;
    out.push(wholeDayBlock(l.key, date, startTime, hours, 1, tz, "leadership", !day.open, null));
  }
  return out;
}

export interface PersonBlocks {
  personKey: string;
  personName: string;
  isPlaceholder: boolean;
  assignmentKeys: string[];
  /** Union of onsite intervals; overlapping responsibilities count once. */
  intervals: { startMs: number; endMs: number }[];
}

export function mergeIntervals(intervals: { startMs: number; endMs: number }[]): { startMs: number; endMs: number }[] {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: { startMs: number; endMs: number }[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.startMs <= last.endMs) last.endMs = Math.max(last.endMs, iv.endMs);
    else out.push({ ...iv });
  }
  return out;
}

/** Leadership onsite time grouped and deduplicated by person. */
export function leadershipByPerson(data: PlanData, from?: ISODate, to?: ISODate, filter?: (l: LeadershipInput) => boolean): PersonBlocks[] {
  const groups = new Map<string, PersonBlocks>();
  for (const l of data.leadership) {
    if (filter && !filter(l)) continue;
    const pk = personKey(l);
    let g = groups.get(pk);
    if (!g) {
      g = { personKey: pk, personName: l.personName, isPlaceholder: !l.personId, assignmentKeys: [], intervals: [] };
      groups.set(pk, g);
    }
    g.assignmentKeys.push(l.key);
    for (const b of expandLeadership(data, l, from, to)) g.intervals.push({ startMs: b.startMs, endMs: b.endMs });
  }
  for (const g of groups.values()) g.intervals = mergeIntervals(g.intervals);
  return [...groups.values()];
}
