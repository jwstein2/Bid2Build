import "server-only";
import { assertModeAllowed } from "@/lib/billing/stripe";
import { TEST_CHECKOUT_MESSAGE, testCheckoutBlocked } from "@/lib/billing/test-mode";
import { getUser, type SessionUser } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { fail, rateLimit, sameOrigin } from "@/lib/http/api";
import { advancedState } from "./server";
import { isAdvancedBillingEnabled, stripeMode } from "./flags";

/** Shared checks for every Academy Advanced billing endpoint. Returns the user and Stripe mode, or a ready error response. */
export async function billingGuard(limitKey: string, limit = 20): Promise<{ user: SessionUser; mode: "test" | "live" } | { error: Response }> {
  if (!(await sameOrigin())) return { error: fail(403, "bad_origin", "Cross-site request refused.") };
  const mode = stripeMode();
  if (!isAdvancedBillingEnabled() || !mode) return { error: fail(503, "billing_off", "Academy memberships open soon.") };
  const state = await advancedState();
  if (!state.visible) return { error: fail(404, "not_found", "Not found.") };
  if (!(await rateLimit(limitKey, limit, 10 * 60_000))) return { error: fail(429, "rate_limited", "Please wait a moment and try again.") };
  const user = await getUser();
  if (!user) return { error: fail(401, "not_authenticated", "Sign in to continue.") };
  if (!user.verified) return { error: fail(403, "email_not_verified", "Verify your phone or email before subscribing.") };
  if (testCheckoutBlocked(serverEnv().stripeSecretKey, user.email)) return { error: fail(403, "test_mode_restricted", TEST_CHECKOUT_MESSAGE) };
  try { assertModeAllowed(); } catch { return { error: fail(503, "billing_off", "Academy memberships open soon.") }; }
  return { user, mode };
}
