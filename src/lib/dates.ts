/**
 * Date-only values are `YYYY-MM-DD` strings, never `Date` objects.
 *
 * Cleaning is a local-time business. A visit on the 14th is on the 14th
 * regardless of where the server is. Putting a date-only value in a `Date`
 * gets you midnight UTC, which is 7pm on the 13th in Chicago for half the
 * year, that is how you end up scheduling visits a day early.
 *
 * Arithmetic below goes through UTC getters/setters only, so it never picks
 * up a local offset. The single conversion to an absolute instant happens in
 * SQL, explicitly in America/Chicago, see toTimestamptz in db.ts.
 */

export type ISODate = string; // YYYY-MM-DD

export const TIMEZONE = "America/Chicago";

/** Visits start in the morning. We never publish or promise a duration. */
export const DEFAULT_VISIT_TIME = "09:00";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: string): value is ISODate {
  return ISO_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function assertISO(date: ISODate): void {
  if (!isISODate(date)) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
}

function toUTC(date: ISODate): Date {
  assertISO(date);
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

/** Today in the business's timezone, as a date string. */
export function today(timeZone: string = TIMEZONE): ISODate {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The hour of the day, 0 to 23, in the business's timezone. */
export function localHour(timeZone: string = TIMEZONE): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = toUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

/**
 * Add months, clamping to the last day of the target month.
 * Billing days are constrained to 1 to 28 so this clamp should never fire for
 * period math, but it keeps the helper honest for any other caller.
 */
export function addMonths(date: ISODate, months: number): ISODate {
  const d = toUTC(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return fromUTC(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: ISODate): number {
  return toUTC(date).getUTCDay();
}

export function firstWeekdayOnOrAfter(date: ISODate, targetWeekday: number): ISODate {
  const delta = (targetWeekday - weekday(date) + 7) % 7;
  return addDays(date, delta);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86_400_000);
}

export function compare(a: ISODate, b: ISODate): number {
  assertISO(a);
  assertISO(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: ISODate, b: ISODate): boolean {
  return compare(a, b) < 0;
}

export function isOnOrAfter(a: ISODate, b: ISODate): boolean {
  return compare(a, b) >= 0;
}

export function min(a: ISODate, b: ISODate): ISODate {
  return isBefore(a, b) ? a : b;
}

/** Human-facing, e.g. "Thursday, August 13". */
export function formatLong(date: ISODate, timeZone: string = TIMEZONE): string {
  assertISO(date);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * Every day, Sunday included. Named WEEKDAYS for historical reasons and
 * because the database column is preferred_weekday, but the list is not
 * limited to Monday through Friday and never was: Saturday was always here.
 * Sunday was the only day missing, and excluding it was turning away work for
 * no reason anybody could name.
 */
export const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;
