/**
 * Referral program ("Refer a contractor, get a month free"). Pure helpers shared by the proxy,
 * the /r/<code> redirect, the dashboard card and tests. Rules and guards live in Postgres
 * (supabase/migrations/20261115003000_referrals.sql).
 */
import { site } from "../site";

export const REFERRAL_COOKIE = "b2b_ref";
export const REFERRAL_MAX_AGE = 60 * 60 * 24 * 90; // 90 days
/** A referred account must be created within this many days of the code being recorded. */
export const REFERRAL_NEW_ACCOUNT_DAYS = 14;
export const REFERRAL_REWARD_DAYS = 30;

/** UTM tags on the referral landing URL, so GA and the owner's channel report show "Referral". */
export const REFERRAL_UTM = { utm_source: "referral", utm_medium: "referral", utm_campaign: "refer_a_contractor" } as const;

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9]{6,12}$/.test(c) ? c : null;
}

/** The short link a member shares: https://built2bid.org/r/AB3DE7GH */
export function referralLink(code: string, origin = site.url): string {
  return new URL(`/r/${encodeURIComponent(code)}`, origin).toString();
}

/** Where /r/<code> sends the visitor: the home page carrying ?ref= and the referral UTM tags. */
export function referralLandingPath(code: string): string {
  const q = new URLSearchParams({ ref: code, ...REFERRAL_UTM });
  return `/?${q.toString()}`;
}

/** One month of a Stripe price, in its smallest currency unit (annual prices are divided by 12). */
export function oneMonthCents(price: { unit_amount: number | null; recurring?: { interval?: string | null; interval_count?: number | null } | null }): number | null {
  const amount = price.unit_amount;
  if (!amount || amount <= 0) return null;
  const every = Math.max(1, price.recurring?.interval_count ?? 1);
  switch (price.recurring?.interval) {
    case "month": return Math.round(amount / every);
    case "year": return Math.round(amount / (12 * every));
    case "week": return Math.round((amount * 52) / (12 * every));
    case "day": return Math.round((amount * 365) / (12 * every));
    default: return null;
  }
}

export interface MyReferral { code: string; eligible: boolean; signed_up: number; paying: number; months_earned: number; pending_rewards: number }
