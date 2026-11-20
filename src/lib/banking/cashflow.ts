/**
 * Owner Banking & Cash Flow math (pure, tested). Four sources are kept apart and labeled:
 *   bank      - transactions/balances the bank reported (read-only feed of the designated book)
 *   stripe    - Stripe events (paid invoices, refunds, fees, Stripe payouts to the bank, pending balance)
 *   scheduled - known obligations (scheduled contractor payouts, approved commissions, entered cash events, software)
 *   forecast  - estimates (run-rate), always labeled as such
 * A Stripe payout that lands in the bank is a TRANSFER of revenue already counted from paid invoices, so it is
 * matched and shown as a settlement, never added to income a second time.
 */
export type Category = "stripe_settlement" | "payout_funding" | "contractor_payout" | "payroll" | "software" | "refund" | "transfer" | "other_in" | "other_out";
export interface BankTxn { id: string; account_id: string; posted_on: string; description: string; amount: number }
export interface StripePayout { id: string; amount_cents: number; arrival_date: string; status: string }

const SOFTWARE = /netlify|supabase|google|gsuite|workspace|github|anthropic|resend|twilio|openai|cloudflare|mailerlite|n8n|plaid|apple\.com|microsoft|adobe|zoom|slack|notion/i;

export function categorize(t: Pick<BankTxn, "description" | "amount">): Category {
  const d = t.description;
  if (/stripe/i.test(d)) return t.amount > 0 ? "stripe_settlement" : "payout_funding";
  if (/transfer (to|from)|online transfer|xfer/i.test(d)) return "transfer";
  if (/gusto|adp|paychex|payroll|rippling|justworks/i.test(d)) return "payroll";
  if (t.amount < 0 && SOFTWARE.test(d)) return "software";
  if (/refund|reversal|chargeback/i.test(d)) return "refund";
  return t.amount > 0 ? "other_in" : "other_out";
}

export const CATEGORY_LABEL: Record<Category, string> = {
  stripe_settlement: "Stripe deposits (already counted as revenue)", payout_funding: "Stripe top-ups / payout funding", contractor_payout: "Contractor payouts",
  payroll: "Payroll", software: "Software subscriptions", refund: "Refunds / chargebacks", transfer: "Transfers between accounts", other_in: "Other deposits", other_out: "Other expenses",
};

/** Match Stripe payouts to bank deposits: same amount, bank date within 0-4 days after Stripe's arrival date. Each side matches once. */
export function matchStripeDeposits(bank: BankTxn[], payouts: StripePayout[]): { matched: { payout: StripePayout; txn: BankTxn }[]; unmatchedPayouts: StripePayout[]; unmatchedDeposits: BankTxn[] } {
  const deposits = bank.filter((t) => t.amount > 0 && categorize(t) === "stripe_settlement").sort((a, b) => a.posted_on.localeCompare(b.posted_on));
  const used = new Set<string>();
  const matched: { payout: StripePayout; txn: BankTxn }[] = [];
  const unmatchedPayouts: StripePayout[] = [];
  for (const p of [...payouts].filter((x) => x.status === "paid").sort((a, b) => a.arrival_date.localeCompare(b.arrival_date))) {
    const day = Date.parse(`${p.arrival_date}T00:00:00Z`);
    const t = deposits.find((x) => !used.has(x.id) && Math.round(x.amount * 100) === p.amount_cents && (() => { const g = (Date.parse(`${x.posted_on}T00:00:00Z`) - day) / 864e5; return g >= -1 && g <= 4; })());
    if (t) { used.add(t.id); matched.push({ payout: p, txn: t }); } else unmatchedPayouts.push(p);
  }
  return { matched, unmatchedPayouts, unmatchedDeposits: deposits.filter((d) => !used.has(d.id)) };
}

export interface CashSummary {
  cashCents: number | null; incomeCents: number; expenseCents: number; netCents: number; transferCents: number;
  byCategory: { category: Category; cents: number }[];
}

/** Month-to-date bank movement. Transfers between the owner's own accounts net to zero and are excluded. */
export function summarize(txns: BankTxn[], balances: { current: number | null; available: number | null; excluded: boolean }[], since: string): CashSummary {
  const inRange = txns.filter((t) => t.posted_on >= since);
  const by = new Map<Category, number>();
  let income = 0, expense = 0, transfer = 0;
  for (const t of inRange) {
    const c = categorize(t), cents = Math.round(t.amount * 100);
    by.set(c, (by.get(c) ?? 0) + cents);
    if (c === "transfer") { transfer += cents; continue; }
    if (cents > 0) income += cents; else expense += -cents;
  }
  const counted = balances.filter((b) => !b.excluded);
  const hasBal = counted.some((b) => b.available != null || b.current != null);
  const cash = hasBal ? counted.reduce((n, b) => n + Math.round(((b.available ?? b.current) ?? 0) * 100), 0) : null;
  return { cashCents: cash, incomeCents: income, expenseCents: expense, netCents: income - expense, transferCents: transfer,
    byCategory: [...by.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)) };
}

export interface Obligation { label: string; cents: number; due: string | null; source: "scheduled" | "forecast" }

/** Cash reserve: current cash minus known obligations in the window, plus expected Stripe settlements (pending balance). */
export function reserve(cashCents: number | null, obligations: Obligation[], expectedInCents: number): { afterCents: number | null; outCents: number } {
  const out = obligations.reduce((n, o) => n + o.cents, 0);
  return { afterCents: cashCents == null ? null : cashCents - out + expectedInCents, outCents: out };
}
