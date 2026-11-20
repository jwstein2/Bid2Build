import { resolveDeployContext } from "@/lib/config/deploy";

/**
 * Stripe TEST-mode safety for deployed copies of the app.
 *
 * Every Netlify context (production, deploy previews, branch deploys) talks to the SAME Supabase
 * database. A deploy preview with a Stripe test key would otherwise create test-mode customers for
 * real accounts: `billing_customers` holds one Stripe customer per user, so a real user who tried
 * checkout on a preview would be stuck with a test customer id that live checkout can't use.
 *
 * So on any deployed copy, test-mode checkout is limited to test accounts: emails ending in
 * `@built2bid.test`, or listed (comma-separated) in STRIPE_TEST_CHECKOUT_EMAILS. Local development
 * and unit tests (no Netlify context) are unrestricted. Live keys are untouched by this check;
 * assertModeAllowed() still gates them.
 */
type Env = Record<string, string | undefined>;

export const isTestKey = (key: string | undefined | null) => /^(sk|rk)_test_/.test(key ?? "");
export const isLiveKey = (key: string | undefined | null) => /^(sk|rk)_live_/.test(key ?? "");

export function isTestAccount(email: string | null | undefined, env: Env = process.env): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  if (e.endsWith("@built2bid.test")) return true;
  const list = (env.STRIPE_TEST_CHECKOUT_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(e);
}

/** True when this checkout must be refused: a test key on a deployed copy, for a non-test account. */
export function testCheckoutBlocked(key: string | undefined | null, email: string | null | undefined, env: Env = process.env): boolean {
  if (!isTestKey(key)) return false;
  if (resolveDeployContext(env) === "local") return false;
  return !isTestAccount(email, env);
}

export const TEST_CHECKOUT_MESSAGE =
  "This is a test copy of Built2Bid, so checkout only works for test accounts and nothing is charged. To subscribe for real, use built2bid.org.";
