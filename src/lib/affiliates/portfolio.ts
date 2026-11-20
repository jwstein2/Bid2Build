/**
 * Affiliate portfolio math. Pure: turns affiliate_my_dashboard() into calendar entries, the annual earnings chart,
 * forecasts and CSV rows. Forecasts assume the customer keeps paying at today's eligible value; they are
 * illustrations, never promises, and the UI always labels them that way. Confirmed amounts come only from the ledger.
 */

export type LineStatus = "pending" | "payable" | "paid" | "held" | "ineligible" | "reversed" | "canceled";
export interface Line { id: string; year_no: number; date: string; amount_cents: number; status: LineStatus; reason: string | null; hold_until: string | null; paid_at: string | null; payable_at: string | null }
export interface Referral {
  key: string; label: string; business_initial: string; referred_at: string; campaign: string | null; status: string; plan: string | null;
  first_paid_on: string | null; anniversary_date: string | null; term_years: number | null; eligibility_end_date: string | null;
  cancel_requested: boolean; expected_cents: number | null; lines: Line[];
}
export interface Dashboard {
  affiliate: { id: string; code: string; status: string; name: string | null; email: string };
  today: string; referrals: Referral[];
  clicks: { total: number; last_30: number; by_campaign: Record<string, number> };
  payouts: { ref: string; mode: string; status: string; gross_cents: number; net_cents: number; scheduled_for: string | null; settled_at: string | null; failure_code: string | null }[];
  policy?: { commission_years?: number; hold_days?: number } | null;
}

export const ACTIVE = ["active", "trialing", "past_due"];

/** Add whole years to a YYYY-MM-DD date (Feb 29 → Feb 28 in non-leap years). */
export function addYears(date: string, n: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const ny = y + n;
  const last = new Date(Date.UTC(ny, m, 0)).getUTCDate();
  return `${ny}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function canStillEarn(r: Pick<Referral, "status" | "cancel_requested" | "anniversary_date">): boolean {
  return !!r.anniversary_date && ACTIVE.includes(r.status) && !r.cancel_requested;
}

export type EntryKind = "paid" | "payable" | "pending" | "held" | "not_paid" | "forecast";
export interface Entry { date: string; year_no: number; key: string; label: string; cents: number; kind: EntryKind; reason: string | null; confirmed: boolean; campaign: string | null }

const KIND: Record<LineStatus, EntryKind> = { paid: "paid", payable: "payable", pending: "pending", held: "held", ineligible: "not_paid", reversed: "not_paid", canceled: "not_paid" };

/** Every annual event of every referral: confirmed ledger lines plus forecast anniversaries still ahead in the term. */
export function entries(d: Pick<Dashboard, "referrals" | "today">): Entry[] {
  const out: Entry[] = [];
  for (const r of d.referrals) {
    if (!r.anniversary_date || !r.term_years) continue;
    for (let k = 1; k <= r.term_years; k++) {
      const date = addYears(r.anniversary_date, k - 1);
      const line = r.lines.find((l) => l.year_no === k);
      if (line) {
        out.push({ date: line.date, year_no: k, key: r.key, label: r.label, cents: line.amount_cents, kind: KIND[line.status] ?? "pending", reason: line.reason, confirmed: true, campaign: r.campaign });
      } else if (date >= d.today && canStillEarn(r) && (r.expected_cents ?? 0) > 0) {
        out.push({ date, year_no: k, key: r.key, label: r.label, cents: r.expected_cents!, kind: "forecast", reason: null, confirmed: false, campaign: r.campaign });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

/** One month of the commission calendar: the days of the month (Sunday first) with their entries. */
export function monthGrid(all: Entry[], month: string): { month: string; weeks: ({ date: string; entries: Entry[] } | null)[][]; total: { confirmed: number; forecast: number } } {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: ({ date: string; entries: Entry[] } | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  const prefix = `${y}-${String(m).padStart(2, "0")}`;
  let confirmed = 0, forecast = 0;
  for (let d = 1; d <= days; d++) {
    const date = `${prefix}-${String(d).padStart(2, "0")}`;
    const es = all.filter((e) => e.date === date);
    for (const e of es) { if (e.kind === "forecast") forecast += e.cents; else if (e.kind !== "not_paid") confirmed += e.cents; }
    cells.push({ date, entries: es });
  }
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  return { month: prefix, weeks, total: { confirmed, forecast } };
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export interface YearBar { year: number; paid: number; pending: number; projected: number }

/** Annual earnings chart: paid (historical), pending/payable/held (earned, not yet paid) and projected, by year. */
export function byYear(all: Entry[], filter: (e: Entry) => boolean = () => true): YearBar[] {
  const m = new Map<number, YearBar>();
  for (const e of all.filter(filter)) {
    if (e.kind === "not_paid") continue;
    const year = Number(e.date.slice(0, 4));
    const b = m.get(year) ?? { year, paid: 0, pending: 0, projected: 0 };
    if (e.kind === "paid") b.paid += e.cents; else if (e.kind === "forecast") b.projected += e.cents; else b.pending += e.cents;
    m.set(year, b);
  }
  return [...m.values()].sort((a, b) => a.year - b.year);
}

export interface Summary {
  referred: number; paying: number; active: number; canceled: number; clicks: number; conversion: number;
  paidCents: number; payableCents: number; pendingCents: number; heldCents: number; projectedCents: number; nextTwelveCents: number;
  upcoming: Entry[];
}

export function summarize(d: Dashboard): Summary {
  const all = entries(d);
  const sum = (k: EntryKind) => all.filter((e) => e.kind === k).reduce((s, e) => s + e.cents, 0);
  const in12 = addYears(d.today, 1);
  const paying = d.referrals.filter((r) => r.first_paid_on).length;
  return {
    referred: d.referrals.length, paying, active: d.referrals.filter(canStillEarn).length,
    canceled: d.referrals.filter((r) => r.first_paid_on && !canStillEarn(r)).length,
    clicks: d.clicks.total, conversion: d.clicks.total ? Math.round((d.referrals.length / d.clicks.total) * 1000) / 10 : 0,
    paidCents: sum("paid"), payableCents: sum("payable"), pendingCents: sum("pending"), heldCents: sum("held"), projectedCents: sum("forecast"),
    nextTwelveCents: all.filter((e) => e.kind === "forecast" && e.date < in12).reduce((s, e) => s + e.cents, 0),
    upcoming: all.filter((e) => e.date >= d.today && e.kind !== "not_paid").slice(0, 8),
  };
}

const KIND_LABEL: Record<EntryKind, string> = { paid: "Paid", payable: "Ready for payout", pending: "In 30-day hold", held: "On hold (review)", not_paid: "Not earned", forecast: "Forecast (if still paying)" };
export const kindLabel = (k: EntryKind) => KIND_LABEL[k];

const REASON: Record<string, string> = {
  not_paid_on_anniversary: "No paid subscription on the anniversary date", refunded: "Payment refunded", chargeback: "Payment disputed (chargeback)",
  partial_refund: "Partly refunded", attribution_ended: "Customer no longer attributed to you", attribution_moved: "Attribution moved after review",
  attribution_removed: "Attribution removed after review", affiliate_suspended: "Account paused", affiliate_terminated: "Agreement ended",
  affiliate_terminated_misconduct_review: "Under review", attribution_review: "Under review", late_invoice: "Payment recorded late",
  restored_after_review: "Restored after review", canceled_after_review: "Canceled after review",
};
export const reasonLabel = (r: string | null) => (r ? REASON[r] ?? r.replace(/_/g, " ") : null);

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  // Neutralize spreadsheet formulas and quote everything.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** CSV export of the earnings view (confirmed and forecast rows are labeled). */
export function toCsv(all: Entry[]): string {
  const head = ["date", "customer", "year", "status", "amount_usd", "confirmed", "campaign", "note"];
  const rows = all.map((e) => [e.date, e.label, e.year_no, kindLabel(e.kind), (e.cents / 100).toFixed(2), e.confirmed ? "yes" : "forecast", e.campaign, reasonLabel(e.reason)]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const STATUSES: { k: string; label: string; kinds: EntryKind[] }[] = [
  { k: "", label: "All", kinds: [] }, { k: "paid", label: "Paid", kinds: ["paid"] }, { k: "earned", label: "Earned, not paid", kinds: ["payable", "pending", "held"] },
  { k: "forecast", label: "Forecast", kinds: ["forecast"] }, { k: "not_paid", label: "Not earned", kinds: ["not_paid"] },
];

export function filterEntries(all: Entry[], f: { year?: string; month?: string; campaign?: string; status?: string }) {
  const st = STATUSES.find((s) => s.k === f.status);
  return all.filter((e) => (!f.year || e.date.startsWith(f.year)) && (!f.month || e.date.slice(5, 7) === f.month)
    && (!f.campaign || (e.campaign ?? "(none)") === f.campaign) && (!st?.kinds.length || st.kinds.includes(e.kind)));
}

export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
