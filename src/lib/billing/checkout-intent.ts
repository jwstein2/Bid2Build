/**
 * A short-lived "pending checkout" kept in this browser while the contractor verifies their email,
 * so the plan they picked survives the code step, page refreshes, remounts and email-link sign-in.
 *
 * It only ever stores an approved plan id (never a price): the server resolves the real Stripe price.
 * Email-link sign-in also carries the plan in the return URL (`/pricing?resume=monthly`), which covers
 * opening the link on another device where this storage doesn't exist.
 */
import { isPlanId, type PlanId } from "./plans";

export const INTENT_KEY = "b2b.checkoutIntent";
const LOCK_KEY = "b2b.checkoutLock";
/** Matches the sign-in email's link/code lifetime (1 hour). */
export const INTENT_TTL_MS = 60 * 60_000;

export type IntentStatus = "pending" | "redirected" | "cancelled";
export type CheckoutIntent = { v: 1; id: string; plan: PlanId; createdAt: number; status: IntentStatus; email?: string };

const store = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

const newId = () => {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
};

export function parseIntent(raw: string | null, now = Date.now()): { intent: CheckoutIntent | null; expired: CheckoutIntent | null } {
  if (!raw) return { intent: null, expired: null };
  try {
    const v = JSON.parse(raw) as Partial<CheckoutIntent>;
    if (v?.v !== 1 || !isPlanId(v.plan) || typeof v.createdAt !== "number" || typeof v.id !== "string") return { intent: null, expired: null };
    const intent: CheckoutIntent = { v: 1, id: v.id, plan: v.plan, createdAt: v.createdAt, status: v.status === "redirected" || v.status === "cancelled" ? v.status : "pending", email: typeof v.email === "string" ? v.email : undefined };
    if (now - intent.createdAt > INTENT_TTL_MS || intent.createdAt > now + 60_000) return { intent: null, expired: intent };
    return { intent, expired: null };
  } catch { return { intent: null, expired: null }; }
}

export function readIntent(): { intent: CheckoutIntent | null; expired: CheckoutIntent | null } {
  const s = store();
  let raw: string | null = null;
  try { raw = s?.getItem(INTENT_KEY) ?? null; } catch { /* storage blocked */ }
  return parseIntent(raw);
}

function write(intent: CheckoutIntent) {
  try { store()?.setItem(INTENT_KEY, JSON.stringify(intent)); } catch { /* storage blocked: URL param still carries the plan */ }
}

/** Start (or restart) a pending checkout for `plan`. Keeps the id when re-selecting the same plan. */
export function saveIntent(plan: PlanId): CheckoutIntent {
  const { intent } = readIntent();
  const next: CheckoutIntent = intent && intent.plan === plan
    ? { ...intent, status: "pending", createdAt: Date.now() }
    : { v: 1, id: newId(), plan, createdAt: Date.now(), status: "pending", email: intent?.email };
  write(next);
  return next;
}

export function updateIntent(patch: Partial<Pick<CheckoutIntent, "status" | "email" | "plan">>): CheckoutIntent | null {
  const { intent } = readIntent();
  if (!intent) return null;
  const next = { ...intent, ...patch };
  write(next);
  return next;
}

export function clearIntent() {
  try { store()?.removeItem(INTENT_KEY); store()?.removeItem(LOCK_KEY); } catch { /* ignore */ }
}

/**
 * Cross-tab guard so two tabs (or a duplicate sign-in callback) don't both start checkout at once.
 * Returns false if another attempt holds the lock. The server also keeps one open session per customer.
 */
export function acquireCheckoutLock(owner: string, ms = 15_000): boolean {
  const s = store();
  if (!s) return true;
  try {
    const cur = JSON.parse(s.getItem(LOCK_KEY) ?? "null") as { owner: string; until: number } | null;
    if (cur && cur.until > Date.now() && cur.owner !== owner) return false;
    s.setItem(LOCK_KEY, JSON.stringify({ owner, until: Date.now() + ms }));
    return true;
  } catch { return true; }
}

export function releaseCheckoutLock(owner: string) {
  const s = store();
  try {
    const cur = JSON.parse(s?.getItem(LOCK_KEY) ?? "null") as { owner: string } | null;
    if (cur?.owner === owner) s?.removeItem(LOCK_KEY);
  } catch { /* ignore */ }
}

/** Where email-link sign-in should return to so checkout resumes with the same plan. */
export const resumePath = (plan: PlanId) => `/pricing?resume=${plan}`;

/** Attempt ids sent to the server for Stripe idempotency. */
export const newAttemptId = newId;

/** Drop the cross-tab lock (the customer came back from Stripe or pressed Back). */
export function clearCheckoutLock() {
  try { store()?.removeItem(LOCK_KEY); } catch { /* ignore */ }
}

/**
 * acquireCheckoutLock plus a short settle-and-recheck, so two tabs that try at the same instant
 * don't both win (the last writer keeps the lock; the other backs off).
 */
export async function acquireCheckoutLockSettled(owner: string, ms = 15_000): Promise<boolean> {
  if (!acquireCheckoutLock(owner, ms)) return false;
  await new Promise((r) => setTimeout(r, 80 + Math.floor(Math.random() * 80)));
  try {
    const cur = JSON.parse(store()?.getItem(LOCK_KEY) ?? "null") as { owner: string } | null;
    return !cur || cur.owner === owner;
  } catch { return true; }
}
