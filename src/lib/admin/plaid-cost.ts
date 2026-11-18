/**
 * Plaid (read-only bank feeds) usage and cost estimate for the owner command center.
 *
 * Plaid has no billing API, so the cost is estimated from Built2Bid's own records:
 *  - Transactions is billed per connected Item (one bank login) per month: every real (non-practice) Plaid
 *    connection that was live at any point this calendar month counts once.
 *  - Balance is billed per call: every successful sync calls /accounts/balance/get once ("bank.synced" audit row).
 * Prices come from the owner's Plaid plan (Dashboard → Billing) via PLAID_PRICE_TRANSACTIONS_USD and
 * PLAID_PRICE_BALANCE_USD. An unset price stays unknown: it is never counted as $0. The Plaid invoice is the
 * source of truth; import it on Tech Stack & Costs.
 */

export interface PlaidConnRow { id: string; status: string; created_at: string; disconnected_at: string | null }
export interface PlaidPrices { transactionsCents: number | null; balanceCents: number | null }
export interface PlaidUsage {
  billableItems: number; activeItems: number; needsAttention: number; balanceCallsMtd: number;
  projectedBalanceCalls: number; prices: PlaidPrices;
  /** Estimated cost so far this month and projected for the whole month, in cents. null = a price is missing. */
  mtdCents: number | null; projectedCents: number | null;
}

/** "0.30" or "$0.30" → 30 (fractional cents kept). Blank or invalid → null. */
export function parsePrice(v: string | undefined): number | null {
  const s = (v ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s) * 100;
}

export function plaidPrices(env: Record<string, string | undefined> = process.env): PlaidPrices {
  return { transactionsCents: parsePrice(env.PLAID_PRICE_TRANSACTIONS_USD), balanceCents: parsePrice(env.PLAID_PRICE_BALANCE_USD) };
}

export function plaidUsage(conns: PlaidConnRow[], balanceCallsMtd: number, prices: PlaidPrices, now: Date): PlaidUsage {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsedDays = Math.max(1, (now.getTime() - monthStart) / 86_400_000);
  const billable = conns.filter((c) => !c.disconnected_at || Date.parse(c.disconnected_at) >= monthStart).length;
  const active = conns.filter((c) => c.status !== "disconnected").length;
  const attention = conns.filter((c) => ["needs_reauth", "revoked", "error", "institution_down"].includes(c.status)).length;
  const projectedCalls = Math.round((balanceCallsMtd / elapsedDays) * dim);
  const known = prices.transactionsCents != null && prices.balanceCents != null;
  const cost = (items: number, calls: number) => (known ? Math.round(items * prices.transactionsCents! + calls * prices.balanceCents!) : null);
  return {
    billableItems: billable, activeItems: active, needsAttention: attention, balanceCallsMtd, projectedBalanceCalls: projectedCalls, prices,
    mtdCents: cost(billable, balanceCallsMtd),
    // Projection assumes today's live connections stay connected for the rest of the month.
    projectedCents: cost(Math.max(billable, active), projectedCalls),
  };
}
