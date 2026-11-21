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

/**
 * "Customer pays the card fee" (a disclosed credit card surcharge). On (James, 2026-11-21), enforced per state and
 * per card by surcharge.ts. CONNECT_CARD_SURCHARGE=off is the owner's kill switch.
 */
export const surchargeAllowed = (env: Env = process.env) => (env.CONNECT_CARD_SURCHARGE ?? "").toLowerCase() !== "off";

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
  /** Credit card surcharge (card-only session): authorized now, captured only if allowed (see surcharge.capturePlan). */
  surcharge?: { cents: number; pct: number; contractorState: string; customerState: string; disclosure: string } | null;
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
  const sc = i.surcharge && i.surcharge.cents > 0 ? i.surcharge : null;
  if (sc && (i.ach || !i.card)) throw new Error("surcharge_card_only");
  const meta: Record<string, string> = { b2b_invoice_id: i.invoiceId, b2b_book_id: i.bookId, b2b_kind: "invoice_payment" };
  if (sc) Object.assign(meta, { b2b_base_cents: String(cents), b2b_surcharge_cents: String(sc.cents), b2b_surcharge_pct: String(sc.pct), b2b_contractor_state: sc.contractorState, b2b_customer_state: sc.customerState });
  const sep = i.returnUrl.includes("?") ? "&" : "?";
  const pct = sc ? `${Number(sc.pct.toFixed(2))}%` : "";
  return {
    mode: "payment" as const,
    payment_method_types: methods,
    line_items: [{
      quantity: 1,
      price_data: { currency: "usd", unit_amount: cents, product_data: { name: `Invoice ${i.invoiceNumber}`, description: `Payment to ${i.businessName}`.slice(0, 250) } },
    }, ...(sc ? [{
      quantity: 1,
      price_data: { currency: "usd", unit_amount: sc.cents, product_data: { name: `Credit card surcharge (${pct})`, description: "Removed automatically for debit and prepaid cards. Not greater than our cost of accepting credit cards." } },
    }] : [])],
    customer_email: i.customerEmail || undefined,
    payment_intent_data: { description: `Invoice ${i.invoiceNumber}`, metadata: meta, ...(sc ? { capture_method: "manual" as const } : {}) },
    ...(sc ? {
      billing_address_collection: "required" as const,
      custom_text: { submit: { message: `${sc.disclosure} If you pay with a debit or prepaid card, or your billing address is in a state that doesn't allow surcharges, only the invoice amount is charged. To avoid the surcharge, go back and pay by bank.`.slice(0, 1200) } },
    } : {}),
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
