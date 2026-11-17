/** Server-side environment helpers. Secrets are only read on the server. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export const isSupabaseConfigured = () => Boolean(publicEnv.supabaseUrl && publicEnv.supabaseKey);

export function serverEnv() {
  if (typeof window !== "undefined") throw new Error("serverEnv() must not run in the browser");
  return {
    supabaseServiceKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
    stripePriceAnnual: process.env.STRIPE_PRICE_ANNUAL ?? "",
    stripePriceEnterpriseBase: process.env.STRIPE_PRICE_ENTERPRISE_BASE ?? "",
    stripePriceEnterpriseSeat: process.env.STRIPE_PRICE_ENTERPRISE_SEAT ?? "",
    stripePricePmAddon: process.env.STRIPE_PRICE_PM_ADDON ?? "",
    stripePricePmAddonAnnual: process.env.STRIPE_PRICE_PM_ADDON_ANNUAL ?? "",
    stripePricePmEditor: process.env.STRIPE_PRICE_PM_EDITOR ?? "",
  };
}

export const isStripeConfigured = () => {
  const e = serverEnv();
  return Boolean(e.stripeSecretKey && e.stripePriceMonthly && e.stripePriceAnnual);
};

/**
 * Enterprise checkout is offered only once both Enterprise prices are configured, and with a live
 * Stripe key only after the owner switches it on (ENTERPRISE_CHECKOUT_LIVE=true), separately from
 * STRIPE_ALLOW_LIVE, so Enterprise can be verified before real customers can buy it.
 */
export const isEnterpriseConfigured = () => {
  const e = serverEnv();
  if (!isStripeConfigured() || !e.stripePriceEnterpriseBase || !e.stripePriceEnterpriseSeat) return false;
  if (/^(sk|rk)_live_/.test(e.stripeSecretKey) && process.env.ENTERPRISE_CHECKOUT_LIVE !== "true") return false;
  return true;
};

/** Project scheduling is shown only when switched on (it stays off in production until Phases 6-7 ship). */
export const isPmEnabled = () => process.env.NEXT_PUBLIC_PROJECT_SCHEDULING === "on";

/**
 * PM add-on purchases need the feature switched on and its Stripe prices configured. With a live key
 * they also need PM_BILLING_LIVE=true, separately from STRIPE_ALLOW_LIVE, so PM billing can be verified
 * before customers can buy it.
 */
export const isPmBillingConfigured = (kind: "addon" | "editor") => {
  const e = serverEnv();
  if (!isPmEnabled() || !isStripeConfigured()) return false;
  if (kind === "addon" ? !e.stripePricePmAddon : !e.stripePricePmEditor) return false;
  if (/^(sk|rk)_live_/.test(e.stripeSecretKey) && process.env.PM_BILLING_LIVE !== "true") return false;
  return true;
};

/**
 * Financial Command Center (Phase 1) is shown only when switched on with NEXT_PUBLIC_FINANCIALS=on. Off by
 * default: with it off there is no nav item, page, tab, settings section or API route (all answer 404).
 */
export const isFinancialsEnabled = () => process.env.NEXT_PUBLIC_FINANCIALS === "on";

/**
 * Solo Financials add-on purchases: Financials on and Stripe configured. With a live key they also need
 * FIN_BILLING_LIVE=true, so live charges are switched on deliberately (same pattern as PM billing).
 */
export const isFinBillingConfigured = () => {
  const e = serverEnv();
  if (!isFinancialsEnabled() || !isStripeConfigured()) return false;
  if (/^(sk|rk)_live_/.test(e.stripeSecretKey) && process.env.FIN_BILLING_LIVE !== "true") return false;
  return true;
};

/** One home for every pillar (owner decision 2026-11-17). Off: /dashboard stays the landing page. */
export const isUnifiedHomeEnabled = () => process.env.NEXT_PUBLIC_UNIFIED_HOME === "on";
