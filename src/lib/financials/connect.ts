/**
 * Online invoice payments through Stripe Connect: pure helpers (unit-tested, no I/O).
 *
 * Model: every contractor book has its own Stripe account (Standard-style: full Stripe Dashboard, the contractor
 * pays Stripe's fees, Stripe carries the losses). A customer pays from a secure link; the charge is a DIRECT
 * charge on the contractor's account, so the money never touches Built2Bid's balance. Built2Bid takes no fee.
 */
import { createHash, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

export type ConnectMode = "off" | "test" | "live";

/**
 * Whether online payments are offered on this deploy.
 * - No Stripe key → off.
 * - A test key → test (deployed copies still limit who can pay; see testCheckoutBlocked).
 * - A live key → live only when STRIPE_ALLOW_LIVE=true AND CONNECT_PAYMENTS_LIVE=true (the owner's switch).
 */
export function connectMode(env: Env = process.env): ConnectMode {
  const key = env.STRIPE_SECRET_KEY ?? "";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return env.STRIPE_ALLOW_LIVE === "true" && env.CONNECT_PAYMENTS_LIVE === "true" ? "live" : "off";
  return "off";
}

/** A card surcharge (customer pays the card fee) stays off until counsel approves the rules. */
export const surchargeAllowed = (env: Env = process.env) => env.CONNECT_CARD_SURCHARGE === "approved";

export interface AccountSnapshot {
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  requirements?: { currently_due?: string[] | null; past_due?: string[] | null; disabled_reason?: string | null } | null;
}

export type AccountState = "not_started" | "onboarding" | "pending_review" | "action_needed" | "ready" | "restricted";

export function accountState(a: AccountSnapshot | null): AccountState {
  if (!a) return "not_started";
  const due = [...(a.requirements?.past_due ?? []), ...(a.requirements?.currently_due ?? [])];
  if (a.charges_enabled && a.payouts_enabled && !due.length) return "ready";
  if (a.charges_enabled && due.length) return "action_needed";
  if (a.requirements?.disabled_reason && a.details_submitted) return /under_review|pending/.test(a.requirements.disabled_reason) ? "pending_review" : "restricted";
  if (a.details_submitted) return due.length ? "action_needed" : "pending_review";
  return "onboarding";
}

export const ACCOUNT_STATE_LABEL: Record<AccountState, string> = {
  not_started: "Not set up",
  onboarding: "Finish setup",
  pending_review: "Stripe is reviewing",
  action_needed: "Stripe needs more info",
  ready: "Ready to take payments",
  restricted: "Payments paused by Stripe",
};

export const canTakePayments = (row: { charges_enabled: boolean } | null) => Boolean(row?.charges_enabled);

/** Pay-link tokens: 32 random bytes, base64url. Only the SHA-256 is stored. */
export const newPayToken = () => randomBytes(32).toString("base64url");
export const hashPayToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const looksLikePayToken = (t: string) => /^[A-Za-z0-9_-]{40,60}$/.test(t);

export const toCents = (amount: string | number) => Math.round(Number(amount) * 100);
export const fromCents = (cents: number) => (cents / 100).toFixed(2);

export interface CheckoutInput {
  invoiceId: string;
  bookId: string;
  invoiceNumber: string;
  businessName: string;
  amountDue: string;          // decimal string, the invoice's open balance
  customerEmail?: string | null;
  card: boolean;
  ach: boolean;
  returnUrl: string;          // the pay page; ?paid=1 / ?canceled=1 are appended
}

/** Stripe Checkout parameters for a direct charge on the contractor's account (sent with the stripeAccount header). */
export function checkoutParams(i: CheckoutInput) {
  const cents = toCents(i.amountDue);
  if (!Number.isFinite(cents) || cents < 50) throw new Error("amount_too_small");
  if (cents > 99_999_999) throw new Error("amount_too_large");
  const methods: ("card" | "us_bank_account")[] = [];
  if (i.card) methods.push("card");
  if (i.ach) methods.push("us_bank_account");
  if (!methods.length) throw new Error("no_methods");
  const meta = { b2b_invoice_id: i.invoiceId, b2b_book_id: i.bookId, b2b_kind: "invoice_payment" };
  const sep = i.returnUrl.includes("?") ? "&" : "?";
  return {
    mode: "payment" as const,
    payment_method_types: methods,
    line_items: [{
      quantity: 1,
      price_data: { currency: "usd", unit_amount: cents, product_data: { name: `Invoice ${i.invoiceNumber}`, description: `Payment to ${i.businessName}`.slice(0, 250) } },
    }],
    customer_email: i.customerEmail || undefined,
    payment_intent_data: { description: `Invoice ${i.invoiceNumber}`, metadata: meta },
    ...(i.ach ? { payment_method_options: { us_bank_account: { verification_method: "automatic" as const, financial_connections: { permissions: ["payment_method" as const] } } } } : {}),
    metadata: meta,
    success_url: `${i.returnUrl}${sep}paid=1`,
    cancel_url: `${i.returnUrl}${sep}canceled=1`,
    expires_at: Math.floor(Date.now() / 1000) + 23 * 3600,
  };
}

/** Method recorded on the payment, from the PaymentIntent's charge / payment method type. */
export function methodFromType(t: string | null | undefined): "card" | "ach" | null {
  if (t === "card" || t === "link") return "card";
  if (t === "us_bank_account") return "ach";
  return null;
}

/** Plain-language customer-facing fee note shown on the pay page. */
export function feeNote(card: boolean, ach: boolean): string {
  if (card && ach) return "Pay by card or directly from your bank account (ACH). Bank payments take 3 to 5 business days to clear.";
  if (ach) return "Pay directly from your bank account (ACH). Bank payments take 3 to 5 business days to clear.";
  return "Pay securely by card.";
}
