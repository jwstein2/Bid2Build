import "server-only";
/**
 * Stripe Connect for contractor invoice payments: the server side. Talks to Stripe and writes the Connect tables
 * with the service-role client (those tables have no browser policies). Callers check Financials permissions first.
 */
import type Stripe from "stripe";
import { getStripe, assertModeAllowed } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { isLiveKey } from "@/lib/billing/test-mode";
import { serverEnv } from "@/lib/env";
import { checkoutParams, connectMode, fromCents, hashPayToken, methodFromType, newPayToken, type AccountSnapshot } from "./connect";

export interface PaymentAccountRow {
  book_id: string; stripe_account_id: string; livemode: boolean; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean;
  requirements_due: string[]; disabled_reason: string | null; card_enabled: boolean; ach_enabled: boolean; card_fee_payer: "contractor" | "customer";
  status_synced_at: string | null;
}

const COLS = "book_id, stripe_account_id, livemode, charges_enabled, payouts_enabled, details_submitted, requirements_due, disabled_reason, card_enabled, ach_enabled, card_fee_payer, status_synced_at";
const liveKey = () => isLiveKey(serverEnv().stripeSecretKey);

export async function getPaymentAccount(bookId: string): Promise<PaymentAccountRow | null> {
  const { data, error } = await createAdminClient().from("fin_payment_accounts").select(COLS).eq("book_id", bookId).maybeSingle();
  if (error) throw error;
  const row = data as PaymentAccountRow | null;
  // A test-mode account is never used by a live deploy, and the other way round (every context shares one database).
  if (row && row.livemode !== liveKey()) return null;
  return row;
}

function snapshotColumns(a: Stripe.Account) {
  const req = a.requirements;
  const due = [...(req?.past_due ?? []), ...(req?.currently_due ?? [])];
  return {
    charges_enabled: Boolean(a.charges_enabled), payouts_enabled: Boolean(a.payouts_enabled), details_submitted: Boolean(a.details_submitted),
    requirements_due: Array.from(new Set(due)).slice(0, 50), disabled_reason: req?.disabled_reason ?? null, status_synced_at: new Date().toISOString(),
  };
}

export const snapshotOf = (a: Stripe.Account): AccountSnapshot => ({
  charges_enabled: a.charges_enabled, payouts_enabled: a.payouts_enabled, details_submitted: a.details_submitted, requirements: a.requirements ?? null,
});

/** Create (once) the contractor's Stripe account and return a Stripe-hosted onboarding link. */
export async function startOnboarding(opts: { bookId: string; userId: string; email?: string | null; businessName: string; returnUrl: string; refreshUrl: string }) {
  if (connectMode() === "off") throw new Error("connect_off");
  assertModeAllowed();
  const stripe = getStripe();
  const admin = createAdminClient();
  let row = await getPaymentAccount(opts.bookId);
  if (!row) {
    const acct = await stripe.accounts.create({
      // Standard-style account: the contractor gets the full Stripe Dashboard, pays Stripe's fees, and Stripe carries
      // payment losses. Built2Bid never holds the contractor's funds and takes no fee.
      controller: { stripe_dashboard: { type: "full" }, fees: { payer: "account" }, losses: { payments: "stripe" }, requirement_collection: "stripe" },
      country: "US",
      email: opts.email || undefined,
      business_profile: { name: opts.businessName.slice(0, 100), mcc: "1520", product_description: "Construction and home improvement services" },
      metadata: { b2b_book_id: opts.bookId },
    }, { idempotencyKey: `b2b-connect-acct-${opts.bookId}-${liveKey() ? "live" : "test"}` });
    const { error } = await admin.from("fin_payment_accounts").upsert({
      book_id: opts.bookId, stripe_account_id: acct.id, livemode: liveKey(), created_by: opts.userId, ...snapshotColumns(acct),
    }, { onConflict: "book_id" });
    if (error) throw error;
    row = await getPaymentAccount(opts.bookId);
    if (!row) throw new Error("account_store_failed");
  }
  const link = await stripe.accountLinks.create({ account: row.stripe_account_id, type: "account_onboarding", return_url: opts.returnUrl, refresh_url: opts.refreshUrl });
  return link.url;
}

/** Pull the account's current status from Stripe (after onboarding returns, or on demand). */
export async function refreshAccount(bookId: string) {
  const row = await getPaymentAccount(bookId);
  if (!row) return null;
  const acct = await getStripe().accounts.retrieve(row.stripe_account_id);
  await syncAccount(acct);
  return getPaymentAccount(bookId);
}

/** account.updated (Connect webhook) or a refresh: mirror the status columns. */
export async function syncAccount(acct: Stripe.Account) {
  const { error } = await createAdminClient().from("fin_payment_accounts").update(snapshotColumns(acct)).eq("stripe_account_id", acct.id);
  if (error) throw error;
}

/** One active pay link per invoice. Returns the raw token (shown once, then only its hash is kept). */
export async function createPayLink(bookId: string, invoiceId: string, userId: string) {
  const admin = createAdminClient();
  await admin.from("fin_invoice_pay_links").update({ revoked_at: new Date().toISOString(), revoked_by: userId }).eq("invoice_id", invoiceId).is("revoked_at", null);
  const token = newPayToken();
  const { error } = await admin.from("fin_invoice_pay_links").insert({ book_id: bookId, invoice_id: invoiceId, token_hash: hashPayToken(token), created_by: userId });
  if (error) throw error;
  return token;
}

export async function revokePayLinks(invoiceId: string, userId: string) {
  const { error } = await createAdminClient().from("fin_invoice_pay_links").update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq("invoice_id", invoiceId).is("revoked_at", null);
  if (error) throw error;
}

export interface PayPage {
  invoiceId: string; bookId: string; number: string; issueDate: string | null; dueDate: string | null; total: string; balance: string; status: string;
  billToName: string; billToEmail: string | null; businessName: string; account: PaymentAccountRow | null; pending: boolean;
}

/** Everything the public pay page shows, looked up by the link token. Null when the link is unknown or revoked. */
export async function loadPayPage(token: string): Promise<PayPage | null> {
  const admin = createAdminClient();
  const { data: link } = await admin.from("fin_invoice_pay_links").select("id, book_id, invoice_id").eq("token_hash", hashPayToken(token)).is("revoked_at", null).maybeSingle();
  if (!link) return null;
  const l = link as { id: string; book_id: string; invoice_id: string };
  const [{ data: inv }, { data: bal }, { data: book }, account, { data: pending }] = await Promise.all([
    admin.from("fin_invoices").select("id, number, issue_date, due_date, total, status, bill_to").eq("id", l.invoice_id).maybeSingle(),
    admin.from("fin_invoice_balances_v").select("balance").eq("invoice_id", l.invoice_id).maybeSingle(),
    admin.from("fin_books").select("name").eq("id", l.book_id).maybeSingle(),
    getPaymentAccount(l.book_id),
    admin.from("fin_online_payments").select("id").eq("invoice_id", l.invoice_id).eq("status", "processing").limit(1),
  ]);
  if (!inv) return null;
  await admin.from("fin_invoice_pay_links").update({ last_viewed_at: new Date().toISOString() }).eq("id", l.id);
  const i = inv as { id: string; number: string | null; issue_date: string | null; due_date: string | null; total: string; status: string; bill_to: Record<string, string> | null };
  return {
    invoiceId: i.id, bookId: l.book_id, number: i.number ?? "", issueDate: i.issue_date, dueDate: i.due_date, total: String(i.total),
    balance: String((bal as { balance?: string } | null)?.balance ?? i.total), status: i.status,
    billToName: i.bill_to?.name ?? "", billToEmail: i.bill_to?.email ?? null, businessName: (book as { name?: string } | null)?.name ?? "Your contractor",
    account, pending: Boolean((pending as unknown[] | null)?.length),
  };
}

/** Start a Stripe Checkout session on the contractor's account for the invoice's open balance. */
export async function startInvoiceCheckout(page: PayPage, returnUrl: string) {
  if (connectMode() === "off") throw new Error("connect_off");
  assertModeAllowed();
  const a = page.account;
  if (!a || !a.charges_enabled) throw new Error("not_ready");
  if (page.status !== "issued" || Number(page.balance) <= 0) throw new Error("nothing_due");
  const params = checkoutParams({
    invoiceId: page.invoiceId, bookId: page.bookId, invoiceNumber: page.number, businessName: page.businessName, amountDue: page.balance,
    customerEmail: page.billToEmail, card: a.card_enabled, ach: a.ach_enabled, returnUrl,
  });
  const session = await getStripe().checkout.sessions.create(params as Stripe.Checkout.SessionCreateParams, { stripeAccount: a.stripe_account_id });
  const { error } = await createAdminClient().from("fin_online_payments").insert({
    book_id: page.bookId, invoice_id: page.invoiceId, stripe_account_id: a.stripe_account_id, checkout_session_id: session.id,
    livemode: Boolean(session.livemode), amount: page.balance, status: "open",
  });
  if (error) throw error;
  return session.url;
}

/** Settle a paid Checkout session (card right away; ACH once the bank debit succeeds). Idempotent. */
export async function settleSession(session: Stripe.Checkout.Session, stripeAccount: string) {
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  let method: "card" | "ach" | null = null;
  if (piId) {
    const pi = await getStripe().paymentIntents.retrieve(piId, { expand: ["payment_method"] }, { stripeAccount });
    const pm = pi.payment_method as Stripe.PaymentMethod | string | null;
    method = methodFromType(typeof pm === "object" && pm ? pm.type : pi.payment_method_types?.[0]);
  }
  const amount = fromCents(session.amount_total ?? 0);
  const { data, error } = await createAdminClient().rpc("fin_online_payment_settle", {
    p_checkout_session_id: session.id, p_payment_intent_id: piId, p_method: method ?? "card", p_amount: amount,
  });
  if (error) throw error;
  return data;
}

export async function markSession(sessionId: string, status: "processing" | "failed" | "expired", reason?: string) {
  const { error } = await createAdminClient().from("fin_online_payments").update({ status, failure_reason: reason?.slice(0, 300) ?? null })
    .eq("checkout_session_id", sessionId).is("payment_id", null);
  if (error) throw error;
}

/** charge.refunded / charge.dispute.*: flag the online payment so the contractor records the refund or sees the dispute. */
export async function flagByPaymentIntent(piId: string, patch: { status: "refunded" | "partially_refunded" | "disputed" | "succeeded"; refunded_amount?: string }) {
  const admin = createAdminClient();
  const { data } = await admin.from("fin_online_payments").select("id, book_id, payment_id").eq("payment_intent_id", piId).maybeSingle();
  if (!data) return false;
  const row = data as { id: string; book_id: string; payment_id: string | null };
  const { error } = await admin.from("fin_online_payments").update(patch).eq("id", row.id);
  if (error) throw error;
  // Audit trail (append-only). The Payments page lists refunded / disputed online payments as "Needs attention".
  await admin.from("fin_audit_log").insert({ book_id: row.book_id, action: `payment.online_${patch.status}`, entity_type: "payment", entity_id: row.payment_id,
    details: { paymentIntent: piId, refunded: patch.refunded_amount ?? null } });
  return true;
}
