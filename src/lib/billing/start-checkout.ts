"use client";
import type { PlanId } from "./plans";
import { acquireCheckoutLockSettled, newAttemptId, releaseCheckoutLock, updateIntent } from "./checkout-intent";

export type CheckoutResult =
  | { kind: "redirecting" }
  | { kind: "already_subscribed" }
  | { kind: "signed_out" }
  | { kind: "busy" }
  | { kind: "error"; message: string };

let inflight: Promise<CheckoutResult> | null = null;

/**
 * Asks the server for a Stripe Checkout session for an approved plan id and sends the browser there.
 * Concurrent calls in this tab share one request; other tabs are held off by a short lock.
 */
export function startCheckout(plan: PlanId, opts: { timeoutMs?: number } = {}): Promise<CheckoutResult> {
  if (inflight) return inflight;
  inflight = run(plan, opts.timeoutMs ?? 20_000).finally(() => { inflight = null; });
  return inflight;
}

async function run(plan: PlanId, timeoutMs: number): Promise<CheckoutResult> {
  const attempt = newAttemptId();
  if (!(await acquireCheckoutLockSettled(attempt))) return { kind: "busy" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let redirected = false;
  try {
    const r = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, attempt }),
      signal: ctrl.signal,
    });
    const d = await r.json().catch(() => null);
    if (r.ok && typeof d?.url === "string" && d.url.startsWith("https://")) {
      updateIntent({ status: "redirected" });
      redirected = true; // keep the cross-tab lock until it lapses while the browser leaves for Stripe
      window.location.assign(d.url);
      return { kind: "redirecting" };
    }
    const code = d?.error?.code as string | undefined;
    if (code === "already_subscribed") return { kind: "already_subscribed" };
    if (code === "not_authenticated") return { kind: "signed_out" };
    return { kind: "error", message: d?.error?.message ?? "We couldn't start checkout. Please try again." };
  } catch (e) {
    const aborted = (e as { name?: string }).name === "AbortError";
    return { kind: "error", message: aborted ? "Checkout is taking too long to respond. Check your connection and try again." : "We couldn't reach the server. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
    if (!redirected) releaseCheckoutLock(attempt);
  }
}
