/** Time helpers in the contractor's time zone (no dependencies). */

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1 };
}

export function safeTz(tz: string | null | undefined): string {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Chicago" }); return tz || "America/Chicago"; } catch { return "America/Chicago"; }
}

/** The instant that is `hour`:00 local time on local date `ymd` in `tz`. */
export function zonedInstant(ymd: string, hour: number, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d, hour);
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    const want = Date.UTC(y, m - 1, d, hour);
    guess += want - asUtc;
  }
  return new Date(guess);
}

export function localDate(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Next weekly send time (ISO weekday 1-7, local hour) strictly after `after`. */
export function nextWeeklySlot(after: Date, tz: string, weekday: number, hour: number): Date {
  const zone = safeTz(tz);
  const p = parts(after, zone);
  let ymd = localDate(after, zone);
  let delta = (weekday - p.wd + 7) % 7;
  for (let i = 0; i < 3; i++) {
    const base = new Date(`${ymd}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + delta);
    const cand = zonedInstant(base.toISOString().slice(0, 10), hour, zone);
    if (cand.getTime() > after.getTime()) return cand;
    ymd = base.toISOString().slice(0, 10);
    delta = 7;
  }
  return new Date(after.getTime() + 7 * 86_400_000);
}

export function formatWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: safeTz(tz), weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
