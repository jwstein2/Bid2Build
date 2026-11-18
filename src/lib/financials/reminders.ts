/**
 * Automatic payment reminders (fin_reminder_rules). Pure scheduling rules: the hourly customer-email job
 * (src/lib/comms/runner.ts) loads open invoices and asks these functions whether a reminder is due.
 *
 *   Before due ("balance_reminder"): first one `offsetDays` before the due date, then every
 *     `repeatEveryDays` (if set) until the due date, at most `maxReminders`.
 *   Past due ("overdue_reminder"): first one `offsetDays` after the due date (at least 1 day), then every
 *     `repeatEveryDays` (if set), at most `maxReminders`.
 *
 * Never two reminders for the same invoice within MIN_GAP_DAYS, never before SEND_HOUR in the book's
 * time zone, and nothing for an invoice that is paid, void, disputed or not issued (checked in SQL by
 * fin_reminder_suppressed, again right before sending).
 */
export type ReminderKind = "balance_reminder" | "overdue_reminder";
export const REMINDER_KINDS: readonly ReminderKind[] = ["balance_reminder", "overdue_reminder"];

export interface ReminderRule { kind: ReminderKind; enabled: boolean; offsetDays: number; repeatEveryDays: number | null; maxReminders: number }

export const DEFAULT_RULES: Record<ReminderKind, ReminderRule> = {
  balance_reminder: { kind: "balance_reminder", enabled: false, offsetDays: 3, repeatEveryDays: null, maxReminders: 1 },
  overdue_reminder: { kind: "overdue_reminder", enabled: false, offsetDays: 3, repeatEveryDays: 7, maxReminders: 3 },
};

/** Local hour (book time zone) from which reminders may go out. */
export const SEND_HOUR = 9;
/** Minimum days between two automatic reminders for one invoice (either kind). */
export const MIN_GAP_DAYS = 2;

type Row = Record<string, unknown>;

export function mapRule(r: Row | null | undefined, kind: ReminderKind): ReminderRule {
  if (!r) return { ...DEFAULT_RULES[kind] };
  return {
    kind, enabled: Boolean(r.enabled), offsetDays: Number(r.offset_days ?? DEFAULT_RULES[kind].offsetDays),
    repeatEveryDays: r.repeat_every_days == null ? null : Number(r.repeat_every_days), maxReminders: Number(r.max_reminders ?? 1),
  };
}

const DAY = 86_400_000;
const toUtc = (d: string) => { const [y, m, da] = d.split("-").map(Number); return Date.UTC(y, m - 1, da); };
export const addDays = (d: string, n: number) => new Date(toUtc(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);

/** Date the next reminder of this kind becomes due (YYYY-MM-DD), or null if no more are allowed. */
export function nextReminderDate(rule: ReminderRule, dueDate: string, alreadySent: number): string | null {
  if (!rule.enabled || alreadySent >= rule.maxReminders) return null;
  if (alreadySent > 0 && !rule.repeatEveryDays) return null;
  const step = (rule.repeatEveryDays ?? 0) * alreadySent;
  if (rule.kind === "balance_reminder") {
    const d = addDays(dueDate, -rule.offsetDays + step);
    return d <= dueDate ? d : null;
  }
  return addDays(dueDate, Math.max(1, rule.offsetDays) + step);
}

export interface ReminderCandidate { dueDate: string | null; balance: number; sentByKind: Partial<Record<ReminderKind, number>>; lastSentOn: string | null }

/**
 * Which reminder (if any) should be planned today for one invoice. Past due takes priority over
 * before-due; a "before due" reminder is never sent once the invoice is past due.
 */
export function reminderToPlan(rules: Record<ReminderKind, ReminderRule>, inv: ReminderCandidate, today: string): { kind: ReminderKind; sequence: number } | null {
  if (!inv.dueDate || !(inv.balance > 0)) return null;
  if (inv.lastSentOn && daysBetween(inv.lastSentOn, today) < MIN_GAP_DAYS) return null;
  const order: ReminderKind[] = today > inv.dueDate ? ["overdue_reminder"] : ["balance_reminder"];
  for (const kind of order) {
    const sent = inv.sentByKind[kind] ?? 0;
    const at = nextReminderDate(rules[kind], inv.dueDate, sent);
    if (at && today >= at) return { kind, sequence: sent + 1 };
  }
  return null;
}

/** Local date and hour in a time zone (falls back to America/Chicago for a bad zone). */
export function localNow(now: Date, timeZone: string): { date: string; hour: number } {
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = "America/Chicago"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** Statuses that count as "a reminder went (or is going) out". Canceled/skipped/failed-for-good don't count. */
export const COUNTED_STATUSES = ["scheduled", "approved", "sending", "sent", "delivered", "provider_accepted", "replied", "failed"] as const;

/** Plain-language summary of a rule, for the settings card. */
export function describeRule(r: ReminderRule): string {
  if (!r.enabled) return "Off";
  const when = r.kind === "balance_reminder" ? `${r.offsetDays} day${r.offsetDays === 1 ? "" : "s"} before the due date` : `${Math.max(1, r.offsetDays)} day${Math.max(1, r.offsetDays) === 1 ? "" : "s"} after the due date`;
  const repeat = r.maxReminders > 1 && r.repeatEveryDays ? `, then every ${r.repeatEveryDays} day${r.repeatEveryDays === 1 ? "" : "s"} (up to ${r.maxReminders})` : "";
  return `${when[0].toUpperCase()}${when.slice(1)}${repeat}`;
}
