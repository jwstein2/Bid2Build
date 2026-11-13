/**
 * Pure helpers that keep a customer to at most one open Stripe Checkout session, so two tabs,
 * a double-click, or a repeated sign-in callback can never produce two paid subscriptions.
 */
type SessionLike = { id: string; created: number; url: string | null; expires_at: number; metadata?: Record<string, string> | null };

/** Subscription statuses that mean "this customer is already subscribed; don't sell another". */
export const BLOCKING_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

/** Seconds of life a session must have left to be handed to the browser again. */
const MIN_REMAINING = 5 * 60;

/** An open session for this plan that can be reused instead of creating another. */
export function reusableSession<T extends SessionLike>(open: T[], plan: string, nowSec: number): T | null {
  return [...open]
    .filter((s) => s.metadata?.plan === plan && s.url && s.expires_at - nowSec > MIN_REMAINING)
    .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))[0] ?? null;
}

/** Open sessions that should be expired before a new one for `plan` is created. */
export function staleSessions<T extends SessionLike>(open: T[], plan: string, nowSec: number): T[] {
  const keep = reusableSession(open, plan, nowSec);
  return open.filter((s) => s !== keep);
}

/**
 * After creating a session, concurrent requests may have created others. Every request keeps the
 * same one (oldest, then lowest id) and expires the rest, so they all converge on one session.
 */
export function converge<T extends SessionLike>(open: T[]): { keep: T | null; expire: T[] } {
  const sorted = [...open].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  return { keep: sorted[0] ?? null, expire: sorted.slice(1) };
}
