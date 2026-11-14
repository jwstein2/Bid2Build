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
