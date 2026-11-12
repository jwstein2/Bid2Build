import "server-only";
import Stripe from "stripe";
import { serverEnv } from "../env";

let client: Stripe | null = null;
export function getStripe(): Stripe {
  const key = serverEnv().stripeSecretKey;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  client ??= new Stripe(key, { appInfo: { name: "Bid2Build" }, maxNetworkRetries: 2 });
  return client;
}

/** Live mode is refused unless the owner explicitly enables it (launch approval gate). */
export function assertModeAllowed() {
  const key = serverEnv().stripeSecretKey;
  if (key.startsWith("sk_live_") && process.env.STRIPE_ALLOW_LIVE !== "true") {
    throw new Error("Live Stripe keys are configured but STRIPE_ALLOW_LIVE is not 'true'. Live payments require explicit owner approval.");
  }
}
