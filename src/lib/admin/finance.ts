/**
 * Five-number Business Scorecard (Revenue, Profit, CAC, Churn, Enterprise Value) and supporting unit
 * economics. Pure functions over the canonical account facts (model.ts) and the owner's cost records
 * (costs.ts). Every figure says where it came from and whether it is verified, entered or estimated.
 */
import { ACQUISITION, COGS, CATEGORIES, type Category } from "./costs";
import { DAY, compare, inWindow, monthlyCents, payingAt, ratio, revenueModel, windowOf, type AccountFact, type Compare, type CostRow, type Ratio } from "./model";
import type { Range } from "./view";

export type Confidence = "verified" | "entered" | "estimated" | "insufficient";
export const CONFIDENCE_LABEL: Record<Confidence, string> = { verified: "Verified (provider)", entered: "Owner-entered", estimated: "Estimated", insufficient: "Insufficient data" };

/** Money that moved through Stripe in the window (read-only), already excluding non-genuine customers where Stripe exposes the customer. */
export interface StripeMoney { grossCents: number; refundsCents: number; feesCents: number; invoices: number; fetchedAt: string; feesScope: "account" }

export interface Line { label: string; cents: number | null; source: string; confidence: Confidence }

export interface Scorecard {
  period: { start: number; end: number; days: number; label: string };
  revenue: { cashGross: number | null; refunds: number | null; net: number | null; mrrCents: number; arrCents: number; mrrStartCents: number; growth: Compare; source: "stripe" | "unavailable"; fetchedAt: string | null; confidence: Confidence };
  profit: { revenueCents: number | null; revenueBasis: "stripe_net" | "mrr_estimate"; lines: Line[]; expensesCents: number; operatingCents: number | null; marginPct: number | null; missing: string[]; confidence: Confidence };
  cac: { spendCents: number; adSpendCents: number; toolsCents: number; newPaying: number; blendedCents: number | null; costPerActivationCents: number | null; activated: number; small: boolean; confidence: Confidence };
  churn: { startBase: number; ended: number; customer: Ratio; mrrStartCents: number; lostMrrCents: number; revenuePct: number | null; scheduled: number; retention: Ratio; confidence: Confidence };
  ev: { arrCents: number; multiples: { low: number; base: number; high: number }; values: { low: number; base: number; high: number }; profitBased: { annualProfitCents: number; multiple: number; value: number } | null; sufficient: boolean; reason: string };
  unit: {
    arpaCents: number | null; grossMarginPct: number | null; ltvCents: number | null; ltvReason: string; ltvToCac: number | null; paybackMonths: number | null;
    infraPerActiveCents: number | null; infraPerFinalizedCents: number | null; costPerSignedCents: number | null; nrr: null; nrrReason: string;
  };
}

export interface ScorecardInput {
  facts: AccountFact[]; range: Range; now: Date;
  stripe: StripeMoney | null;
  /** Allocated owner-entered costs in the window by category (costs.costsForWindow). */
  costsByCategory: Map<Category, number>;
  /** Advertising spend entered on Marketing (marketing_costs). */
  marketingCosts: CostRow[];
  /** AI usage cost measured by the app's own log (ai_generations) in the window, in cents; null if unreadable. */
  aiMeasuredCents: number | null;
  /** True when the owner has dated Anthropic charges in the window (then the measured log is not added, to avoid double counting). */
  aiLedgered: boolean;
  /** Active services with no cost entered (names). */
  missingCosts: string[];
  activeBusinesses30d: number; finalizedInWindow: number; signedInWindow: number;
  multiples?: Partial<{ low: number; base: number; high: number; profit: number }>;
}

/** Round a valuation to a sensible precision so a tiny company is not shown to the dollar. */
export function roundValuation(cents: number): number {
  const d = cents / 100;
  const step = d < 10_000 ? 500 : d < 100_000 ? 1_000 : d < 1_000_000 ? 10_000 : 100_000;
  return Math.round(d / step) * step * 100;
}

const clampMultiple = (v: number | undefined, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 50 ? Math.round(v * 10) / 10 : fallback);

export function scorecard(i: ScorecardInput): Scorecard {
  const { facts, range, now } = i;
  const w = windowOf(range, now); const days = range.days;
  const rev = revenueModel(facts, range, now);
  const mrrStart = facts.filter((f) => payingAt(f, w.start)).reduce((n, f) => n + monthlyCents(f.sub!), 0);

  // Revenue: cash from Stripe when reachable; list-price MRR/ARR always (labeled as run rate).
  const gross = i.stripe ? i.stripe.grossCents : null;
  const refunds = i.stripe ? i.stripe.refundsCents : null;
  const net = gross != null && refunds != null ? gross - refunds : null;
  const revenue = {
    cashGross: gross, refunds, net, mrrCents: rev.mrrCents, arrCents: rev.arrCents, mrrStartCents: mrrStart,
    growth: compare(rev.mrrCents, mrrStart), source: i.stripe ? "stripe" as const : "unavailable" as const, fetchedAt: i.stripe?.fetchedAt ?? null,
    confidence: (i.stripe ? "verified" : "estimated") as Confidence,
  };

  // Profit (provisional operating estimate).
  const cat = (c: Category) => i.costsByCategory.get(c) ?? 0;
  const adSpend = Math.round(i.marketingCosts.reduce((n, c) => n + (Number(c.amount_usd) || 0), 0) * 100);
  const aiCents = i.aiLedgered ? cat("ai") : cat("ai") + (i.aiMeasuredCents ?? 0);
  const infra = cat("hosting") + cat("database") + cat("domains") + cat("email") + cat("monitoring");
  const software = cat("devtools") + cat("automation");
  const tools = cat("marketing") + cat("prospecting");
  const lines: Line[] = [
    { label: "Infrastructure (hosting, database, domain, email, monitoring)", cents: infra, source: "Tech Stack & Costs (allocated)", confidence: "entered" },
    { label: "AI / API usage", cents: aiCents, source: i.aiLedgered ? "Dated charges in Tech Stack & Costs" : "App usage log (ai_generations) + entered costs", confidence: i.aiLedgered ? "entered" : "estimated" },
    { label: "Software subscriptions", cents: software, source: "Tech Stack & Costs (allocated)", confidence: "entered" },
    { label: "Marketing: advertising", cents: adSpend, source: "Marketing spend ledger", confidence: "entered" },
    { label: "Marketing & prospecting tools", cents: tools, source: "Tech Stack & Costs (allocated)", confidence: "entered" },
    { label: "Payment processing (Stripe fees)", cents: i.stripe ? i.stripe.feesCents : null, source: i.stripe ? "Stripe balance transactions (whole account)" : "Stripe not reachable", confidence: i.stripe ? "verified" : "insufficient" },
    { label: "Other operating", cents: cat("other") + cat("payments"), source: "Tech Stack & Costs (allocated)", confidence: "entered" },
  ];
  const expenses = lines.reduce((n, l) => n + (l.cents ?? 0), 0);
  const revenueForProfit = net ?? Math.round(rev.mrrCents * (days / 30.4375));
  const operating = revenueForProfit - expenses;
  const missing = [...i.missingCosts, ...(i.stripe ? [] : ["Stripe fees"])];
  const profit = {
    revenueCents: revenueForProfit, revenueBasis: (net != null ? "stripe_net" : "mrr_estimate") as "stripe_net" | "mrr_estimate",
    lines, expensesCents: expenses, operatingCents: operating,
    marginPct: revenueForProfit > 0 ? Math.round((operating / revenueForProfit) * 100) : null, missing,
    confidence: (missing.length ? "estimated" : "entered") as Confidence,
  };

  // CAC: acquisition spend in the window ÷ new paying customers in the window (same window).
  const newPaying = facts.filter((f) => f.everPaid && inWindow(f.paidStartedAt, w.start, w.end)).length;
  const activated = facts.filter((f) => inWindow(f.firstFinalizedAt, w.start, w.end)).length;
  const spend = adSpend + ACQUISITION.reduce((n, c) => n + cat(c), 0);
  const cac = {
    spendCents: spend, adSpendCents: adSpend, toolsCents: spend - adSpend, newPaying,
    blendedCents: newPaying > 0 ? Math.round(spend / newPaying) : null,
    costPerActivationCents: activated > 0 ? Math.round(spend / activated) : null, activated,
    small: newPaying > 0 && newPaying < 20, confidence: (spend === 0 ? "insufficient" : "entered") as Confidence,
  };

  // Churn: paid subscriptions that ended in the window ÷ paying base at the window start.
  const base = facts.filter((f) => payingAt(f, w.start));
  const ended = base.filter((f) => inWindow(f.paidEndedAt, w.start, w.end));
  const lost = ended.reduce((n, f) => n + monthlyCents(f.sub!), 0);
  const everPaid = facts.filter((f) => f.everPaid);
  const churn = {
    startBase: base.length, ended: ended.length, customer: ratio(ended.length, base.length), mrrStartCents: mrrStart, lostMrrCents: lost,
    revenuePct: mrrStart > 0 ? Math.round((lost / mrrStart) * 1000) / 10 : null, scheduled: rev.scheduledCancel,
    retention: ratio(everPaid.filter((f) => f.paying).length, everPaid.length),
    confidence: (base.length >= 20 ? "verified" : "insufficient") as Confidence,
  };

  // Enterprise value (illustrative): ARR × owner-adjustable revenue multiples.
  const m = { low: clampMultiple(i.multiples?.low, 1), base: clampMultiple(i.multiples?.base, 3), high: clampMultiple(i.multiples?.high, 5) };
  const firstPaid = Math.min(...facts.filter((f) => f.paidStartedAt).map((f) => Date.parse(f.paidStartedAt!)), Infinity);
  const monthsOfRevenue = Number.isFinite(firstPaid) ? (now.getTime() - firstPaid) / (30.4375 * DAY) : 0;
  const sufficient = rev.paying >= 10 && monthsOfRevenue >= 6;
  const annualProfit = profit.operatingCents != null ? Math.round(profit.operatingCents * (365 / days)) : 0;
  const pm = clampMultiple(i.multiples?.profit, 3);
  const ev = {
    arrCents: rev.arrCents, multiples: m,
    values: { low: roundValuation(rev.arrCents * m.low), base: roundValuation(rev.arrCents * m.base), high: roundValuation(rev.arrCents * m.high) },
    profitBased: annualProfit > 0 && !missing.length && monthsOfRevenue >= 12 ? { annualProfitCents: annualProfit, multiple: pm, value: roundValuation(annualProfit * pm) } : null,
    sufficient,
    reason: sufficient ? "Based on current ARR run rate." : `Limited history: ${rev.paying} paying customer${rev.paying === 1 ? "" : "s"} and ${Math.max(0, Math.floor(monthsOfRevenue))} month${Math.floor(monthsOfRevenue) === 1 ? "" : "s"} of paid revenue. Treat these figures as a rough illustration only.`,
  };

  // Unit economics (secondary). LTV only with enough paid history to estimate churn.
  const arpa = rev.paying ? Math.round(rev.mrrCents / rev.paying) : null;
  const cogsCents = COGS.reduce((n, c) => n + (c === "ai" ? aiCents : cat(c)), 0) + (i.stripe?.feesCents ?? 0);
  const gm = revenueForProfit > 0 && !i.missingCosts.length ? Math.round(((revenueForProfit - cogsCents) / revenueForProfit) * 100) : null;
  const monthlyChurn = churn.customer.pct != null ? (churn.customer.n / churn.customer.d) * (30.4375 / days) : null;
  const ltvOk = everPaid.length >= 20 && monthsOfRevenue >= 6 && monthlyChurn != null && monthlyChurn > 0 && gm != null && arpa != null;
  const ltv = ltvOk ? Math.round((arpa! * (gm! / 100)) / monthlyChurn!) : null;
  const infraTotal = infra + aiCents;
  const unit = {
    arpaCents: arpa, grossMarginPct: gm, ltvCents: ltv,
    ltvReason: ltvOk ? "ARPA × gross margin ÷ monthly customer churn" : "Not enough paid history (needs ≥ 20 customers who have paid, 6 months of revenue and an observed churn rate).",
    ltvToCac: ltv != null && cac.blendedCents ? Math.round((ltv / cac.blendedCents) * 10) / 10 : null,
    paybackMonths: cac.blendedCents && arpa && gm ? Math.round((cac.blendedCents / (arpa * (gm / 100))) * 10) / 10 : null,
    infraPerActiveCents: i.activeBusinesses30d ? Math.round(infraTotal / i.activeBusinesses30d) : null,
    infraPerFinalizedCents: i.finalizedInWindow ? Math.round(infraTotal / i.finalizedInWindow) : null,
    costPerSignedCents: i.signedInWindow ? Math.round(expenses / i.signedInWindow) : null,
    nrr: null, nrrReason: "Needs 12 months of paid cohorts. Built2Bid launched paid plans on 2026-11-13.",
  };

  return { period: { start: w.start, end: w.end, days, label: range.label }, revenue, profit, cac, churn, ev, unit };
}

export const CATEGORY_LABEL = CATEGORIES;
