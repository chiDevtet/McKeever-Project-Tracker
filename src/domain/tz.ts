/**
 * Timezone-aware staffing instants. Staffing blocks are entered as local
 * wall-clock times on a shift-start date in the calendar's IANA timezone and
 * resolved here to epoch milliseconds, so overnight shifts, cross-project
 * comparisons, and daylight-saving transitions are unambiguous.
 *
 * Rules (documented in docs/DECISIONS.md):
 * - Elapsed hours are real elapsed time between instants. An overnight shift
 *   across the autumn "fall back" transition therefore has one extra hour.
 * - A local time that does not exist (spring-forward gap) resolves to the
 *   instant after the gap; an ambiguous local time (fall-back overlap)
 *   resolves to its first occurrence.
 */

import { addDays, type ISODate } from "./dates";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

export function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const m = TIME_RE.exec(value);
  if (!m) throw new RangeError(`Invalid time of day: ${value} (expected HH:MM)`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function minutesOfDay(value: string): number {
  const { hour, minute } = parseTimeOfDay(value);
  return hour * 60 + minute;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
export function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const p = zonedParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/** Epoch ms for a local wall-clock time on a date in `timeZone`. */
export function zonedTimeToEpochMs(date: ISODate, time: string, timeZone: string): number {
  const { hour, minute } = parseTimeOfDay(time);
  const [y, mo, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, mo - 1, d, hour, minute);
  // Candidate offsets from instants just before and after the wall time cover
  // both sides of any transition; choose the earliest instant that maps back
  // to the requested wall time, else the instant after a gap.
  const offA = zoneOffsetMs(wall - 12 * 3_600_000, timeZone);
  const offB = zoneOffsetMs(wall + 12 * 3_600_000, timeZone);
  const candidates = [...new Set([wall - offA, wall - offB])].sort((a, b) => a - b);
  for (const c of candidates) {
    const p = zonedParts(c, timeZone);
    if (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall) return c;
  }
  // Nonexistent local time (spring-forward gap): use the later offset mapping.
  return wall - Math.min(offA, offB);
}

/** Local midnight at the start of `date` in `timeZone`. */
export function localMidnightMs(date: ISODate, timeZone: string): number {
  return zonedTimeToEpochMs(date, "00:00", timeZone);
}

/** [start, end) instants covering a local calendar date. */
export function localDayWindow(date: ISODate, timeZone: string): [number, number] {
  return [localMidnightMs(date, timeZone), localMidnightMs(addDays(date, 1), timeZone)];
}

/** Local calendar date of an instant in `timeZone`. */
export function epochMsToZonedDate(epochMs: number, timeZone: string): ISODate {
  const p = zonedParts(epochMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Local "HH:MM" of an instant in `timeZone`. */
export function epochMsToZonedTime(epochMs: number, timeZone: string): string {
  const p = zonedParts(epochMs, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Today's local date in a timezone (used to reject future actual dates). */
export function todayInTimeZone(timeZone: string, now: number = Date.now()): ISODate {
  return epochMsToZonedDate(now, timeZone);
}

export function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export const HOUR_MS = 3_600_000;
