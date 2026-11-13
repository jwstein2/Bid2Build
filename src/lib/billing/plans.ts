/**
 * The approved paid plans, shared by every screen that shows a price and by the checkout endpoint.
 *
 * The client only ever sends a plan id ("monthly" | "annual"). The server maps it to the Stripe
 * price configured in STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL and checks that price's amount,
 * currency and interval against this table before opening Checkout, so the price a contractor
 * sees here is the price Stripe charges.
 */
export const PLAN_IDS = ["monthly", "annual"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const isPlanId = (v: unknown): v is PlanId => typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);

type PlanDef = { id: PlanId; name: string; amountCents: number; currency: "usd"; interval: "month" | "year" };

const DEFS: Record<PlanId, PlanDef> = {
  monthly: { id: "monthly", name: "Unlimited Monthly", amountCents: 1999, currency: "usd", interval: "month" },
  annual: { id: "annual", name: "Unlimited Annual", amountCents: 14900, currency: "usd", interval: "year" },
};

/** "$19.99", "$149" (whole dollars drop the cents). */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/** Annual price spread over 12 months, rounded to the cent. */
export function monthlyEquivalentCents(annualCents: number): number {
  return Math.round(annualCents / 12);
}

/** Savings of paying annually vs. 12 monthly payments, as a whole percentage (rounded to nearest). */
export function annualSavingsPercent(monthlyCents: number, annualCents: number): number {
  const yearOfMonthly = monthlyCents * 12;
  return Math.round(((yearOfMonthly - annualCents) / yearOfMonthly) * 100);
}

export type PlanDisplay = PlanDef & {
  price: string;
  /** "/month" or "/year" */
  per: string;
  /** "Billed monthly" / "Billed annually" */
  billing: string;
};

export function planDisplay(id: PlanId): PlanDisplay {
  const d = DEFS[id];
  return { ...d, price: formatUsd(d.amountCents), per: d.interval === "month" ? "/month" : "/year", billing: d.interval === "month" ? "Billed monthly" : "Billed annually" };
}

export const MONTHLY = planDisplay("monthly");
export const ANNUAL = planDisplay("annual");
export const ANNUAL_MONTHLY_EQUIVALENT = formatUsd(monthlyEquivalentCents(ANNUAL.amountCents));
export const ANNUAL_SAVINGS_PERCENT = annualSavingsPercent(MONTHLY.amountCents, ANNUAL.amountCents);

/** The expected Stripe price shape for a plan (checked server-side against the configured price). */
export function expectedStripePrice(id: PlanId) {
  const d = DEFS[id];
  return { unit_amount: d.amountCents, currency: d.currency, interval: d.interval, interval_count: 1 };
}

type StripePriceLike = { unit_amount: number | null; currency: string; recurring: { interval: string; interval_count: number } | null; active?: boolean };

/** Returns a reason string if a Stripe price does not match the plan we display, else null. */
export function priceMismatch(id: PlanId, price: StripePriceLike): string | null {
  const e = expectedStripePrice(id);
  if (price.active === false) return "price is archived";
  if (price.unit_amount !== e.unit_amount) return `amount ${price.unit_amount} != ${e.unit_amount}`;
  if (price.currency !== e.currency) return `currency ${price.currency} != ${e.currency}`;
  if (!price.recurring) return "price is not recurring";
  if (price.recurring.interval !== e.interval || price.recurring.interval_count !== e.interval_count) return `interval ${price.recurring.interval_count} ${price.recurring.interval} != 1 ${e.interval}`;
  return null;
}
