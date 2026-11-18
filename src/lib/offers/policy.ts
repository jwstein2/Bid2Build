/**
 * In-app upgrade and lifecycle offers (V8 batch 4, from the V7 contextual upsell blueprint).
 * Pure rules: who may see which offer, and how often. The API (src/app/api/offers) loads the
 * person's context and offer history, asks decideOffer(), and logs to public.upgrade_offers.
 *
 * Never a modal. Every offer can be dismissed and never blocks the work in front of the person.
 */
export const OFFER_IDS = ["t1_credits_low", "t5_annual", "t8_first_sent", "ret1_cancel"] as const;
export type OfferId = (typeof OFFER_IDS)[number];
export const isOfferId = (v: unknown): v is OfferId => typeof v === "string" && (OFFER_IDS as readonly string[]).includes(v);

export const OFFER_ACTIONS = ["shown", "clicked", "dismissed", "answered"] as const;
export type OfferAction = (typeof OFFER_ACTIONS)[number];

/** Reasons offered on the "Before you go" step. Codes only are stored. */
export const CANCEL_REASONS = [
  { code: "too_expensive", label: "It costs too much right now" },
  { code: "not_enough_bids", label: "I don't send enough bids" },
  { code: "seasonal", label: "My work is seasonal or slow" },
  { code: "missing_feature", label: "It's missing something I need" },
  { code: "too_hard", label: "It's hard to use" },
  { code: "switching_tool", label: "I'm switching to another tool" },
  { code: "other", label: "Something else" },
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number]["code"];
export const isCancelReason = (v: unknown): v is CancelReason => typeof v === "string" && CANCEL_REASONS.some((r) => r.code === v);

/** Where a click went (stored as the detail of a "clicked" row). */
export const CLICK_TARGETS = ["pricing", "checkout", "portal_annual", "portal_cancel", "export", "copy_link", "share"] as const;
export const isClickTarget = (v: unknown): v is (typeof CLICK_TARGETS)[number] => typeof v === "string" && (CLICK_TARGETS as readonly string[]).includes(v);

export interface OfferHistoryRow { offer_id: string; action: string; created_at: string }

export interface OfferContext {
  now: Date;
  /** Account creation time (ISO), if known. */
  signupAt?: string | null;
  /** Unlimited through a paid plan or complimentary access. */
  subscriber: boolean;
  /** Member of an Enterprise company (the company decides what to buy). */
  companyMember: boolean;
  /** Personal subscription is past due: only billing-fix messages, no offers. */
  pastDue: boolean;
  /** The person's offer history, newest first (the last 120 days is enough). */
  history: OfferHistoryRow[];
}

export type Decision = { allowed: true } | { allowed: false; reason: string };

const DAY = 86_400_000;
const since = (row: OfferHistoryRow, now: Date) => now.getTime() - Date.parse(row.created_at);

/** Upgrade offers (they ask for money). T8 is a celebration and RET-1 is the person's own request. */
const UPGRADE: OfferId[] = ["t1_credits_low", "t5_annual"];

/**
 * Rules (Report F, V7):
 * - Company members: no offers except their own cancellation step.
 * - Past-due subscription: no offers.
 * - Within 24 hours of dismissing any offer, or of being shown any other offer: nothing new.
 * - Upgrade offers wait 72 hours after signup.
 * - T1 (one free bid left): free accounts only, at most once per 30 days (one credit cycle).
 * - T5 (switch to annual): monthly subscribers only, at most once per 90 days.
 * - T8 (first proposal out): once ever.
 * - RET-1: always allowed. Cancelling is never blocked or capped.
 */
export function decideOffer(offer: OfferId, ctx: OfferContext): Decision {
  if (offer === "ret1_cancel") return { allowed: true };
  const { now, history } = ctx;
  if (ctx.companyMember) return { allowed: false, reason: "company_member" };
  if (ctx.pastDue) return { allowed: false, reason: "past_due" };

  const shownThis = history.filter((h) => h.offer_id === offer && h.action === "shown");
  if (offer === "t8_first_sent" && shownThis.length) return { allowed: false, reason: "once_ever" };
  if (offer === "t1_credits_low") {
    if (ctx.subscriber) return { allowed: false, reason: "subscriber" };
    if (shownThis.some((h) => since(h, now) < 30 * DAY)) return { allowed: false, reason: "cap_30d" };
  }
  if (offer === "t5_annual") {
    if (!ctx.subscriber) return { allowed: false, reason: "not_subscriber" };
    if (shownThis.some((h) => since(h, now) < 90 * DAY)) return { allowed: false, reason: "cap_90d" };
  }
  if (UPGRADE.includes(offer) && ctx.signupAt && now.getTime() - Date.parse(ctx.signupAt) < 3 * DAY) return { allowed: false, reason: "new_account" };

  const recent = history.filter((h) => h.offer_id !== "ret1_cancel" && since(h, now) < DAY);
  if (recent.some((h) => h.action === "dismissed")) return { allowed: false, reason: "dismissed_24h" };
  if (recent.some((h) => h.action === "shown" && h.offer_id !== offer)) return { allowed: false, reason: "other_offer_24h" };
  return { allowed: true };
}

/* ------------------------------------------ Copy helpers ------------------------------------------ */

/** Dollars saved by one year of the annual plan instead of 12 monthly payments, e.g. "$90.88". */
export function annualSavings(monthlyCents: number, annualCents: number): string {
  const cents = monthlyCents * 12 - annualCents;
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

/** T5 eligibility: on the monthly plan for 3+ paid months, with 8+ finalized bids. */
export function annualNudgeEligible(input: { plan: string | null | undefined; status: string | null | undefined; cancelAtPeriodEnd?: boolean; paidMonths: number; finalizedBids: number }): boolean {
  return input.plan === "monthly" && input.status === "active" && !input.cancelAtPeriodEnd && input.paidMonths >= 3 && input.finalizedBids >= 8;
}

/* ------------------------------------------ Owner report ------------------------------------------ */

export const OFFER_LABEL: Record<OfferId, string> = {
  t1_credits_low: "One free bid left (T1)",
  t5_annual: "Switch to annual (T5)",
  t8_first_sent: "Proposal ready + referral (T8)",
  ret1_cancel: "Before you go (RET-1)",
};

export interface OfferSummary { offer: OfferId; shown: number; clicked: number; dismissed: number }

/** Counts per offer and cancellation reasons, for /admin/marketing. Rows are already limited to the date range. */
export function summarizeOffers(rows: { offer_id: string; action: string; detail: string | null }[]): { offers: OfferSummary[]; reasons: { code: CancelReason; label: string; count: number }[]; skipped: number } {
  const offers = OFFER_IDS.map((offer) => ({ offer, shown: 0, clicked: 0, dismissed: 0 }));
  const reasonCount = new Map<string, number>();
  let cancelClicks = 0;
  let answered = 0;
  for (const r of rows) {
    const o = offers.find((x) => x.offer === r.offer_id);
    if (!o) continue;
    if (r.action === "shown") o.shown++;
    else if (r.action === "clicked") { o.clicked++; if (r.offer_id === "ret1_cancel" && r.detail === "portal_cancel") cancelClicks++; }
    else if (r.action === "dismissed") o.dismissed++;
    else if (r.action === "answered" && r.detail) { answered++; reasonCount.set(r.detail, (reasonCount.get(r.detail) ?? 0) + 1); }
  }
  const reasons = CANCEL_REASONS.map((x) => ({ code: x.code, label: x.label, count: reasonCount.get(x.code) ?? 0 })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
  return { offers, reasons, skipped: Math.max(0, cancelClicks - answered) };
}
