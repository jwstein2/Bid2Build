import "server-only";
import { cache } from "react";
import { createClient, getUser, type SessionUser } from "../supabase/server";
import { loadCreditStatus } from "../credits/server";
import type { CreditStatus } from "../credits/status";
import { accountStatusFrom, type AccountStatus } from "./status";

export interface AccountContext {
  user: SessionUser | null;
  credits: CreditStatus | null;
  status: AccountStatus;
  /** Billing schedule of the active Unlimited subscription, when there is one. */
  plan: "monthly" | "annual" | null;
}

/**
 * The visitor's account state, resolved on the server from the verified Supabase session and the
 * credit_status RPC (which reads the Stripe-synced subscriptions table). Cached per request so the
 * header, page and footer share one lookup. Rendering on the server means the first HTML already has
 * the right CTAs: no flash of "free bid" copy while auth loads.
 */
export const getAccountContext = cache(async (): Promise<AccountContext> => {
  const user = await getUser();
  const supabase = user ? await createClient() : null;
  const credits = supabase ? await loadCreditStatus(supabase) : null;
  const status = accountStatusFrom(user, credits);
  let plan: AccountContext["plan"] = null;
  if (supabase && status.kind === "unlimited") {
    const { data } = await supabase.from("subscriptions").select("plan").in("status", ["active", "trialing", "past_due"])
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    plan = data?.plan === "annual" || data?.plan === "monthly" ? data.plan : null;
  }
  return { user, credits, status, plan };
});

export async function getAccountStatus(): Promise<AccountStatus> {
  return (await getAccountContext()).status;
}
