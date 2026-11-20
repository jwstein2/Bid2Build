import "server-only";
import { getStripe } from "@/lib/billing/stripe";
import type { StripePayout } from "./cashflow";

export interface StripeCash { payouts: StripePayout[]; availableCents: number; pendingCents: number; grossCents: number; refundsCents: number; disputesCents: number; feesCents: number; fetchedAt: string }

/** Read-only Stripe figures for the cash page (payouts to the bank, balance, money in/out since `since`). Null if Stripe isn't reachable. */
export async function loadStripeCash(since: Date): Promise<StripeCash | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try {
    const stripe = getStripe();
    const gte = Math.floor(since.getTime() / 1000);
    const run = Promise.all([
      stripe.payouts.list({ created: { gte: gte - 7 * 86400 }, limit: 100 }).autoPagingToArray({ limit: 500 }),
      stripe.balance.retrieve(),
      stripe.balanceTransactions.list({ created: { gte }, limit: 100 }).autoPagingToArray({ limit: 5000 }),
    ]);
    const [payouts, bal, txns] = await Promise.race([run, new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 8000))]);
    const usd = (xs: { amount: number; currency: string }[]) => xs.filter((x) => x.currency === "usd").reduce((n, x) => n + x.amount, 0);
    const tx = txns as unknown as { type: string; amount: number; fee: number }[];
    return {
      payouts: payouts.map((p) => ({ id: p.id, amount_cents: p.amount, arrival_date: new Date(p.arrival_date * 1000).toISOString().slice(0, 10), status: p.status })),
      availableCents: usd(bal.available), pendingCents: usd(bal.pending),
      grossCents: tx.filter((x) => x.type === "charge" || x.type === "payment").reduce((n, x) => n + x.amount, 0),
      refundsCents: -tx.filter((x) => x.type === "refund" || x.type === "payment_refund").reduce((n, x) => n + x.amount, 0),
      disputesCents: -tx.filter((x) => x.type === "adjustment" || x.type === "dispute").reduce((n, x) => n + Math.min(x.amount, 0), 0),
      feesCents: tx.reduce((n, x) => n + (x.fee ?? 0), 0),
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
