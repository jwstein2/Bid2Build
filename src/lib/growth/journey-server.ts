import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JAccount, JCommission, JCost, JEvent, JOwner, JReferral, JRevenue, JSub, JTouch, JourneyInput } from "./journey";

/** Journey events read for the report (server-recorded milestones only). */
export const JOURNEY_EVENTS = ["account_created", "first_bid_started", "bid_created", "proposal_sent", "bid_activated", "subscribed", "subscription_renewed", "subscription_cancel_scheduled", "subscription_canceled"];

const LIMIT = 50_000;

/** A table that may not exist yet (migration not applied) reads as null instead of failing the page. */
async function optional<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[] | null> {
  const { data, error } = await q;
  return error ? null : ((data ?? []) as T[]);
}

export interface JourneyLoad { input: JourneyInput; installed: { touches: boolean; revenue: boolean; owners: boolean } }

/**
 * Read everything the journey report needs for the given accounts (already scoped to genuine accounts by the
 * caller). Ids, tags, timestamps and cents only: no emails, names or bid contents. Service-role client only.
 */
export async function loadJourneyInput(db: SupabaseClient, accounts: JAccount[]): Promise<JourneyLoad> {
  const ids = new Set(accounts.map((a) => a.id));
  const [touches, events, revenue, subs, sales, affiliates, referrals, salesCom, affCom, costs] = await Promise.all([
    optional<JTouch>(db.from("marketing_touches").select("user_id,touch_at,channel,utm_source,utm_medium,utm_campaign,utm_content,utm_term,campaign_id,landing_path,referrer_host,click_id_type").order("touch_at", { ascending: true }).limit(LIMIT)),
    optional<JEvent>(db.from("analytics_events").select("user_id,event,created_at,event_id").in("event", JOURNEY_EVENTS).order("created_at", { ascending: true }).limit(LIMIT)),
    optional<JRevenue>(db.from("mkt_revenue_facts").select("invoice_id,user_id,subscription_id,billing_reason,paid_at,gross_cents,refund_cents,net_cents,disputed_lost").order("paid_at", { ascending: true }).limit(LIMIT)),
    optional<JSub>(db.from("subscriptions").select("stripe_subscription_id,user_id,status,cancel_at_period_end,canceled_at,ended_at").limit(LIMIT)),
    optional<{ user_id: string; rep_id: string; attributed_at: string | null; ended_at: string | null }>(db.from("sales_attributions").select("user_id,rep_id,attributed_at,ended_at").limit(LIMIT)),
    optional<{ user_id: string; affiliate_id: string; attributed_at: string | null }>(db.from("affiliate_referrals").select("user_id,affiliate_id,attributed_at").limit(LIMIT)),
    optional<JReferral>(db.from("referrals").select("referee_id,referrer_id,reward_cents,status").limit(LIMIT)),
    optional<{ user_id: string | null; year_no: number; amount_cents: number; status: string; kind: string }>(db.from("sales_commissions").select("user_id,year_no,amount_cents,status,kind").limit(LIMIT)),
    optional<{ user_id: string | null; year_no: number; amount_cents: number; status: string }>(db.from("affiliate_commissions").select("user_id,year_no,amount_cents,status").limit(LIMIT)),
    optional<JCost>(db.from("marketing_costs").select("period_start,channel,campaign_id,amount_usd").limit(LIMIT)),
  ]);
  const mine = <T extends { user_id: string | null }>(rows: T[] | null) => (rows ?? []).filter((r) => r.user_id && ids.has(r.user_id));
  const owners: JOwner[] = [
    // An owner-ended rep attribution earns nothing more, but it still owned the sale it was credited with.
    ...(sales ?? []).filter((s) => ids.has(s.user_id)).map((s) => ({ user_id: s.user_id, program: "sales_rep" as const, partner_id: s.rep_id, attributed_at: s.attributed_at })),
    ...(affiliates ?? []).filter((s) => ids.has(s.user_id)).map((s) => ({ user_id: s.user_id, program: "affiliate" as const, partner_id: s.affiliate_id, attributed_at: s.attributed_at })),
  ];
  const commissions: JCommission[] = [
    // Commission lines only (not bonuses/accelerators/rewards, which are rep pay, not per-customer acquisition cost); clawbacks net out.
    ...mine(salesCom).filter((c) => c.kind === "commission" || c.kind === "clawback").map((c) => ({ user_id: c.user_id, program: "sales_rep" as const, year_no: c.year_no, amount_cents: c.amount_cents, status: c.status })),
    ...mine(affCom).map((c) => ({ user_id: c.user_id, program: "affiliate" as const, year_no: c.year_no, amount_cents: c.amount_cents, status: c.status })),
  ];
  return {
    input: {
      accounts, touches: mine(touches), events: mine(events),
      // Unmatched revenue is kept so the data quality check can see it; it never joins an account.
      revenue: (revenue ?? []).filter((r) => !r.user_id || ids.has(r.user_id)),
      subs: mine(subs), owners, referrals: (referrals ?? []).filter((r) => r.referee_id && ids.has(r.referee_id)), commissions, costs: costs ?? [],
    },
    installed: { touches: touches !== null, revenue: revenue !== null, owners: sales !== null || affiliates !== null },
  };
}
