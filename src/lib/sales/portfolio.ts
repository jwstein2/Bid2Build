/**
 * Rep portfolio (10-year term). Pure: turns sales_my_portfolio() rows into a per-customer timeline and the
 * portfolio summary on /sales/portfolio. Forecasts assume the customer stays active at today's qualifying
 * value; they are illustrations, never promises, and are always labeled that way in the UI.
 */
export interface PortfolioLine { year_no: number; kind: string; period_month: string; amount_cents: number; status: string; reason: string | null; paid_at: string | null }
export interface PortfolioCustomer {
  key: string; business: string | null; email: string | null; plan: string | null; sub_status: string | null;
  attributed_at: string; first_paid_at: string | null; first_paid_month: string | null; term_years: number; basis_cents: number | null;
  ended: boolean; cancel_requested_at: string | null; lines: PortfolioLine[];
}
export interface Portfolio { policy_years: number; current_month: string; customers: PortfolioCustomer[] }

export type YearState = "paid" | "approved" | "earned" | "pending" | "ineligible" | "canceled" | "reversed" | "due" | "projected" | "not_expected";
export interface TimelineYear { year: number; month: string; state: YearState; cents: number; forecast: boolean; reason: string | null }

export const ACTIVE = ["active", "trialing", "past_due"];
const DONE: YearState[] = ["paid", "approved", "earned"];

export function addMonths(month: string, n: number): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}

/** Whether the customer can still earn future anniversaries (active, not ended, not set to cancel). */
export function stillEligible(c: Pick<PortfolioCustomer, "ended" | "sub_status" | "cancel_requested_at" | "first_paid_month">): boolean {
  return !!c.first_paid_month && !c.ended && !c.cancel_requested_at && ACTIVE.includes(c.sub_status ?? "");
}

/** One entry per year of the customer's term: what happened, or (future years) what is expected at today's value. */
export function timeline(c: PortfolioCustomer, currentMonth: string): TimelineYear[] {
  if (!c.first_paid_month) return [];
  const eligible = stillEligible(c);
  return Array.from({ length: c.term_years }, (_, k) => {
    const year = k + 1;
    const month = addMonths(c.first_paid_month!, 12 * k);
    const line = c.lines.find((l) => l.kind === "commission" && l.year_no === year);
    if (line) {
      const state = (["paid", "approved", "earned", "pending", "ineligible", "canceled", "reversed"].includes(line.status) ? line.status : "pending") as YearState;
      return { year, month, state, cents: line.amount_cents, forecast: false, reason: line.reason };
    }
    if (month < currentMonth) return { year, month, state: "ineligible", cents: 0, forecast: false, reason: "no_paid_invoice_in_anniversary_month" };
    if (!eligible) return { year, month, state: "not_expected", cents: 0, forecast: true, reason: c.ended ? "attribution_ended" : "customer_not_active" };
    return { year, month, state: month === currentMonth ? "due" : "projected", cents: c.basis_cents ?? 0, forecast: true, reason: null };
  });
}

export interface PortfolioSummary {
  referred: number; paying: number; active: number; canceled: number;
  earnedCents: number; pendingCents: number; paidCents: number; expectedFutureCents: number; annualRunCents: number;
  history: { year: number; cents: number; lines: number }[];
  renewingSoon: { key: string; name: string; month: string; cents: number }[];
  changed: { key: string; name: string; direction: "up" | "down"; fromCents: number; toCents: number }[];
}

export const customerName = (c: Pick<PortfolioCustomer, "business" | "email">) => c.business ?? c.email ?? "Customer";

export function summarize(p: Portfolio, soonMonths = 2): PortfolioSummary {
  const cur = p.current_month;
  const soonEnd = addMonths(cur, soonMonths);
  let earned = 0, pending = 0, paid = 0, future = 0, run = 0;
  const hist = new Map<number, { cents: number; lines: number }>();
  const renewingSoon: PortfolioSummary["renewingSoon"] = [];
  const changed: PortfolioSummary["changed"] = [];
  for (const c of p.customers) {
    for (const l of c.lines) {
      if (l.status === "paid") paid += l.amount_cents;
      else if (l.status === "approved" || l.status === "earned") earned += l.amount_cents;
      else if (l.status === "pending") pending += l.amount_cents;
      if (["paid", "approved", "earned"].includes(l.status)) {
        const y = Number(l.period_month.slice(0, 4));
        const h = hist.get(y) ?? { cents: 0, lines: 0 };
        h.cents += l.amount_cents; h.lines += 1; hist.set(y, h);
      }
    }
    const tl = timeline(c, cur);
    const ahead = tl.filter((t) => t.forecast && (t.state === "projected" || t.state === "due"));
    future += ahead.reduce((s, t) => s + t.cents, 0);
    if (stillEligible(c) && ahead.length) run += c.basis_cents ?? 0;
    const next = ahead[0];
    if (next && next.month <= soonEnd) renewingSoon.push({ key: c.key, name: customerName(c), month: next.month, cents: next.cents });
    const last = [...c.lines].filter((l) => l.kind === "commission" && l.amount_cents > 0).sort((a, b) => b.year_no - a.year_no)[0];
    if (last && c.basis_cents && c.basis_cents !== last.amount_cents && !c.ended) {
      changed.push({ key: c.key, name: customerName(c), direction: c.basis_cents > last.amount_cents ? "up" : "down", fromCents: last.amount_cents, toCents: c.basis_cents });
    }
  }
  return {
    referred: p.customers.length,
    paying: p.customers.filter((c) => c.first_paid_month).length,
    active: p.customers.filter(stillEligible).length,
    canceled: p.customers.filter((c) => c.first_paid_month && !stillEligible(c)).length,
    earnedCents: earned, pendingCents: pending, paidCents: paid, expectedFutureCents: future, annualRunCents: run,
    history: [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([year, h]) => ({ year, ...h })),
    renewingSoon: renewingSoon.sort((a, b) => a.month.localeCompare(b.month)),
    changed,
  };
}

/** Years (and months) left in the customer's term from the current month. Null before the first payment. */
export function termRemaining(c: Pick<PortfolioCustomer, "first_paid_month" | "term_years">, currentMonth: string): { years: number; months: number; endMonth: string } | null {
  if (!c.first_paid_month) return null;
  const endMonth = addMonths(c.first_paid_month, 12 * (c.term_years - 1));
  const [ey, em] = endMonth.split("-").map(Number), [cy, cm] = currentMonth.split("-").map(Number);
  const left = Math.max(0, (ey * 12 + em) - (cy * 12 + cm));
  return { years: Math.floor(left / 12), months: left % 12, endMonth };
}

export const STATE_LABEL: Record<YearState, string> = {
  paid: "Paid", approved: "Approved", earned: "Earned", pending: "In 30-day hold", ineligible: "Didn't qualify", canceled: "Canceled",
  reversed: "Reversed", due: "Due this month", projected: "Expected (if still active)", not_expected: "Not expected",
};
export const isDone = (s: YearState) => DONE.includes(s);
