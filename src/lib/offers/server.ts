import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { loadCreditStatus } from "@/lib/credits/server";
import { loadMyCompany } from "@/lib/enterprise/server";
import { decideOffer, type OfferAction, type OfferContext, type OfferId, type OfferHistoryRow } from "./policy";

/** The person's offer context: plan, company membership, past-due state and recent offer history. */
export async function loadOfferContext(supabase: SupabaseClient, user: { id: string; createdAt?: string | null }, now = new Date()): Promise<OfferContext | null> {
  const admin = createAdminClient();
  const [{ data: history, error }, credits, company, { data: subs }] = await Promise.all([
    admin.from("upgrade_offers").select("offer_id, action, created_at").eq("user_id", user.id).gte("created_at", new Date(now.getTime() - 120 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(200),
    loadCreditStatus(supabase),
    loadMyCompany(supabase),
    supabase.from("subscriptions").select("status").eq("user_id", user.id),
  ]);
  // Table not installed yet (or unreachable): show nothing rather than show offers without caps.
  if (error) return null;
  return {
    now,
    signupAt: user.createdAt ?? null,
    subscriber: Boolean(credits?.unlimited),
    companyMember: Boolean(company),
    pastDue: (subs ?? []).some((s) => s.status === "past_due"),
    history: (history ?? []) as OfferHistoryRow[],
  };
}

export async function logOffer(userId: string, offer: OfferId, action: OfferAction, detail?: string | null): Promise<boolean> {
  const { error } = await createAdminClient().from("upgrade_offers").insert({ user_id: userId, offer_id: offer, action, detail: detail ?? null });
  return !error;
}

/** Decide and, when allowed, record that the offer is being shown. */
export async function claimOffer(supabase: SupabaseClient, user: { id: string; createdAt?: string | null }, offer: OfferId): Promise<boolean> {
  const ctx = await loadOfferContext(supabase, user);
  if (!ctx || !decideOffer(offer, ctx).allowed) return false;
  return logOffer(user.id, offer, "shown");
}
