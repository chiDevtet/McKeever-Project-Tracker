/**
 * Working calendars. A calendar has a base weekly pattern, optional
 * effective-dated periods that replace the pattern for a date range (for
 * example one week of six ten-hour days), dated exceptions (holidays, added
 * workdays, changed hours), and named shift presets used when entering timed
 * blocks. Resolution order for a date: exception, then the latest-starting
 * period covering it, then the base pattern.
 */

import { z } from "zod";
import { addDays, diffDays, eachDay, isISODate, isoWeekday, type ISODate } from "./dates";
import { isTimeOfDay, minutesOfDay } from "./tz";

const isoDate = z.string().refine(isISODate, "Expected a date (YYYY-MM-DD)");
const timeOfDay = z.string().refine(isTimeOfDay, "Expected a time (HH:MM)");
const hours = z.number().min(0).max(24);

export const dayRuleSchema = z.object({
  open: z.boolean(),
  hours,
  start: timeOfDay,
});
export type DayRule = z.infer<typeof dayRuleSchema>;

/** Seven rules, index 0 = Monday ... 6 = Sunday. */
export const weekPatternSchema = z.array(dayRuleSchema).length(7);
export type WeekPattern = z.infer<typeof weekPatternSchema>;

export const calendarPeriodSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(200).default(""),
  start: isoDate,
  end: isoDate,
  weekPattern: weekPatternSchema,
});
export type CalendarPeriod = z.infer<typeof calendarPeriodSchema>;

export const calendarExceptionSchema = z.object({
  id: z.string().min(1),
  date: isoDate,
  /** closed: holiday or shutdown; open: added workday; hours: changed hours. */
  kind: z.enum(["closed", "open", "hours"]),
  hours: hours.nullable().default(null),
  start: timeOfDay.nullable().default(null),
  label: z.string().max(200).default(""),
});
export type CalendarException = z.infer<typeof calendarExceptionSchema>;

export const shiftPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  start: timeOfDay,
  end: timeOfDay,
});
export type ShiftPreset = z.infer<typeof shiftPresetSchema>;

export const calendarDefinitionSchema = z
  .object({
    weekPattern: weekPatternSchema,
    periods: z.array(calendarPeriodSchema).default([]),
    exceptions: z.array(calendarExceptionSchema).default([]),
    shifts: z.array(shiftPresetSchema).default([]),
  })
  .superRefine((def, ctx) => {
    def.periods.forEach((p, i) => {
      if (p.end < p.start) ctx.addIssue({ code: "custom", path: ["periods", i, "end"], message: "Period ends before it starts" });
    });
    const seen = new Set<string>();
    def.exceptions.forEach((e, i) => {
      if (seen.has(e.date)) ctx.addIssue({ code: "custom", path: ["exceptions", i, "date"], message: `More than one exception on ${e.date}` });
      seen.add(e.date);
      if (e.kind === "hours" && (e.hours === null || e.hours <= 0)) {
        ctx.addIssue({ code: "custom", path: ["exceptions", i, "hours"], message: "Changed-hours exception needs hours above zero" });
      }
    });
  });
export type CalendarDefinition = z.infer<typeof calendarDefinitionSchema>;

export interface CalendarInput {
  key: string;
  name: string;
  timezone: string;
  isDefault: boolean;
  definition: CalendarDefinition;
}

export interface ResolvedDay {
  date: ISODate;
  open: boolean;
  hours: number;
  start: string;
  source: "base" | "period" | "exception";
  label: string;
}

const closedDay = (start: string): DayRule => ({ open: false, hours: 0, start });

/** Monday-Friday, eight working hours from 07:00 (the selected default). */
export function defaultWeekPattern(hoursPerDay = 8, start = "07:00"): WeekPattern {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => (i < 5 ? { open: true, hours: hoursPerDay, start } : closedDay(start)));
}

export function defaultCalendarDefinition(): CalendarDefinition {
  return {
    weekPattern: defaultWeekPattern(),
    periods: [],
    exceptions: [],
    shifts: [
      { id: "day", name: "Day shift", start: "07:00", end: "15:00" },
      { id: "second", name: "Second shift", start: "15:00", end: "23:00" },
      { id: "night", name: "Night shift", start: "23:00", end: "07:00" },
    ],
  };
}

export function parseCalendarDefinition(value: unknown): CalendarDefinition {
  return calendarDefinitionSchema.parse(value);
}

/** Typical working hours, used when an added workday gives no hours. */
export function nominalHours(def: CalendarDefinition): number {
  const open = def.weekPattern.find((d) => d.open && d.hours > 0);
  return open ? open.hours : 8;
}

export function resolveDay(def: CalendarDefinition, date: ISODate): ResolvedDay {
  const exception = def.exceptions.find((e) => e.date === date);
  let rule: DayRule = def.weekPattern[isoWeekday(date) - 1];
  let source: ResolvedDay["source"] = "base";
  let label = "";

  let period: CalendarPeriod | undefined;
  for (const p of def.periods) {
    if (date >= p.start && date <= p.end && (!period || p.start >= period.start)) period = p;
  }
  if (period) {
    rule = period.weekPattern[isoWeekday(date) - 1];
    source = "period";
    label = period.label;
  }

  if (exception) {
    source = "exception";
    label = exception.label;
    if (exception.kind === "closed") {
      return { date, open: false, hours: 0, start: rule.start, source, label };
    }
    const h = exception.hours ?? (rule.open && rule.hours > 0 ? rule.hours : nominalHours(def));
    return { date, open: h > 0, hours: h, start: exception.start ?? rule.start, source, label };
  }

  const open = rule.open && rule.hours > 0;
  return { date, open, hours: open ? rule.hours : 0, start: rule.start, source, label };
}

/** Cache resolved days for repeated queries against one definition. */
export class CalendarResolver {
  private readonly cache = new Map<ISODate, ResolvedDay>();
  constructor(
    readonly definition: CalendarDefinition,
    readonly timezone: string,
  ) {}

  day(date: ISODate): ResolvedDay {
    let d = this.cache.get(date);
    if (!d) {
      d = resolveDay(this.definition, date);
      this.cache.set(date, d);
    }
    return d;
  }

  isWorkingDay(date: ISODate): boolean {
    return this.day(date).open;
  }

  hoursBetween(start: ISODate, end: ISODate): number {
    let total = 0;
    for (const d of eachDay(start, end)) total += this.day(d).hours;
    return total;
  }

  openDaysBetween(start: ISODate, end: ISODate): number {
    let n = 0;
    for (const d of eachDay(start, end)) if (this.day(d).open) n++;
    return n;
  }
}

const SEARCH_LIMIT_DAYS = 3660;

function noWorkingDays(): never {
  throw new RangeError("The calendar has no working days within ten years of this date");
}

/** First working day on or after (inclusive) / strictly after (exclusive) a date. */
export function nextWorkingDay(cal: CalendarResolver, date: ISODate, inclusive = true): ISODate {
  let d = inclusive ? date : addDays(date, 1);
  for (let i = 0; i < SEARCH_LIMIT_DAYS; i++) {
    if (cal.isWorkingDay(d)) return d;
    d = addDays(d, 1);
  }
  return noWorkingDays();
}

export function previousWorkingDay(cal: CalendarResolver, date: ISODate, inclusive = true): ISODate {
  let d = inclusive ? date : addDays(date, -1);
  for (let i = 0; i < SEARCH_LIMIT_DAYS; i++) {
    if (cal.isWorkingDay(d)) return d;
    d = addDays(d, -1);
  }
  return noWorkingDays();
}

/**
 * Move by `n` working days from `date`. n = 0 snaps forward to a working day.
 * Positive n moves later, negative earlier; the start date itself is not
 * counted.
 */
export function addWorkingDays(cal: CalendarResolver, date: ISODate, n: number): ISODate {
  if (!Number.isInteger(n)) throw new RangeError("Working-day offsets must be whole days");
  if (n === 0) return nextWorkingDay(cal, date, true);
  let d = date;
  let remaining = Math.abs(n);
  const step = n > 0 ? 1 : -1;
  let guard = 0;
  while (remaining > 0) {
    d = addDays(d, step);
    if (cal.isWorkingDay(d)) remaining--;
    if (++guard > SEARCH_LIMIT_DAYS * 4) noWorkingDays();
  }
  return d;
}

/** Inclusive count of working days from start to finish. */
export function workingDaysBetween(cal: CalendarResolver, start: ISODate, finish: ISODate): number {
  if (finish < start) return 0;
  return cal.openDaysBetween(start, finish);
}

/** Finish date for an activity of `duration` working days starting on `start`. */
export function finishForDuration(cal: CalendarResolver, start: ISODate, duration: number): ISODate {
  const first = nextWorkingDay(cal, start, true);
  if (duration <= 1) return first;
  return addWorkingDays(cal, first, duration - 1);
}

/** Signed working-day distance from a to b (positive when b is later). */
export function workingDayDelta(cal: CalendarResolver, a: ISODate, b: ISODate): number {
  if (a === b) return 0;
  if (b > a) return cal.openDaysBetween(addDays(a, 1), b);
  return -cal.openDaysBetween(addDays(b, 1), a);
}

/** Hours of a timed block between local start and end times (end <= start = next day). */
export function nominalBlockHours(start: string, end: string): number {
  const s = minutesOfDay(start);
  let e = minutesOfDay(end);
  if (e <= s) e += 24 * 60;
  return (e - s) / 60;
}

/** Days in [start, end] whose resolution differs between two definitions. */
export function changedDays(before: CalendarDefinition, after: CalendarDefinition, start: ISODate, end: ISODate): ResolvedDay[] {
  const out: ResolvedDay[] = [];
  if (diffDays(start, end) > SEARCH_LIMIT_DAYS) return out;
  for (const d of eachDay(start, end)) {
    const a = resolveDay(before, d);
    const b = resolveDay(after, d);
    if (a.open !== b.open || a.hours !== b.hours || a.start !== b.start) out.push(b);
  }
  return out;
}
