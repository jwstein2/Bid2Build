/**
 * Outreach timing rules, all in America/Chicago (Central Time, DST-aware):
 *  - follow-up: once, `followUpHours` (default 72) after the initial email if there's no reply;
 *  - response deadline: the first Friday 5:00 PM CT that is at least 48 hours after the follow-up;
 *  - sends only on weekdays inside the owner's business hours.
 */
export const TZ = "America/Chicago";
const DAY = 86_400_000;

interface Parts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function centralParts(d: Date): Parts {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday: WEEKDAYS[p.weekday] };
}

/** The UTC instant of a Central wall-clock time (tries both CST/CDT offsets). */
export function centralTime(year: number, month: number, day: number, hour: number, minute = 0): Date {
  for (const offset of [5, 6]) {
    const d = new Date(Date.UTC(year, month - 1, day, hour + offset, minute));
    const p = centralParts(d);
    if (p.day === day && p.hour === hour && p.minute === minute) return d;
  }
  return new Date(Date.UTC(year, month - 1, day, hour + 6, minute));
}

/** First Friday 5:00 PM Central at least `minHours` (48) after `followUpSentAt`. */
export function responseDeadline(followUpSentAt: Date, minHours = 48): Date {
  const earliest = followUpSentAt.getTime() + minHours * 3_600_000;
  for (let i = 0; i < 21; i++) {
    const p = centralParts(new Date(followUpSentAt.getTime() + i * DAY));
    if (p.weekday !== 5) continue;
    const candidate = centralTime(p.year, p.month, p.day, 17, 0);
    if (candidate.getTime() >= earliest) return candidate;
  }
  throw new Error("no deadline found");
}

export function followUpDue(initialSentAt: Date, hours = 72): Date {
  return new Date(initialSentAt.getTime() + hours * 3_600_000);
}

export function inBusinessHours(now: Date, startHour = 9, endHour = 17): boolean {
  const p = centralParts(now);
  return p.weekday >= 1 && p.weekday <= 5 && p.hour >= startHour && p.hour < endHour;
}

/** `now` if inside business hours, else the next weekday opening. */
export function nextBusinessTime(now: Date, startHour = 9, endHour = 17): Date {
  if (inBusinessHours(now, startHour, endHour)) return now;
  for (let i = 0; i < 8; i++) {
    const p = centralParts(new Date(now.getTime() + i * DAY));
    if (p.weekday === 0 || p.weekday === 6) continue;
    const open = centralTime(p.year, p.month, p.day, startHour, 0);
    if (open.getTime() > now.getTime()) return open;
  }
  return now;
}

/** Start of today in Central time (for the daily send limit). */
export function centralDayStart(now: Date): Date {
  const p = centralParts(now);
  return centralTime(p.year, p.month, p.day, 0, 0);
}

/** Add business days (Mon-Fri) to a date, landing at the business-day opening. */
export function addBusinessDays(from: Date, days: number, startHour = 9): Date {
  let d = from;
  let left = days;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    const w = centralParts(d).weekday;
    if (w !== 0 && w !== 6) left--;
  }
  const p = centralParts(d);
  return centralTime(p.year, p.month, p.day, startHour, 0);
}
