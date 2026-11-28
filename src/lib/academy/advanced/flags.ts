import { isLiveKey, isTestKey } from "@/lib/billing/test-mode";

type Env = Record<string, string | undefined>;
const on = (v: string | undefined) => v === "on" || v === "true";

/**
 * Academy Advanced release switches (Netlify environment variables). All default OFF.
 *
 * - ACADEMY_ADVANCED_ENABLED=on            Advanced Learning pages exist for everyone (staff can always preview).
 *                                          The Manage → Advanced "Show to everyone" switch must also be on.
 * - ACADEMY_ADVANCED_BILLING_ENABLED=on    Checkout and upgrades work (test keys: test accounts only, as today).
 * - ACADEMY_ADVANCED_BILLING_LIVE=true     Also required with a LIVE Stripe key, on top of STRIPE_ALLOW_LIVE.
 * - ACADEMY_PRICE_AUTO_ADVANCE_ENABLED=on  Lets the admin "automatic advancement" setting take effect.
 */
export const isAdvancedFlagOn = (env: Env = process.env) => on(env.ACADEMY_ADVANCED_ENABLED);

export function isAdvancedBillingEnabled(env: Env = process.env): boolean {
  if (!on(env.ACADEMY_ADVANCED_BILLING_ENABLED)) return false;
  const key = env.STRIPE_SECRET_KEY ?? "";
  if (!key) return false;
  if (isLiveKey(key)) return env.ACADEMY_ADVANCED_BILLING_LIVE === "true" && env.STRIPE_ALLOW_LIVE === "true";
  return true;
}

export const isAutoAdvanceAllowed = (env: Env = process.env) => on(env.ACADEMY_PRICE_AUTO_ADVANCE_ENABLED);

/** Which price map rows apply: test keys use mode 'test', live keys 'live'. */
export function stripeMode(env: Env = process.env): "test" | "live" | null {
  const key = env.STRIPE_SECRET_KEY ?? "";
  if (isLiveKey(key)) return "live";
  if (isTestKey(key)) return "test";
  return null;
}
