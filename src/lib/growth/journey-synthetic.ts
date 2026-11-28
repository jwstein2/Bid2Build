/**
 * Synthetic journey data (Growth OS Phase 3). Drives the unit tests and the dashboard's "Synthetic data"
 * preview (/admin/marketing/journey?synthetic=1) before any production use. Every id is made up and starts
 * with "syn-"; nothing here is a real customer.
 */
import type { JourneyInput } from "./journey";

const DAY = 86_400_000;

/** Eight made-up accounts covering every attribution case, relative to `now`. */
export function syntheticJourneyInput(now: Date = new Date()): JourneyInput {
  const at = (daysAgo: number, h = 12) => new Date(now.getTime() - daysAgo * DAY + (h - 12) * 3_600_000).toISOString();
  const inv = (id: string, user: string | null, daysAgo: number, cents: number, extra: Partial<JourneyInput["revenue"][number]> = {}) => ({
    invoice_id: id, user_id: user, subscription_id: user ? `syn-sub-${user}` : null, billing_reason: "subscription_create", paid_at: at(daysAgo),
    gross_cents: cents, refund_cents: 0, net_cents: cents, disputed_lost: false, ...extra,
  });
  const cycle = { billing_reason: "subscription_cycle" };
  const touch = (user: string, daysAgo: number, channel: string, t: Partial<JourneyInput["touches"][number]> = {}) => ({ user_id: user, touch_at: at(daysAgo, 9), channel, ...t });
  const ev = (user: string, event: string, daysAgo: number, id = `${event}:${user}`) => ({ user_id: user, event, created_at: at(daysAgo, 13), event_id: id });

  return {
    accounts: [
      { id: "syn-a-google", createdAt: at(95), trade: "roofing", segment: "paying_active" },
      { id: "syn-b-meta", createdAt: at(80), trade: "decks", segment: "canceled" },
      { id: "syn-c-rep", createdAt: at(70), trade: "painting", segment: "paying_active" },
      { id: "syn-d-affiliate", createdAt: at(65), trade: "concrete", segment: "canceled" },
      { id: "syn-e-referral", createdAt: at(50), trade: "roofing", segment: "paying_active" },
      { id: "syn-f-direct", createdAt: at(20), trade: null, segment: "never_bid", lead: { source: "direct", referrer_host: "(none)" } },
      { id: "syn-g-email", createdAt: at(15), trade: "electrical", segment: "one_bid" },
      { id: "syn-h-dispute", createdAt: at(40), trade: "flooring", segment: "canceled" },
    ],
    touches: [
      touch("syn-a-google", 95, "google_ads", { utm_source: "google", utm_medium: "cpc", utm_campaign: "b2b-google-signup-202611", utm_content: "rsa-roofing-1", landing_path: "/bids/roofing", click_id_type: "gclid" }),
      touch("syn-b-meta", 85, "meta_ads", { utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "b2b-meta-signup-202611", utm_content: "b-h1-15s-916-v1", landing_path: "/bids/decks" }),
      touch("syn-b-meta", 80, "organic_search", { referrer_host: "google.com", landing_path: "/learn/deck-pricing" }),
      // Saw a Google ad first, then signed up through a sales rep's link: marketing influence vs commission owner.
      touch("syn-c-rep", 75, "google_ads", { utm_source: "google", utm_medium: "cpc", utm_campaign: "b2b-google-signup-202611", landing_path: "/bids/painting", click_id_type: "gclid" }),
      touch("syn-c-rep", 70, "referral", { utm_source: "sales_rep", utm_medium: "referral", utm_campaign: "sales_team", utm_content: "SYNREP01", landing_path: "/" }),
      touch("syn-d-affiliate", 65, "referral", { utm_source: "affiliate", utm_medium: "referral", utm_campaign: "spring_video", utm_content: "SYNAFF01", landing_path: "/" }),
      touch("syn-e-referral", 50, "referral", { utm_source: "referral", utm_medium: "referral", utm_campaign: "refer_a_contractor", landing_path: "/" }),
      touch("syn-g-email", 15, "email_outreach", { utm_source: "instantly", utm_medium: "email", utm_campaign: "cold_outreach", landing_path: "/bids/electrical" }),
      touch("syn-h-dispute", 40, "social", { utm_source: "facebook", utm_medium: "social", utm_campaign: "daily_posts", utm_content: "nov17_am", landing_path: "/" }),
    ],
    events: [
      ...["syn-a-google", "syn-b-meta", "syn-c-rep", "syn-d-affiliate", "syn-e-referral", "syn-f-direct", "syn-g-email", "syn-h-dispute"].map((u) => ev(u, "account_created", { "syn-a-google": 95, "syn-b-meta": 80, "syn-c-rep": 70, "syn-d-affiliate": 65, "syn-e-referral": 50, "syn-f-direct": 20, "syn-g-email": 15, "syn-h-dispute": 40 }[u]!)),
      ev("syn-a-google", "first_bid_started", 94), ev("syn-a-google", "proposal_sent", 93), ev("syn-a-google", "bid_activated", 93), ev("syn-a-google", "subscribed", 90),
      ev("syn-b-meta", "first_bid_started", 79), ev("syn-b-meta", "bid_activated", 78), ev("syn-b-meta", "subscribed", 75),
      ev("syn-b-meta", "subscription_cancel_scheduled", 20), ev("syn-b-meta", "subscription_canceled", 15),
      ev("syn-c-rep", "first_bid_started", 69), ev("syn-c-rep", "proposal_sent", 68), ev("syn-c-rep", "bid_activated", 68), ev("syn-c-rep", "subscribed", 66),
      ev("syn-d-affiliate", "first_bid_started", 64), ev("syn-d-affiliate", "subscribed", 60), ev("syn-d-affiliate", "subscription_cancel_scheduled", 35), ev("syn-d-affiliate", "subscription_canceled", 30),
      ev("syn-e-referral", "first_bid_started", 49), ev("syn-e-referral", "proposal_sent", 48), ev("syn-e-referral", "bid_activated", 48), ev("syn-e-referral", "subscribed", 45),
      ev("syn-g-email", "first_bid_started", 14),
      ev("syn-h-dispute", "first_bid_started", 39), ev("syn-h-dispute", "subscribed", 38), ev("syn-h-dispute", "subscription_canceled", 8),
    ],
    revenue: [
      inv("syn-in-a1", "syn-a-google", 90, 1999), inv("syn-in-a2", "syn-a-google", 60, 1999, cycle), inv("syn-in-a3", "syn-a-google", 30, 1999, cycle),
      inv("syn-in-b1", "syn-b-meta", 75, 1999), inv("syn-in-b2", "syn-b-meta", 45, 1999, { ...cycle, refund_cents: 1000, net_cents: 999 }),
      inv("syn-in-c1", "syn-c-rep", 66, 19188, { billing_reason: "subscription_create" }),
      inv("syn-in-d1", "syn-d-affiliate", 60, 1999), inv("syn-in-d2", "syn-d-affiliate", 30, 1999, cycle),
      inv("syn-in-e1", "syn-e-referral", 45, 1999), inv("syn-in-e2", "syn-e-referral", 15, 1999, cycle),
      inv("syn-in-h1", "syn-h-dispute", 38, 1999, { disputed_lost: true, net_cents: 0 }),
      // Paid invoice whose Stripe customer isn't linked to an account: shows up in data quality, never in a channel.
      inv("syn-in-x1", null, 10, 1999),
    ],
    subs: [
      { stripe_subscription_id: "syn-sub-syn-a-google", user_id: "syn-a-google", status: "active" },
      { stripe_subscription_id: "syn-sub-syn-b-meta", user_id: "syn-b-meta", status: "canceled", cancel_at_period_end: true, canceled_at: at(20), ended_at: at(15) },
      { stripe_subscription_id: "syn-sub-syn-c-rep", user_id: "syn-c-rep", status: "active" },
      { stripe_subscription_id: "syn-sub-syn-d-affiliate", user_id: "syn-d-affiliate", status: "canceled", cancel_at_period_end: true, canceled_at: at(35), ended_at: at(30) },
      { stripe_subscription_id: "syn-sub-syn-e-referral", user_id: "syn-e-referral", status: "active" },
      { stripe_subscription_id: "syn-sub-syn-h-dispute", user_id: "syn-h-dispute", status: "canceled", ended_at: at(8) },
    ],
    owners: [
      { user_id: "syn-c-rep", program: "sales_rep", partner_id: "syn-rep-1", attributed_at: at(70) },
      { user_id: "syn-d-affiliate", program: "affiliate", partner_id: "syn-aff-1", attributed_at: at(65) },
    ],
    referrals: [{ referee_id: "syn-e-referral", referrer_id: "syn-a-google", reward_cents: 1999, status: "rewarded" }],
    commissions: [
      { user_id: "syn-c-rep", program: "sales_rep", year_no: 1, amount_cents: 1999, status: "earned" },
      { user_id: "syn-d-affiliate", program: "affiliate", year_no: 1, amount_cents: 1599, status: "pending" },
    ],
    costs: [
      { period_start: at(60).slice(0, 10), channel: "google_ads", amount_usd: 300 },
      { period_start: at(60).slice(0, 10), channel: "meta_ads", amount_usd: 200 },
    ],
  };
}
