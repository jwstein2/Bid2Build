/**
 * Working-day calendar arithmetic for project schedules. Dates are plain ISO days ("2026-11-13"),
 * computed in UTC so the result never depends on the server's or browser's time zone; the business
 * time zone is only used to decide what "today" is.
 *
 * Durations are counted in WORKING days, inclusive of start and end: a 1-day task starts and ends
 * on the same day. Contractors choose their own work week (not assumed Monday-Friday) and can add
 * non-working dates (holidays).
 */

export interface WorkCalendar {
  /** Working weekdays, 0 = Sunday ... 6 = Saturday. */
  workdays: number[];
  /** Non-working dates (holidays, shutdowns). */
  holidays: string[];
  /** IANA time zone of the business, e.g. "America/Chicago". */
  timezone: string;
}

export const DEFAULT_CALENDAR: WorkCalendar = { workdays: [1, 2, 3, 4, 5], holidays: [], timezone: "America/Chicago" };
export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 864e5;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
export const weekday = (d: string) => new Date(toMs(d)).getUTCDay();
/** Calendar days from a to b (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);

/** A calendar that can't loop forever: at least one working weekday, valid holiday dates. */
export function normalizeCalendar(c: Partial<WorkCalendar> | null | undefined): WorkCalendar {
  const workdays = [...new Set((c?.workdays ?? DEFAULT_CALENDAR.workdays).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  const holidays = [...new Set((c?.holidays ?? []).filter(isIsoDate))].sort().slice(0, 366);
  const timezone = typeof c?.timezone === "string" && validTimeZone(c.timezone) ? c.timezone : DEFAULT_CALENDAR.timezone;
  return { workdays: workdays.length ? workdays : DEFAULT_CALENDAR.workdays, holidays, timezone };
}

export function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export function isWorkday(d: string, cal: WorkCalendar): boolean {
  return cal.workdays.includes(weekday(d)) && !cal.holidays.includes(d);
}

/** Guard: a calendar with one working weekday and many holidays still finds a day within 2 years. */
const MAX_SCAN = 800;

export function nextWorkday(d: string, cal: WorkCalendar): string {
  let x = addDays(d, 1);
  for (let i = 0; i < MAX_SCAN && !isWorkday(x, cal); i++) x = addDays(x, 1);
  return x;
}

export function prevWorkday(d: string, cal: WorkCalendar): string {
  let x = addDays(d, -1);
  for (let i = 0; i < MAX_SCAN && !isWorkday(x, cal); i++) x = addDays(x, -1);
  return x;
}

/** The day itself when it's a working day, otherwise the next working day. */
export const snapForward = (d: string, cal: WorkCalendar) => (isWorkday(d, cal) ? d : nextWorkday(d, cal));
/** The day itself when it's a working day, otherwise the previous working day. */
export const snapBack = (d: string, cal: WorkCalendar) => (isWorkday(d, cal) ? d : prevWorkday(d, cal));

/**
 * Moves n working days: n > 0 forward, n < 0 back, n = 0 snaps forward to a working day.
 * shiftWorkdays(friday, 1) with a Mon-Fri week is the next Monday.
 */
export function shiftWorkdays(d: string, n: number, cal: WorkCalendar): string {
  let x = n === 0 ? snapForward(d, cal) : d;
  for (let i = 0; i < Math.abs(n); i++) x = n > 0 ? nextWorkday(x, cal) : prevWorkday(x, cal);
  return x;
}

/** Last working day of a task that starts on `start` (snapped forward) and takes `duration` working days. */
export function endFromStart(start: string, duration: number, cal: WorkCalendar): string {
  return shiftWorkdays(snapForward(start, cal), Math.max(1, Math.round(duration)) - 1, cal);
}

/** First working day of a task that ends on `end` (snapped back) and takes `duration` working days. */
export function startFromEnd(end: string, duration: number, cal: WorkCalendar): string {
  return shiftWorkdays(snapBack(end, cal), -(Math.max(1, Math.round(duration)) - 1), cal);
}

/** Working days from a to b inclusive (0 when b < a). */
export function workdaysBetween(a: string, b: string, cal: WorkCalendar): number {
  const span = daysBetween(a, b);
  if (span < 0) return 0;
  let n = 0;
  for (let i = 0; i <= span; i++) if (isWorkday(addDays(a, i), cal)) n++;
  return n;
}

/**
 * Signed working-day distance used to shift other tasks by "the same amount": the number of working
 * days a date moved (positive = later).
 */
export function workdayDelta(from: string, to: string, cal: WorkCalendar): number {
  if (from === to) return 0;
  return to > from ? workdaysBetween(addDays(from, 1), to, cal) : -workdaysBetween(to, addDays(from, -1), cal);
}

/** Today in the business time zone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function formatDay(d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

export function formatRange(a: string, b: string): string {
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return a === b ? formatDay(a, { month: "short", day: "numeric", year: "numeric" })
    : `${formatDay(a, sameYear ? undefined : { month: "short", day: "numeric", year: "numeric" })} – ${formatDay(b, { month: "short", day: "numeric", year: "numeric" })}`;
}
