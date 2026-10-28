/**
 * Date-only construction dates. Values are ISO strings (YYYY-MM-DD) with no
 * time or zone; arithmetic uses epoch day numbers so it is unaffected by the
 * host timezone or daylight-saving transitions.
 */

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function assertISODate(value: unknown, label = "date"): ISODate {
  if (!isISODate(value)) throw new RangeError(`Invalid ${label}: ${String(value)}`);
  return value;
}

/** Days since 1970-01-01 for a date-only value. */
export function toDayNumber(date: ISODate): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function fromDayNumber(day: number): ISODate {
  const dt = new Date(day * DAY_MS);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** b - a in calendar days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export function isoWeekday(date: ISODate): number {
  const dow = new Date(toDayNumber(date) * DAY_MS).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Monday of the reporting week containing `date` (Monday-start weeks). */
export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, 1 - isoWeekday(date));
}

export function endOfWeek(date: ISODate): ISODate {
  return addDays(startOfWeek(date), 6);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(...dates: (ISODate | null | undefined)[]): ISODate | null {
  let out: ISODate | null = null;
  for (const d of dates) if (d && (out === null || d < out)) out = d;
  return out;
}

export function maxDate(...dates: (ISODate | null | undefined)[]): ISODate | null {
  let out: ISODate | null = null;
  for (const d of dates) if (d && (out === null || d > out)) out = d;
  return out;
}

/** Inclusive list of dates from start to end. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const s = toDayNumber(start);
  const e = toDayNumber(end);
  for (let d = s; d <= e; d++) out.push(fromDayNumber(d));
  return out;
}

/** Mondays of every reporting week overlapping [start, end]. */
export function eachWeek(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let w = startOfWeek(start);
  while (w <= end) {
    out.push(w);
    w = addDays(w, 7);
  }
  return out;
}

export function isWithin(date: ISODate, start: ISODate | null, end: ISODate | null): boolean {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

/** "07 Jun 2027" — unambiguous day-month-year used in reports and grids. */
export function formatDate(date: ISODate | null | undefined, fallback = "—"): string {
  if (!date) return fallback;
  const m = ISO_RE.exec(date);
  if (!m) return fallback;
  return `${m[3]} ${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

/** "Mon 07 Jun 2027". */
export function formatDateWithWeekday(date: ISODate | null | undefined, fallback = "—"): string {
  if (!date) return fallback;
  return `${WEEKDAY_SHORT[isoWeekday(date) - 1]} ${formatDate(date)}`;
}

/** Compact week heading: "07 Jun" with the year shown separately by callers. */
export function formatDayMonth(date: ISODate): string {
  const m = ISO_RE.exec(date);
  if (!m) return date;
  return `${m[3]} ${MONTH_SHORT[Number(m[2]) - 1]}`;
}

export function monthShort(date: ISODate): string {
  return MONTH_SHORT[Number(date.slice(5, 7)) - 1];
}

/** ISO-8601 week number (weeks start Monday; week 1 contains Jan 4th). */
export function isoWeekNumber(date: ISODate): number {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(yearStart, thursday) / 7) + 1;
}

/** Convert a JS Date holding a date-only DB value (UTC midnight) to ISODate. */
export function dateFromDb(value: Date | null | undefined): ISODate | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

/** ISODate to a JS Date at UTC midnight, the representation Prisma uses for @db.Date. */
export function dateToDb(value: ISODate): Date;
export function dateToDb(value: ISODate | null | undefined): Date | null;
export function dateToDb(value: ISODate | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${assertISODate(value)}T00:00:00.000Z`);
}
