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
  };
}

export const isStripeConfigured = () => {
  const e = serverEnv();
  return Boolean(e.stripeSecretKey && e.stripePriceMonthly && e.stripePriceAnnual);
};
