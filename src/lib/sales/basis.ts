/**
 * Sales commission basis: one month of a customer's qualifying subscription value, in cents, before
 * tax. Pure (no Stripe or database calls) so the webhook and tests share it. Which items count and how
 * annual plans convert are owner policy (public.sales_settings), passed in here, never assumed.
 */
import { enterpriseMonthlyCents, ENTERPRISE_BASE_CENTS, ENTERPRISE_INCLUDED_USERS } from "../enterprise/pricing";

export type AnnualBasis = "divide_12" | "monthly_list" | "full_payment";
export type RefundPolicy = "month_end_clawback" | "hold_30_no_clawback" | "never_reverse";
export type ValueScope = "plan_seats" | "all_items" | "base_plan";

export interface SalesPolicy {
  annual_basis: AnnualBasis;
  refund_policy: RefundPolicy;
  value_scope: ValueScope;
  commission_years: number;
  attribution_window_days: number;
  time_zone?: string;
  policy_confirmed_at?: string | null;
}

export const DEFAULT_POLICY: SalesPolicy = {
  annual_basis: "monthly_list", refund_policy: "hold_30_no_clawback", value_scope: "all_items", commission_years: 3, attribution_window_days: 90,
};

export interface BasisItem {
  quantity?: number | null;
  price: { id: string; unit_amount?: number | null; recurring?: { interval?: string | null; interval_count?: number | null } | null };
}

export interface BasisPrices {
  monthly: string;
  annual: string;
  enterpriseBase?: string;
  enterpriseSeat?: string;
  /** Monthly plan list price in cents, used only when annual_basis = 'monthly_list'. */
  monthlyListCents?: number | null;
}

export type ItemKind = "plan" | "seat" | "addon";

export interface BasisLine { price: string; kind: ItemKind; counted: boolean; period_cents: number; months: number; month_cents: number }
export interface Basis { cents: number; lines: BasisLine[]; policy: Pick<SalesPolicy, "annual_basis" | "value_scope"> }

export function itemKind(priceId: string, p: BasisPrices): ItemKind {
  if (priceId === p.monthly || priceId === p.annual || (p.enterpriseBase && priceId === p.enterpriseBase)) return "plan";
  if (p.enterpriseSeat && priceId === p.enterpriseSeat) return "seat";
  return "addon";
}

/** Months in one billing period of a recurring price (year = 12). Null for one-off prices. */
export function periodMonths(recurring: BasisItem["price"]["recurring"]): number | null {
  const every = Math.max(1, recurring?.interval_count ?? 1);
  switch (recurring?.interval) {
    case "month": return every;
    case "year": return 12 * every;
    case "week": return (12 * every) / 52;
    case "day": return (12 * every) / 365;
    default: return null;
  }
}

function counts(kind: ItemKind, scope: ValueScope): boolean {
  if (scope === "all_items") return true;
  if (scope === "plan_seats") return kind !== "addon";
  return kind === "plan";
}

export function commissionBasis(items: BasisItem[], policy: Pick<SalesPolicy, "annual_basis" | "value_scope">, p: BasisPrices): Basis {
  const lines: BasisLine[] = [];
  let total = 0;
  for (const i of items) {
    const qty = Math.max(0, i.quantity ?? 1);
    if (!i.price?.id || qty === 0) continue;
    const kind = itemKind(i.price.id, p);
    const months = periodMonths(i.price.recurring);
    if (months == null) continue;
    const period = kind === "seat"
      ? enterpriseMonthlyCents(ENTERPRISE_INCLUDED_USERS + qty) - ENTERPRISE_BASE_CENTS
      : (i.price.unit_amount ?? 0) * qty;
    let month: number;
    if (months <= 1) month = Math.round(period / months);
    else if (policy.annual_basis === "full_payment") month = period;
    else if (policy.annual_basis === "monthly_list" && kind === "plan" && i.price.id === p.annual && p.monthlyListCents) month = p.monthlyListCents;
    else month = Math.round(period / months);
    const counted = counts(kind, policy.value_scope) && month > 0;
    if (counted) total += month;
    lines.push({ price: i.price.id, kind, counted, period_cents: period, months, month_cents: month });
  }
  return { cents: total, lines, policy: { annual_basis: policy.annual_basis, value_scope: policy.value_scope } };
}

/** Sale month and anniversary months for the commission term, as YYYY-MM-01 strings. */
export function commissionMonths(firstPaidMonth: string, years: number): string[] {
  const [y, m] = firstPaidMonth.split("-").map(Number);
  return Array.from({ length: Math.max(0, years) }, (_, k) => `${y + k}-${String(m).padStart(2, "0")}-01`);
}

/**
 * Projected future commissions for an active customer at today's basis: each remaining anniversary
 * month in the term that hasn't started yet. Illustrative only (assumes no cancellation or price change).
 */
export function projectedCommissions(firstPaidMonth: string | null, basisCents: number | null, years: number, currentMonth: string): { month: string; cents: number }[] {
  if (!firstPaidMonth || !basisCents) return [];
  return commissionMonths(firstPaidMonth, years).slice(1).filter((m) => m > currentMonth).map((month) => ({ month, cents: basisCents }));
}

/**
 * List MRR for Compensation V3 (one definition across the compensation engine): every recurring item on
 * the subscription (plan, Enterprise seats, add-ons) at its price divided by the months in its billing
 * period, so $199/yr = $16.58/mo. The database then takes the smaller of this and what the latest
 * full-period invoice actually collected (pre-tax, net of refunds), which removes discounts and unpaid
 * amounts. Unlike the commission basis, annual plans are never valued at the monthly list price here.
 */
export function listMrr(items: BasisItem[], p: BasisPrices): Basis {
  return commissionBasis(items, { annual_basis: "divide_12", value_scope: "all_items" }, { ...p, monthlyListCents: null });
}

/** Months covered by an invoice's subscription lines (the longest recurring period on it), or null. */
export function invoicePeriodMonths(items: BasisItem[]): number | null {
  const m = items.map((i) => periodMonths(i.price?.recurring)).filter((x): x is number => x != null);
  return m.length ? Math.max(...m) : null;
}
